import { afterEach, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { JobDatabase } from '../src/database.js';
import { createHttpServer } from '../src/http.js';
import { FixtureOscarPlusProvider } from '../src/provider.js';
import { SyncService } from '../src/sync.js';

let server: Server | undefined;
let database: JobDatabase | undefined;
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  database?.close(); server = undefined; database = undefined;
});
async function setup(fixture: boolean) {
  database = new JobDatabase(':memory:');
  const provider = fixture ? new FixtureOscarPlusProvider([{ posting_id: '42', title: 'Test Engineer', employer: 'McMaster',
    source_posting_text: 'Position Title:\nTest Engineer\n\nOrganization:\nMcMaster' }]) : null;
  const sync = new SyncService(database, provider, undefined, 0);
  if (fixture) await sync.run();
  server = createHttpServer(database, sync);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing_address');
  return `http://127.0.0.1:${address.port}`;
}
async function call(base: string, method: string, params: object = {}) {
  const response = await fetch(`${base}/mcp`, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return { status: response.status, body: await response.json() as Record<string, any> };
}
it('serves fixture data through Streamable HTTP MCP', async () => {
  const base = await setup(true);
  const init = await call(base, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  expect(init.status).toBe(200);
  const search = await call(base, 'tools/call', { name: 'oscarplus_search_jobs', arguments: { text: 'Engineer' } });
  expect(search.status).toBe(200);
  expect(search.body.result.structuredContent.jobs[0].posting_id).toBe('42');
  expect(search.body.result.structuredContent.jobs[0].listing_state).toBe('listed');
  expect(search.body.result.structuredContent.jobs[0].last_seen_at).toBeTruthy();
  expect(search.body.result.structuredContent.cache.cache_fresh).toBe(true);
  const get = await call(base, 'tools/call', { name: 'oscarplus_get_job', arguments: { posting_id: '42' } });
  expect(get.body.result.structuredContent.job.employer).toBe('McMaster');
  expect(get.body.result.structuredContent.job.source_capture.text).toContain('Position Title:');
  expect(get.body.result.structuredContent.capture_history).toHaveLength(1);
  const newer = await call(base, 'tools/call', { name: 'oscarplus_new_jobs', arguments: { since: '2020-01-01T00:00:00.000Z' } });
  expect(newer.body.result.structuredContent.jobs).toHaveLength(1);
  const before = database!.latestSync();
  const sync = await call(base, 'tools/call', { name: 'oscarplus_sync_jobs', arguments: {} });
  expect(sync.body.result.structuredContent.status).toBe('scheduled_only');
  expect(database!.latestSync()).toEqual(before);
});
it('reports unconfigured sync and rejects arbitrary attachment IDs without leaking credentials', async () => {
  process.env.OSCARPLUS_PASSWORD = 'DO_NOT_LEAK_TEST_SECRET';
  const base = await setup(false);
  const sync = await call(base, 'tools/call', { name: 'oscarplus_sync_jobs', arguments: {} });
  const status = await call(base, 'tools/call', { name: 'oscarplus_sync_status', arguments: {} });
  const attachment = await call(base, 'tools/call', { name: 'oscarplus_get_attachment', arguments: { posting_id: '42', attachment_id: 'https://example.com/secret' } });
  expect(sync.body.result.structuredContent.status).toBe('provider_not_configured');
  expect(status.body.result.structuredContent.provider_state).toBe('not_configured');
  expect(attachment.body.result.structuredContent.status).toBe('not_found');
  expect(JSON.stringify([sync, status, attachment])).not.toContain('DO_NOT_LEAK_TEST_SECRET');
  delete process.env.OSCARPLUS_PASSWORD;
});
