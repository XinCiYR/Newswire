import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'newswire-smoke-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
process.env.SQLITE_PATH = path.join(dir, 'news.sqlite');
process.env.ENABLE_IN_PROCESS_CRON = 'false';
const { ensureSchema } = await import('../../server/src/db/migrate.js');
const { createApp } = await import('../../server/src/app.js');
const { getDb } = await import('../../server/src/db/database.js');
const { createSource } = await import('../../server/src/models/sources.js');
const { upsertArticle } = await import('../../server/src/models/articles.js');
let server;
try {
  await ensureSchema();
  const source = await createSource({ name: 'Smoke Source', url: 'https://test.example', feed_url: 'https://test.example/feed' });
  await upsertArticle({ sourceId: source.id, title: 'Smoke test news headline', summary: 'An isolated sample for frontend validation.',
    url: 'https://test.example/article', category: 'Tech', publishedAt: Date.now() });
  await new Promise((resolve) => { server = createApp().listen(0, '127.0.0.1', resolve); });
  process.env.SMOKE_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  await import('./smoke.mjs');
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await getDb().close();
  rmSync(process.env.SQLITE_PATH, { force: true });
  rmdirSync(dir);
}
