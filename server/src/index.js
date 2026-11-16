import config from './config.js';
import { ensureSchema } from './db/migrate.js';
import { createApp } from './app.js';
import { startScheduler, ensureFreshData } from './scraper/index.js';
import { getDb } from './db/database.js';
import { NEWS_SOURCES } from './scraper/sources.js';
import { createSource } from './models/sources.js';

/** Seed the default news sources once, when the sources table is empty. */
async function ensureSources() {
  const row = await getDb().get('SELECT COUNT(*) AS n FROM sources');
  if (!Number(row?.n)) {
    for (const s of NEWS_SOURCES) {
      await createSource(s);
    }
    console.log(`[bootstrap] seeded ${NEWS_SOURCES.length} default sources`);
  }
}

async function main() {
  await ensureSchema();
  await ensureSources();
  const app = createApp();

  const server = app.listen(config.port, () => {
    console.log(`[server] listening on http://localhost:${config.port} (${config.env})`);
  });

  // Self-healing ingestion: when a request wakes a sleeping free-tier instance
  // and the data is stale, run one catch-up scrape in the background.
  server.on('request', () => { ensureFreshData().catch(() => {}); });

  // Graceful shutdown.
  const shutdown = async (sig) => {
    console.log(`\n[server] ${sig} received, shutting down...`);
    server.close(async () => {
      try { await getDb().close(); } catch { /* ignore */ }
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 4000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Start the in-process scraper (initial + periodic runs).
  startScheduler();
}

main().catch((e) => {
  console.error('[server] failed to start', e);
  process.exit(1);
});
