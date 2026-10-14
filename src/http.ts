import { createServer, type Server } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { JobDatabase } from './database.js';
import { createMcpServer } from './mcp.js';
import type { SyncService } from './sync.js';

export function createHttpServer(database: JobDatabase, sync: SyncService): Server {
  return createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', provider_state: sync.status().provider_state }));
      return;
    }
    if (path !== '/mcp') { res.writeHead(404); res.end(); return; }
    const origin = req.headers.origin;
    if (origin) {
      let allowed = false;
      try { allowed = new URL(origin).host === req.headers.host; } catch { /* malformed Origin */ }
      if (!allowed) { res.writeHead(403); res.end(); return; }
    }
    if (!['GET', 'POST', 'DELETE'].includes(req.method ?? '')) { res.writeHead(405); res.end(); return; }
    const mcp = createMcpServer(database, sync);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void mcp.close(); });
    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res);
    } catch {
      if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: 'internal_error' })); }
    }
  });
}
