import { z } from 'zod';
const schema = z.object({
  DATABASE_PATH: z.string().min(1).default('/data/oscarplus.sqlite'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  SYNC_INTERVAL_HOURS: z.coerce.number().positive().default(4),
  LIVE_PROVIDER_ENABLED: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  AUTO_SYNC: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  OSCARPLUS_BATCH_LIMIT: z.coerce.number().int().min(1).max(1000).default(500),
  OSCARPLUS_SESSION_PATH: z.string().min(1).default('/auth-profile/session.json'),
});
export function loadConfig(env: NodeJS.ProcessEnv = process.env) { return schema.parse(env); }
// Credential access stays isolated for a later Docker Secret implementation.
export function loadCredentials(env: NodeJS.ProcessEnv = process.env): { username: string; password: string } | null {
  const username = env.OSCARPLUS_USERNAME?.trim();
  const password = env.OSCARPLUS_PASSWORD;
  return username && password ? { username, password } : null;
}
