import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { JobDatabase } from '../src/database.js';
import { normalize, type RawPosting } from '../src/model.js';
import { FixtureOscarPlusProvider, type OscarPlusProvider } from '../src/provider.js';
import { SyncService } from '../src/sync.js';
import { AuthenticationError } from '../src/authentication.js';

const base: RawPosting = {
  posting_id: '247001', title: 'Electrical Engineer', employer: 'Acme', location: 'Hamilton',
  application_deadline: '2026-10-10', posted_date: '2026-09-20', description: 'Circuit design',
  source_posting_text: 'Position Title:\nElectrical Engineer\n\nPosition Description:\nCircuit design',
  attachments: [{ id: 'a1', name: 'details.txt', mime_type: 'text/plain', content_base64: 'SGVsbG8=' }],
};
const databases: JobDatabase[] = [];
const folders: string[] = [];
function db(path = ':memory:') { const database = new JobDatabase(path); databases.push(database); return database; }
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime('2026-09-28T00:00:00.000Z'); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); for (const database of databases.splice(0)) database.close(); for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });

describe('normalization and persistence', () => {
  it('normalizes missing optional fields without inventing values and hashes deterministically', () => {
    const a = normalize(base, '2026-09-28T00:00:00.000Z');
    const b = normalize({ ...base }, '2026-09-29T00:00:00.000Z');
    expect(a.division).toBeNull();
    expect(a.disciplines_or_programs).toEqual([]);
    expect(a.content_hash).toBe(b.content_hash);
    expect(a.source_capture?.sha256).toBe(b.source_capture?.sha256);
    expect(a.source_capture?.captured_at).not.toBe(b.source_capture?.captured_at);
  });
  it('inserts, preserves unchanged timestamps, then detects changed content without duplicates', async () => {
    const database = db();
    let time = '2026-09-28T00:00:00.000Z';
    const postings = [base];
    const provider = new FixtureOscarPlusProvider(postings);
    const sync = new SyncService(database, provider, () => time, 0);
    expect(await sync.run()).toMatchObject({ status: 'success', new_jobs: 1 });
    const first = database.get(base.posting_id)!;
    time = '2026-09-29T00:00:00.000Z';
    expect(await sync.run()).toMatchObject({ status: 'success', new_jobs: 0, changed_jobs: 0 });
    expect(database.get(base.posting_id)).toMatchObject({ first_seen_at: first.first_seen_at, last_changed_at: first.last_changed_at, last_seen_at: time });
    postings[0] = { ...base, description: 'New circuit design' };
    time = '2026-09-30T00:00:00.000Z';
    expect(await sync.run()).toMatchObject({ status: 'success', changed_jobs: 1 });
    expect(database.get(base.posting_id)?.content_hash).not.toBe(first.content_hash);
    expect(database.get(base.posting_id)?.last_changed_at).toBe(time);
    expect(database.count()).toBe(1);
    expect(database.captureHistory(base.posting_id)).toHaveLength(1);
    postings[0] = { ...postings[0], source_posting_text: 'Position Title:\nElectrical Engineer\n\nPosition Description:\nNew circuit design' };
    await sync.run();
    expect(database.captureHistory(base.posting_id)).toHaveLength(2);
  });
  it('filters text, employer, location, deadline, and first-seen time', async () => {
    const database = db();
    const sync = new SyncService(database, new FixtureOscarPlusProvider([base, { ...base, posting_id: '247002', title: 'Software Developer', employer: 'Other', location: 'Toronto', description: 'Backend services', source_posting_text: 'Position Title:\nSoftware Developer\n\nPosition Description:\nBackend services', application_deadline: '2026-11-01' }]), () => '2026-09-28T00:00:00.000Z', 0);
    await sync.run();
    expect(database.search({ text: 'circuit' }).map(x => x.posting_id)).toEqual(['247001']);
    expect(database.search({ employer: 'Acme', location: 'Hamilton' })).toHaveLength(1);
    expect(database.search({ deadline_after: '2026-10-15', deadline_before: '2026-11-05' }).map(x => x.posting_id)).toEqual(['247002']);
    expect(database.newJobs('2026-09-27T00:00:00.000Z')).toHaveLength(2);
    expect(database.newJobs('2026-09-28T00:00:00.000Z')).toHaveLength(0);
  });
  it('persists across reopen, and only returns known cached attachments', async () => {
    const folder = mkdtempSync(join(process.cwd(), 'data', 'test-')); folders.push(folder);
    const path = join(folder, 'jobs.sqlite');
    const first = db(path);
    await new SyncService(first, new FixtureOscarPlusProvider([base]), undefined, 0).run();
    first.close(); databases.splice(databases.indexOf(first), 1);
    const reopened = db(path);
    expect(reopened.get('247001')?.title).toBe(base.title);
    expect(reopened.get('247001')?.source_capture?.text).toBe(base.source_posting_text);
    expect(reopened.captureHistory('247001')).toHaveLength(1);
    expect(reopened.attachment('247001', 'a1')).toMatchObject({ status: 'ok', content_base64: 'SGVsbG8=' });
    expect(reopened.attachment('247001', 'https://example.com')).toEqual({ status: 'not_found' });
    expect(reopened.attachment('unknown', 'a1')).toEqual({ status: 'not_found' });
  });
  it('upgrades a v1 database without losing saved jobs', () => {
    const folder = mkdtempSync(join(process.cwd(), 'data', 'test-')); folders.push(folder);
    const path = join(folder, 'legacy.sqlite');
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE jobs (source TEXT NOT NULL, posting_id TEXT NOT NULL, title TEXT NOT NULL, employer TEXT NOT NULL,
        location TEXT, position_type TEXT, term TEXT, application_deadline TEXT, posted_date TEXT,
        first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, last_changed_at TEXT NOT NULL,
        content_hash TEXT NOT NULL, source_revision TEXT, payload TEXT NOT NULL, PRIMARY KEY (source, posting_id));
      CREATE TABLE sync_history (id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL,
        finished_at TEXT, status TEXT NOT NULL, new_count INTEGER NOT NULL DEFAULT 0,
        changed_count INTEGER NOT NULL DEFAULT 0, error_category TEXT);
      PRAGMA user_version = 1;
    `);
    const job = normalize(base, '2026-09-28T00:00:00.000Z');
    legacy.prepare(`INSERT INTO jobs (source,posting_id,title,employer,first_seen_at,last_seen_at,last_changed_at,
      content_hash,payload) VALUES (?,?,?,?,?,?,?,?,?)`).run('oscarplus', job.posting_id, job.title, job.employer,
      job.first_seen_at, job.last_seen_at, job.last_changed_at, job.content_hash, JSON.stringify(job));
    legacy.close();
    const upgraded = db(path);
    expect(upgraded.get(base.posting_id)).toMatchObject({ title: base.title,
      application_status: 'not_submitted', submitted_at: null, detail_fields: {}, source_capture: null });
    expect(upgraded.count()).toBe(1);
  });
  it('does not persist credentials or token-bearing source URLs', async () => {
    const folder = mkdtempSync(join(process.cwd(), 'data', 'test-')); folders.push(folder);
    const path = join(folder, 'jobs.sqlite');
    const database = db(path);
    process.env.OSCARPLUS_PASSWORD = 'PRIVATE_CREDENTIAL_MARKER';
    await new SyncService(database, new FixtureOscarPlusProvider([{ ...base, source_url: 'https://www.oscarplusmcmaster.ca/posting?token=PRIVATE_CREDENTIAL_MARKER' }]), undefined, 0).run();
    expect(database.get(base.posting_id)?.raw_source_metadata.source_url).toBeNull();
    database.close(); databases.splice(databases.indexOf(database), 1);
    expect(readFileSync(path).toString('utf8')).not.toContain('PRIVATE_CREDENTIAL_MARKER');
    delete process.env.OSCARPLUS_PASSWORD;
  });
  it('keeps good data after provider failure and prevents overlapping runs', async () => {
    const database = db();
    await new SyncService(database, new FixtureOscarPlusProvider([base]), undefined, 0).run();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const provider: OscarPlusProvider = {
      async ensureAuthenticated() { await gate; },
      async listPostings() { throw new Error('secret-password'); },
      async getPosting() { throw new Error('unused'); },
    };
    const sync = new SyncService(database, provider, undefined, 0);
    const pending = sync.run();
    expect(await sync.run()).toEqual({ status: 'already_running' });
    release();
    expect(await pending).toEqual({ status: 'failed', error_category: 'provider_error' });
    expect(database.get('247001')?.title).toBe(base.title);
    expect(JSON.stringify(sync.status())).not.toContain('secret-password');
  });
  it('does not repeat a recent successful sync when the scheduler starts', async () => {
    const database = db();
    const sync = new SyncService(database, new FixtureOscarPlusProvider([base]), undefined, 0);
    await sync.run();
    const previous = database.latestSync();
    const stop = sync.startScheduler(4);
    try {
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(database.latestSync()).toEqual(previous);
    } finally { stop(); }
  });
  it('prunes unsubmitted jobs after deadline plus three days and submitted jobs after one calendar month', async () => {
    const database = db();
    let time = '2026-09-24T00:00:00.000Z';
    const provider = new FixtureOscarPlusProvider([
      { ...base, posting_id: 'unsent', application_deadline: '2026-09-20T00:00:00.000Z' },
      { ...base, posting_id: 'submitted', application_deadline: '2026-09-20T00:00:00.000Z',
        application_status: 'submitted', submitted_at: '2026-09-15T12:00:00.000Z',
        detail_fields: { 'Application Documents Required': 'Resume' } },
    ]);
    const sync = new SyncService(database, provider, () => time, 0);
    expect(await sync.run()).toMatchObject({ status: 'success', deleted_jobs: 1 });
    expect(database.get('unsent')).toBeNull();
    expect(database.captureHistory('unsent')).toHaveLength(0);
    expect(database.get('submitted')).toMatchObject({ application_status: 'submitted', submitted_at: '2026-09-15T12:00:00.000Z',
      detail_fields: { 'Application Documents Required': 'Resume' } });
    expect(database.search({ application_status: 'submitted' })).toHaveLength(1);
    time = '2026-10-15T12:00:00.000Z';
    await sync.run();
    expect(database.get('submitted')).not.toBeNull();
    time = '2026-10-15T12:00:01.000Z';
    await sync.run();
    expect(database.get('submitted')).toBeNull();
  });
  it('reports a missing live provider honestly', async () => {
    const sync = new SyncService(db(), null);
    expect(await sync.run()).toEqual({ status: 'provider_not_configured' });
    expect(sync.status()).toMatchObject({ provider_state: 'not_configured', authentication_state: 'not_configured', known_job_count: 0 });
  });
  it('marks missing listings honestly, preserves captures, and restores reappearing jobs', async () => {
    const database = db();
    const postings = [base, { ...base, posting_id: '247002' }];
    let time = '2026-09-28T00:00:00.000Z';
    const sync = new SyncService(database, new FixtureOscarPlusProvider(postings), () => time, 0);
    await sync.run();
    const old = database.get('247001')!;
    postings.shift();
    time = '2026-09-29T00:00:00.000Z';
    await sync.run();
    expect(database.search().map(x => x.posting_id)).toEqual(['247002']);
    expect(database.search({ include_unlisted: true })).toHaveLength(2);
    expect(database.get('247001')).toMatchObject({ listing_state: 'not_listed', last_seen_at: old.last_seen_at,
      last_listing_check_at: time, source_capture: old.source_capture, content_hash: old.content_hash });
    expect(database.captureHistory('247001')).toHaveLength(1);
    expect(sync.status()).toMatchObject({ listed_job_count: 1, unlisted_snapshot_count: 1, discovered_jobs_last_sync: 1, cache_fresh: true });
    postings.push(base);
    await sync.run();
    expect(database.get('247001')).toMatchObject({ listing_state: 'listed', first_seen_at: old.first_seen_at, last_seen_at: time });
    expect(database.search()).toHaveLength(2);
  });
  it('does not alter listing state, captures, or freshness after an incomplete crawl', async () => {
    const database = db();
    await new SyncService(database, new FixtureOscarPlusProvider([base]), undefined, 0).run();
    const before = database.get(base.posting_id);
    const provider: OscarPlusProvider = { async ensureAuthenticated() {},
      async listPostings() { throw new Error('listing_incomplete'); }, async getPosting() { throw new Error('unused'); } };
    const sync = new SyncService(database, provider, undefined, 0);
    expect(await sync.run()).toEqual({ status: 'failed', error_category: 'listing_incomplete' });
    expect(database.get(base.posting_id)).toEqual(before);
    expect(sync.status()).toMatchObject({ cache_fresh: false, last_attempt_status: 'failed' });
  });
  it('keeps scheduling and clears the running flag when provider cleanup throws', async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime('2026-09-28T00:00:00.000Z');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const database = db();
    let calls = 0;
    const provider: OscarPlusProvider = { async ensureAuthenticated() { calls++; },
      async listPostings() { return []; }, async getPosting() { throw new Error('unused'); },
      async close() { throw new Error('private-provider-error'); } };
    const sync = new SyncService(database, provider, undefined, 0);
    const stop = sync.startScheduler(4);
    try {
      await vi.advanceTimersToNextTimerAsync();
      expect(sync.status()).toMatchObject({ running: false, last_attempt_status: 'success' });
      expect(sync.status().next_scheduled_sync).not.toBeNull();
      await vi.advanceTimersByTimeAsync(4 * 3_600_000);
      expect(calls).toBe(2);
      expect(warning).toHaveBeenCalledWith('oscarplus provider_cleanup_error');
    } finally { stop(); }
  });
  it('reports an old successful cache as stale', async () => {
    const database = db();
    const sync = new SyncService(database, new FixtureOscarPlusProvider([base]), undefined, 0);
    await sync.run();
    vi.setSystemTime('2026-09-28T05:00:00.000Z');
    expect(sync.status()).toMatchObject({ cache_fresh: false, cache_age_seconds: 18000 });
  });
  it('persists a specific phone/redirect failure category without modifying cached jobs', async () => {
    const database = db();
    await new SyncService(database, new FixtureOscarPlusProvider([base]), undefined, 0).run();
    const before = database.get(base.posting_id);
    const provider: OscarPlusProvider = {
      async ensureAuthenticated() { throw new AuthenticationError('authentication_redirect_timeout'); },
      async listPostings() { return []; }, async getPosting() { throw new Error('unused'); },
      authenticationStatus() { return { stage: 'session_retry', outcome: 'failed', phone_call_requested_at: null,
        updated_at: '2026-09-28T00:01:00Z', error_category: 'authentication_redirect_timeout' }; },
    };
    const sync = new SyncService(database, provider, undefined, 0);
    expect(await sync.run()).toMatchObject({ status: 'failed', error_category: 'authentication_redirect_timeout' });
    expect(sync.status()).toMatchObject({ authentication_state: 'authentication_required',
      authentication: { stage: 'session_retry', phone_call_requested_at: null, outcome: 'failed' }, cache_fresh: false });
    expect(database.latestSync()?.error_category).toBe('authentication_redirect_timeout');
    expect(database.get(base.posting_id)).toEqual(before);
  });
});
