import type { JobDatabase } from './database.js';
import { normalize } from './model.js';
import type { OscarPlusProvider } from './provider.js';
import { withBackoff } from './rate-limit.js';
import { AuthenticationError } from './authentication.js';

export type SyncResult = { status: 'success' | 'failed' | 'already_running' | 'provider_not_configured'; new_jobs?: number; changed_jobs?: number; deleted_jobs?: number; error_category?: string };
export class SyncService {
  private running = false;
  private intervalHours = 4;
  private nextAttempt: string | null = null;
  constructor(private readonly database: JobDatabase, private readonly provider: OscarPlusProvider | null,
    private readonly clock: () => string = () => new Date().toISOString(), private readonly pauseMs = 250) {}
  status() {
    const latest = this.database.latestSync();
    const successful = this.database.lastSuccessfulSync();
    const age = successful?.finished_at ? Math.max(0, (Date.parse(this.clock()) - Date.parse(successful.finished_at)) / 1000) : null;
    const listingCounts = this.database.listingCounts();
    return {
      provider_state: this.provider ? 'fixture_or_live' : 'not_configured',
      authentication_state: !this.provider ? 'not_configured' : latest?.error_category?.startsWith('authentication_') ? 'authentication_required' : 'provider_managed',
      authentication: this.provider?.authenticationStatus?.() ?? null,
      last_attempted_sync: latest?.started_at ?? null,
      last_successful_sync: successful?.finished_at ?? null,
      known_job_count: this.database.count(),
      listed_job_count: listingCounts.listed,
      unlisted_snapshot_count: listingCounts.not_listed,
      unchecked_snapshot_count: listingCounts.unknown,
      cache_age_seconds: age,
      cache_fresh: age !== null && age <= this.intervalHours * 3600 && latest?.status === 'success',
      last_attempt_status: latest?.status ?? null,
      discovered_jobs_last_sync: latest?.discovered_count ?? null,
      next_scheduled_sync: this.nextAttempt,
      new_jobs_last_sync: latest?.new_count ?? 0,
      changed_jobs_last_sync: latest?.changed_count ?? 0,
      deleted_jobs_last_sync: latest?.deleted_count ?? 0,
      last_error_category: latest?.error_category ?? null,
      running: this.running,
    };
  }
  async run(): Promise<SyncResult> {
    if (this.running) return { status: 'already_running' };
    const started = this.clock();
    const id = this.database.startSync(started);
    this.running = true;
    try {
      if (!this.provider) {
        this.database.finishSync(id, this.clock(), 'provider_not_configured', 0, 0, 'provider_not_configured');
        return { status: 'provider_not_configured' };
      }
      await this.provider.ensureAuthenticated();
      // Listing spans many pages; each browser action has its own bounded timeout.
      const summaries = await this.provider.listPostings();
      const seenIds = new Set<string>();
      const postings = [];
      for (const summary of summaries) {
        if (seenIds.has(summary.posting_id)) continue;
        seenIds.add(summary.posting_id);
        const existing = this.database.get(summary.posting_id);
        if (existing && summary.source_revision && existing.source_revision === summary.source_revision) continue;
        if (this.pauseMs) await new Promise(resolve => setTimeout(resolve, this.pauseMs));
        const raw = await withBackoff(() => this.provider!.getPosting(summary.posting_id), { timeoutMs: 60000 });
        if (raw.posting_id !== summary.posting_id) throw new Error('posting_id_mismatch');
        postings.push({ raw, job: normalize(raw, started) });
      }
      const counts = this.database.applySync(postings, [...seenIds], started);
      this.database.finishSync(id, this.clock(), 'success', counts.new_count, counts.changed_count, null, counts.deleted_count, seenIds.size);
      return { status: 'success', new_jobs: counts.new_count, changed_jobs: counts.changed_count, deleted_jobs: counts.deleted_count };
    } catch (error) {
      const category = error instanceof AuthenticationError ? error.message : error instanceof Error && ['invalid_posting', 'posting_id_mismatch', 'provider_not_configured', 'request_timeout', 'authentication_required', 'posting_not_found', 'listing_unavailable', 'listing_incomplete', 'listing_limit_exceeded', 'application_status_unrecognized'].includes(error.message) ? error.message : 'provider_error';
      this.database.finishSync(id, this.clock(), 'failed', 0, 0, category);
      return { status: 'failed', error_category: category };
    } finally {
      try { await this.provider?.close?.(); }
      catch { console.warn('oscarplus provider_cleanup_error'); }
      finally { this.running = false; }
    }
  }
  startScheduler(intervalHours: number): () => void {
    if (!this.provider) return () => {};
    this.intervalHours = intervalHours;
    const intervalMs = intervalHours * 3_600_000;
    const lastSuccess = this.database.lastSuccessfulSync()?.finished_at;
    const lastTime = lastSuccess ? Date.parse(lastSuccess) : NaN;
    const needsListingCheck = this.database.listingCounts().unknown > 0;
    const initialDelay = !needsListingCheck && Number.isFinite(lastTime) ? Math.max(0, intervalMs - (Date.now() - lastTime)) : 0;
    let stopped = false;
    let timer: NodeJS.Timeout;
    const tick = async () => {
      this.nextAttempt = null;
      try { await this.run(); }
      catch { console.warn('oscarplus scheduler_error'); }
      finally {
        if (!stopped) {
          this.nextAttempt = new Date(Date.now() + intervalMs).toISOString();
          timer = setTimeout(tick, intervalMs);
        }
      }
    };
    this.nextAttempt = new Date(Date.now() + initialDelay).toISOString();
    timer = setTimeout(tick, initialDelay);
    return () => { stopped = true; clearTimeout(timer); this.nextAttempt = null; };
  }
}
