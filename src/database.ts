import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Job, RawPosting } from './model.js';

export interface SearchFilters {
  text?: string; employer?: string; location?: string; position_type?: string; term?: string;
  application_status?: 'submitted' | 'not_submitted';
  deadline_after?: string; deadline_before?: string; posted_after?: string; first_seen_after?: string;
  limit?: number;
  include_unlisted?: boolean;
}
type JobRow = { payload: string; content_hash: string; first_seen_at: string; last_changed_at: string; source_revision: string | null };
type SyncRow = { started_at: string; finished_at: string | null; status: string; new_count: number; changed_count: number; deleted_count: number; error_category: string | null; discovered_count: number | null };

export class JobDatabase {
  private readonly db: Database.Database;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }
  close() { this.db.close(); }
  private migrate() {
    const version = this.db.pragma('user_version', { simple: true }) as number;
    if (version > 4) throw new Error('unsupported_database_version');
    if (version === 0) this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE jobs (
          source TEXT NOT NULL, posting_id TEXT NOT NULL, title TEXT NOT NULL,
          employer TEXT NOT NULL, location TEXT, position_type TEXT, term TEXT,
          application_deadline TEXT, posted_date TEXT, first_seen_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL, last_changed_at TEXT NOT NULL,
          content_hash TEXT NOT NULL, source_revision TEXT, payload TEXT NOT NULL,
          PRIMARY KEY (source, posting_id)
        );
        CREATE INDEX jobs_title ON jobs(title);
        CREATE INDEX jobs_employer ON jobs(employer);
        CREATE INDEX jobs_deadline ON jobs(application_deadline);
        CREATE INDEX jobs_posted ON jobs(posted_date);
        CREATE INDEX jobs_first_seen ON jobs(first_seen_at);
        CREATE INDEX jobs_last_changed ON jobs(last_changed_at);
        CREATE TABLE attachment_blobs (
          source TEXT NOT NULL, posting_id TEXT NOT NULL, attachment_id TEXT NOT NULL,
          mime_type TEXT, content_base64 TEXT NOT NULL,
          PRIMARY KEY (source, posting_id, attachment_id),
          FOREIGN KEY (source, posting_id) REFERENCES jobs(source, posting_id)
        );
        CREATE TABLE sync_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL,
          finished_at TEXT, status TEXT NOT NULL, new_count INTEGER NOT NULL DEFAULT 0,
          changed_count INTEGER NOT NULL DEFAULT 0, error_category TEXT
        );
      `);
      this.db.pragma('user_version = 1');
    })();
    if (version <= 1) this.db.transaction(() => {
      this.db.exec(`
        ALTER TABLE jobs ADD COLUMN application_status TEXT NOT NULL DEFAULT 'not_submitted';
        ALTER TABLE jobs ADD COLUMN submitted_at TEXT;
        CREATE INDEX jobs_submitted_at ON jobs(submitted_at);
        ALTER TABLE sync_history ADD COLUMN deleted_count INTEGER NOT NULL DEFAULT 0;
      `);
      const rows = this.db.prepare('SELECT source, posting_id, payload FROM jobs').all() as Array<{ source: string; posting_id: string; payload: string }>;
      const update = this.db.prepare('UPDATE jobs SET payload=? WHERE source=? AND posting_id=?');
      for (const row of rows) {
        const job = JSON.parse(row.payload) as Job;
        update.run(JSON.stringify({ ...job, application_status: 'not_submitted', submitted_at: null, detail_fields: {} }), row.source, row.posting_id);
      }
      this.db.pragma('user_version = 2');
    })();
    if (version <= 2) this.db.transaction(() => {
      this.db.exec(`CREATE TABLE posting_captures (
        source TEXT NOT NULL, posting_id TEXT NOT NULL, sha256 TEXT NOT NULL,
        captured_at TEXT NOT NULL, capture_text TEXT NOT NULL,
        PRIMARY KEY (source, posting_id, sha256),
        FOREIGN KEY (source, posting_id) REFERENCES jobs(source, posting_id)
      );`);
      const rows = this.db.prepare('SELECT source, posting_id, payload FROM jobs').all() as Array<{ source: string; posting_id: string; payload: string }>;
      const update = this.db.prepare('UPDATE jobs SET payload=? WHERE source=? AND posting_id=?');
      for (const row of rows) {
        const job = JSON.parse(row.payload) as Job;
        update.run(JSON.stringify({ ...job, source_capture: null }), row.source, row.posting_id);
      }
      this.db.pragma('user_version = 3');
    })();
    if (version <= 3) this.db.transaction(() => {
      this.db.exec(`ALTER TABLE jobs ADD COLUMN listing_state TEXT NOT NULL DEFAULT 'unknown';
        ALTER TABLE sync_history ADD COLUMN discovered_count INTEGER;`);
      this.db.exec(`UPDATE jobs SET payload=json_set(payload, '$.listing_state', 'unknown', '$.last_listing_check_at', NULL)`);
      this.db.pragma('user_version = 4');
    })();
  }
  get(postingId: string): Job | null {
    const row = this.db.prepare('SELECT payload FROM jobs WHERE source = ? AND posting_id = ?').get('oscarplus', postingId) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) as Job : null;
  }
  getRevision(postingId: string): string | null {
    const row = this.db.prepare('SELECT source_revision FROM jobs WHERE source = ? AND posting_id = ?').get('oscarplus', postingId) as { source_revision: string | null } | undefined;
    return row?.source_revision ?? null;
  }
  exists(postingId: string): boolean { return this.get(postingId) !== null; }
  search(filters: SearchFilters = {}): Job[] {
    const conditions = ['source = @source'];
    if (!filters.include_unlisted) conditions.push("listing_state = 'listed'");
    const args: Record<string, string | number> = { source: 'oscarplus', limit: Math.min(Math.max(filters.limit ?? 500, 1), 1000) };
    for (const field of ['employer', 'location', 'position_type', 'term'] as const) {
      if (filters[field]) { conditions.push(`${field} LIKE @${field} ESCAPE '\\' COLLATE NOCASE`); args[field] = `%${escapeLike(filters[field])}%`; }
    }
    if (filters.application_status) { conditions.push('application_status = @application_status'); args.application_status = filters.application_status; }
    if (filters.text) {
      conditions.push(`(title LIKE @text ESCAPE '\\' COLLATE NOCASE OR employer LIKE @text ESCAPE '\\' COLLATE NOCASE OR payload LIKE @text ESCAPE '\\' COLLATE NOCASE)`);
      args.text = `%${escapeLike(filters.text)}%`;
    }
    const ranges: Array<[keyof SearchFilters, string, string]> = [
      ['deadline_after', 'application_deadline', '>='], ['deadline_before', 'application_deadline', '<='],
      ['posted_after', 'posted_date', '>='], ['first_seen_after', 'first_seen_at', '>'],
    ];
    for (const [key, column, operator] of ranges) if (filters[key]) { conditions.push(`${column} ${operator} @${key}`); args[key] = filters[key] as string; }
    const rows = this.db.prepare(`SELECT payload FROM jobs WHERE ${conditions.join(' AND ')} ORDER BY first_seen_at DESC, posting_id DESC LIMIT @limit`).all(args) as { payload: string }[];
    return rows.map(row => JSON.parse(row.payload) as Job);
  }
  newJobs(since: string, filters: SearchFilters = {}): Job[] { return this.search({ ...filters, first_seen_after: since }); }
  count(): number { return (this.db.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number }).n; }
  listingCounts(): Record<'listed' | 'not_listed' | 'unknown', number> {
    const counts = { listed: 0, not_listed: 0, unknown: 0 };
    for (const row of this.db.prepare('SELECT listing_state,COUNT(*) AS n FROM jobs GROUP BY listing_state').all() as Array<{ listing_state: keyof typeof counts; n: number }>) counts[row.listing_state] = row.n;
    return counts;
  }
  captureHistory(postingId: string): Array<{ sha256: string; captured_at: string }> {
    return this.db.prepare('SELECT sha256,captured_at FROM posting_captures WHERE source=? AND posting_id=? ORDER BY captured_at ASC')
      .all('oscarplus', postingId) as Array<{ sha256: string; captured_at: string }>;
  }
  startSync(at: string): number { return Number(this.db.prepare('INSERT INTO sync_history (started_at, status) VALUES (?, ?)').run(at, 'running').lastInsertRowid); }
  finishSync(id: number, at: string, status: string, newCount: number, changedCount: number, errorCategory: string | null, deletedCount = 0, discoveredCount: number | null = null) {
    this.db.prepare('UPDATE sync_history SET finished_at=?, status=?, new_count=?, changed_count=?, deleted_count=?, error_category=?, discovered_count=? WHERE id=?').run(at, status, newCount, changedCount, deletedCount, errorCategory, discoveredCount, id);
  }
  latestSync(): SyncRow | null { return this.db.prepare('SELECT * FROM sync_history ORDER BY id DESC LIMIT 1').get() as SyncRow | undefined ?? null; }
  lastSuccessfulSync(): SyncRow | null { return this.db.prepare("SELECT * FROM sync_history WHERE status='success' ORDER BY id DESC LIMIT 1").get() as SyncRow | undefined ?? null; }
  applySync(postings: Array<{ job: Job; raw: RawPosting }>, seenIds: string[], now: string): { new_count: number; changed_count: number; deleted_count: number } {
    return this.db.transaction(() => {
      let new_count = 0, changed_count = 0;
      const inserted = new Set<string>(), changed = new Set<string>();
      const select = this.db.prepare('SELECT payload, content_hash, first_seen_at, last_changed_at, source_revision FROM jobs WHERE source=? AND posting_id=?');
      const upsert = this.db.prepare(`INSERT INTO jobs
        (source,posting_id,title,employer,location,position_type,term,application_deadline,posted_date,first_seen_at,last_seen_at,last_changed_at,content_hash,source_revision,application_status,submitted_at,payload)
        VALUES (@source,@posting_id,@title,@employer,@location,@position_type,@term,@application_deadline,@posted_date,@first_seen_at,@last_seen_at,@last_changed_at,@content_hash,@source_revision,@application_status,@submitted_at,@payload)
        ON CONFLICT(source,posting_id) DO UPDATE SET title=excluded.title,employer=excluded.employer,location=excluded.location,
        position_type=excluded.position_type,term=excluded.term,application_deadline=excluded.application_deadline,posted_date=excluded.posted_date,
        last_seen_at=excluded.last_seen_at,last_changed_at=excluded.last_changed_at,content_hash=excluded.content_hash,
        source_revision=excluded.source_revision,application_status=excluded.application_status,submitted_at=excluded.submitted_at,payload=excluded.payload`);
      const blob = this.db.prepare('INSERT OR REPLACE INTO attachment_blobs (source,posting_id,attachment_id,mime_type,content_base64) VALUES (?,?,?,?,?)');
      const capture = this.db.prepare('INSERT OR IGNORE INTO posting_captures (source,posting_id,sha256,captured_at,capture_text) VALUES (?,?,?,?,?)');
      for (const { job, raw } of postings) {
        const old = select.get(job.source, job.posting_id) as JobRow | undefined;
        if (!old) { new_count++; inserted.add(job.posting_id); }
        else if (old.content_hash !== job.content_hash) { changed_count++; changed.add(job.posting_id); }
        const saved = { ...job, first_seen_at: old?.first_seen_at ?? now, last_seen_at: now,
          last_changed_at: !old || old.content_hash !== job.content_hash ? now : old.last_changed_at,
          listing_state: 'listed' as const, last_listing_check_at: now };
        upsert.run({
          source: saved.source, posting_id: saved.posting_id, title: saved.title,
          employer: saved.employer, location: saved.location, position_type: saved.position_type,
          term: saved.term, application_deadline: saved.application_deadline, posted_date: saved.posted_date,
          first_seen_at: saved.first_seen_at, last_seen_at: saved.last_seen_at,
          last_changed_at: saved.last_changed_at, content_hash: saved.content_hash,
          source_revision: saved.source_revision, application_status: saved.application_status,
          submitted_at: saved.submitted_at, payload: JSON.stringify(saved),
        });
        for (const attachment of raw.attachments ?? []) if (attachment.content_base64) {
          blob.run(job.source, job.posting_id, attachment.id, attachment.mime_type, attachment.content_base64);
        }
        if (job.source_capture) capture.run(job.source, job.posting_id,
          job.source_capture.sha256, job.source_capture.captured_at, job.source_capture.text);
      }
      const touch = this.db.prepare("UPDATE jobs SET last_seen_at=?, payload=json_set(payload, '$.last_seen_at', ?) WHERE source=? AND posting_id=?");
      for (const id of seenIds) if (!postings.some(x => x.job.posting_id === id)) touch.run(now, now, 'oscarplus', id);
      // A complete successful listing is evidence of visibility, not of an employer closing a job.
      this.db.prepare(`UPDATE jobs SET listing_state='not_listed',
        payload=json_set(payload, '$.listing_state', 'not_listed', '$.last_listing_check_at', ?)` ).run(now);
      const markListed = this.db.prepare(`UPDATE jobs SET listing_state='listed',
        payload=json_set(payload, '$.listing_state', 'listed') WHERE source='oscarplus' AND posting_id=?`);
      for (const id of seenIds) markListed.run(id);
      let deleted_count = 0;
      const candidates = this.db.prepare('SELECT source,posting_id,application_deadline,application_status,submitted_at FROM jobs').all() as Array<{
        source: string; posting_id: string; application_deadline: string | null;
        application_status: string; submitted_at: string | null;
      }>;
      const deleteBlobs = this.db.prepare('DELETE FROM attachment_blobs WHERE source=? AND posting_id=?');
      const deleteCaptures = this.db.prepare('DELETE FROM posting_captures WHERE source=? AND posting_id=?');
      const deleteJob = this.db.prepare('DELETE FROM jobs WHERE source=? AND posting_id=?');
      const current = Date.parse(now);
      for (const row of candidates) {
        const submittedExpiry = row.application_status === 'submitted' && row.submitted_at ? monthLater(row.submitted_at) : null;
        const deadline = row.application_deadline ? Date.parse(row.application_deadline) : NaN;
        const expiry = row.application_status === 'submitted' ? submittedExpiry
          : Number.isFinite(deadline) ? deadline + 3 * 86_400_000 : null;
        if (expiry === null || current <= expiry) continue;
        deleteBlobs.run(row.source, row.posting_id);
        deleteCaptures.run(row.source, row.posting_id);
        deleteJob.run(row.source, row.posting_id);
        if (inserted.has(row.posting_id)) new_count--;
        if (changed.has(row.posting_id)) changed_count--;
        deleted_count++;
      }
      return { new_count, changed_count, deleted_count };
    })();
  }
  attachment(postingId: string, attachmentId: string): { status: string; name?: string; mime_type?: string | null; content_base64?: string } {
    const job = this.get(postingId);
    const known = job?.attachments.find(x => x.id === attachmentId);
    if (!known) return { status: 'not_found' };
    const row = this.db.prepare('SELECT mime_type,content_base64 FROM attachment_blobs WHERE source=? AND posting_id=? AND attachment_id=?').get('oscarplus', postingId, attachmentId) as { mime_type: string | null; content_base64: string } | undefined;
    return row ? { status: 'ok', name: known.name, mime_type: row.mime_type, content_base64: row.content_base64 } : { status: 'not_cached', name: known.name, mime_type: known.mime_type };
  }
}
function escapeLike(value: string) { return value.replace(/[\\%_]/g, x => `\\${x}`); }
function monthLater(value: string): number | null {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.getTime();
}
