import { loadConfig, loadCredentials } from './config.js';
import { JobDatabase } from './database.js';
import { createHttpServer } from './http.js';
import { LiveOscarPlusProvider } from './provider.js';
import { SyncService } from './sync.js';

const config = loadConfig();
const database = new JobDatabase(config.DATABASE_PATH);
const credentials = loadCredentials();
if (config.LIVE_PROVIDER_ENABLED && !credentials) throw new Error('live_provider_credentials_missing');
const provider = config.LIVE_PROVIDER_ENABLED && credentials ? new LiveOscarPlusProvider({
  ...credentials, sessionPath: config.OSCARPLUS_SESSION_PATH, batchLimit: config.OSCARPLUS_BATCH_LIMIT,
}) : null;
const sync = new SyncService(database, provider);
const stopScheduler = config.AUTO_SYNC ? sync.startScheduler(config.SYNC_INTERVAL_HOURS) : () => {};
const http = createHttpServer(database, sync);
http.listen(config.PORT, '0.0.0.0', () => console.log(`oscarplus-mcp listening on ${config.PORT}`));
function shutdown() { stopScheduler(); http.close(() => { database.close(); process.exit(0); }); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
