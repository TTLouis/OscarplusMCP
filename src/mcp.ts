import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { JobDatabase, SearchFilters } from './database.js';
import type { SyncService } from './sync.js';

const filters = {
  text: z.string().optional(), employer: z.string().optional(), location: z.string().optional(),
  position_type: z.string().optional(), term: z.string().optional(),
  application_status: z.enum(['submitted', 'not_submitted']).optional(),
  deadline_after: z.string().optional(), deadline_before: z.string().optional(),
  posted_after: z.string().optional(), first_seen_after: z.string().optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  include_unlisted: z.boolean().optional().describe('Include retained snapshots no longer listed for this account, and unchecked legacy snapshots'),
};
function result(data: unknown) { return { content: [{ type: 'text' as const, text: JSON.stringify(data) }], structuredContent: data as Record<string, unknown> }; }
const compact = (job: ReturnType<JobDatabase['search']>[number]) => ({
  posting_id: job.posting_id, title: job.title, employer: job.employer, location: job.location,
  position_type: job.position_type, term: job.term, application_deadline: job.application_deadline,
  application_status: job.application_status, submitted_at: job.submitted_at,
  application_status_label: job.application_status_label ?? null,
  posted_date: job.posted_date, first_seen_at: job.first_seen_at, last_changed_at: job.last_changed_at,
  last_seen_at: job.last_seen_at, listing_state: job.listing_state, last_listing_check_at: job.last_listing_check_at,
});
export function createMcpServer(database: JobDatabase, sync: SyncService): McpServer {
  const server = new McpServer({ name: 'oscarplus-mcp', version: '0.1.0' });
  server.registerTool('oscarplus_search_jobs', { description: 'Search locally synchronized jobs listed in the last complete crawl. not_listed means absent for this account, not necessarily closed. Check cache freshness in sync_status.', inputSchema: filters },
    async input => result({ jobs: database.search(input as SearchFilters).map(compact), cache: sync.status() }));
  server.registerTool('oscarplus_get_job', { description: 'Get a full locally stored posting', inputSchema: { posting_id: z.string().min(1) } },
    async ({ posting_id }) => result({ job: database.get(posting_id), capture_history: database.captureHistory(posting_id), cache: sync.status() }));
  server.registerTool('oscarplus_new_jobs', { description: 'Get jobs first seen after a timestamp', inputSchema: { since: z.string().datetime(), ...filters } },
    async ({ since, ...input }) => result({ jobs: database.newJobs(since, input as SearchFilters).map(compact), cache: sync.status() }));
  server.registerTool('oscarplus_sync_jobs', { description: 'Read sync policy and status; ingestion runs only on the server schedule', inputSchema: {} },
    async () => {
      const status = sync.status();
      return result({ status: status.provider_state === 'not_configured' ? 'provider_not_configured' : 'scheduled_only', ...status });
    });
  server.registerTool('oscarplus_sync_status', { description: 'Read local sync status', inputSchema: {} },
    async () => result(sync.status()));
  server.registerTool('oscarplus_get_attachment', { description: 'Read a cached attachment from a known posting', inputSchema: { posting_id: z.string().min(1), attachment_id: z.string().min(1) } },
    async ({ posting_id, attachment_id }) => result(database.attachment(posting_id, attachment_id)));
  return server;
}
