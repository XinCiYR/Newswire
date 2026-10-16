import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Load .env from the server directory (command is usually run from server/).
// Also load from the repo root as a fallback (some platform configs put it there).
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// server/ root
const serverRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(serverRoot, '.env') });
dotenv.config({ path: path.join(serverRoot, '..', '.env'), override: false });

function intEnv(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isSafeInteger(v) && v > 0 ? v : fallback;
}

function boolEnv(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(v);
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: intEnv('PORT', 4000),

  databaseUrl: process.env.DATABASE_URL || '',
  sqlitePath: process.env.SQLITE_PATH || './data/news.sqlite',

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'dev-access-secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
    accessTtl: intEnv('JWT_ACCESS_TTL', 900),
    refreshTtl: intEnv('JWT_REFRESH_TTL', 2592000),
  },

  scrape: {
    concurrency: Math.min(16, Math.floor(intEnv('SCRAPE_CONCURRENCY', 4))),
    timeoutMs: Math.floor(intEnv('SCRAPE_TIMEOUT_MS', 20000)),
    maxResponseBytes: Math.floor(intEnv('SCRAPE_MAX_RESPONSE_BYTES', 2 * 1024 * 1024)),
    intervalMinutes: intEnv('SCRAPE_INTERVAL_MINUTES', 30),
    cronSecret: process.env.CRON_SECRET || 'dev-cron-secret',
    enableInProcessCron: boolEnv('ENABLE_IN_PROCESS_CRON', true),
    // Retention / cleanup bounds (keeps the DB from growing unbounded).
    maxArticlesPerSource: intEnv('MAX_ARTICLES_PER_SOURCE', 1000),
    retentionDays: intEnv('ARTICLE_RETENTION_DAYS', 30),
    historyLimit: intEnv('HISTORY_LIMIT', 200),
    cleanupEnabled: boolEnv('CLEANUP_ENABLED', true),
  },

  daily: {
    limit: intEnv('DAILY_LIMIT', 10),
    categoryCap: intEnv('DAILY_CATEGORY_CAP', 3),
    windowHours: intEnv('DAILY_WINDOW_HOURS', 24),
    wFresh: Number(process.env.DAILY_W_FRESH || 0.2),
    wCross: Number(process.env.DAILY_W_CROSS || 0.5),
    wAuthority: Number(process.env.DAILY_W_AUTHORITY || 0.3),
  },

  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  adminUserIds: (process.env.ADMIN_USER_IDS || '').split(',').map((s) => Number(s.trim())).filter((id) => Number.isSafeInteger(id) && id > 0),
  trustProxy: /^\d+$/.test(process.env.TRUST_PROXY || '') ? Number(process.env.TRUST_PROXY) : 0,

  serverRoot,
};

if (config.env === 'production') {
  for (const [name, value] of [
    ['JWT_ACCESS_SECRET', config.jwt.accessSecret],
    ['JWT_REFRESH_SECRET', config.jwt.refreshSecret],
    ['CRON_SECRET', config.scrape.cronSecret],
  ]) {
    if (value.length < 32 || /^(dev-|change-me)/i.test(value)) {
      throw new Error(`${name} must be a unique random secret of at least 32 characters in production`);
    }
  }
  if (config.jwt.accessSecret === config.jwt.refreshSecret) {
    throw new Error('JWT access and refresh secrets must be different');
  }
}

export default config;
