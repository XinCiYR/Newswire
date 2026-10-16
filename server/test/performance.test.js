import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateDatabase } from './helpers/database.js';

const cleanupDatabase = await isolateDatabase();
const { ensureSchema } = await import('../src/db/migrate.js');
const { getDb } = await import('../src/db/database.js');
const { createApp } = await import('../src/app.js');
const { createSource } = await import('../src/models/sources.js');
const { upsertArticle, listArticles } = await import('../src/models/articles.js');
const { createUser } = await import('../src/models/users.js');
const { issueTokens } = await import('../src/auth/sessions.js');
const { addFavorite, withFavoriteState } = await import('../src/models/favorites.js');
const { recordView } = await import('../src/models/history.js');
const { articleSearchVector } = await import('../src/db/search.js');
let server;
let base;
let user;
let token;
let source;
const ids = [];

before(async () => {
  await ensureSchema();
  source = await createSource({ name: 'Performance Source', url: 'https://test.example', feed_url: 'https://test.example/feed' });
  user = await createUser('perf@example.com', 'unused-in-this-test');
  token = (await issueTokens(user)).accessToken;
  for (let i = 0; i < 100; i++) {
    const result = await upsertArticle({ sourceId: source.id, title: `Performance search story ${i}`, summary: 'A searchable technology report.',
      url: `https://test.example/perf/${i}`, category: 'Tech', publishedAt: Date.now() - i * 1000, fingerprint: `perf-${i}` });
    ids.push(result.article.id);
  }
  for (const id of [ids[0], ids[99]]) await addFavorite(user.id, id);
  for (const id of ids.slice(0, 3)) await recordView(user.id, id);
  await new Promise((resolve) => { server = createApp().listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  try { await getDb().close(); } finally { await cleanupDatabase(); }
});

test('100-row article/search pages and other list endpoints use one favorite query each', async () => {
  const db = getDb();
  const originalAll = db.all;
  const originalGet = db.get;
  let queries = 0;
  const count = (sql) => { if (/\bFROM favorites\b/i.test(sql)) queries++; };
  db.all = function (sql, params) { count(sql); return originalAll.call(this, sql, params); };
  db.get = function (sql, params) { count(sql); return originalGet.call(this, sql, params); };
  try {
    for (const route of ['/api/articles?limit=100', '/api/articles?q=performance&limit=100', '/api/daily', `/api/articles/${ids[0]}/related`, '/api/history']) {
      queries = 0;
      const response = await fetch(base + route, { headers: { authorization: `Bearer ${token}` } });
      assert.equal(response.status, 200, route);
      const { articles } = await response.json();
      assert.ok(articles.length > 0);
      if (route.includes('limit=100')) assert.equal(articles.length, 100);
      assert.equal(queries, 1, `${route} must use exactly one favorite lookup`);
      for (const article of articles) assert.equal(article.favorited, [ids[0], ids[99]].includes(article.id));
    }
    queries = 0;
    await fetch(base + '/api/articles?limit=100');
    assert.equal(queries, 0, 'anonymous lists need no favorite lookup');
  } finally {
    db.all = originalAll;
    db.get = originalGet;
  }
});

test('batch decoration preserves input objects and isolates users, including empty pages', async () => {
  const article = Object.freeze({ id: ids[0], title: 'shared cache' });
  const decorated = await withFavoriteState(user.id, [article]);
  assert.equal(decorated[0].favorited, true);
  assert.equal(article.favorited, undefined);
  const other = await createUser('other-perf@example.com', 'unused');
  assert.equal((await withFavoriteState(other.id, [article]))[0].favorited, false);
  assert.deepEqual(await withFavoriteState(user.id, []), []);
});

test('index migration is repeatable and source/fingerprint queries can use their indexes', async () => {
  await ensureSchema();
  const db = getDb();
  if (db.isPg) {
    const indexes = await db.all(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = current_schema()`);
    for (const name of ['idx_articles_fingerprint_pub', 'idx_articles_source_pub', 'idx_articles_search']) {
      assert.ok(indexes.some((row) => row.indexname === name), name);
    }
    assert.match(indexes.find((row) => row.indexname === 'idx_articles_search').indexdef, /USING gin/i);
    // Disable seqscan in a transaction only: this tiny fixture should not dictate the planner's cost choice.
    await db.transaction(async (tx) => {
      await tx.run('SET LOCAL enable_seqscan = off');
      const plans = await tx.all(`EXPLAIN (FORMAT JSON) SELECT id FROM articles a
        WHERE ${articleSearchVector('a')} @@ plainto_tsquery('english', ?)`, ['technology']);
      assert.match(JSON.stringify(plans), /idx_articles_search/);
    });
  } else {
    const sourcePlan = await db.all('EXPLAIN QUERY PLAN SELECT id FROM articles WHERE source_id = ? ORDER BY published_at DESC, id DESC LIMIT 10', [source.id]);
    const fpPlan = await db.all('EXPLAIN QUERY PLAN SELECT id FROM articles WHERE fingerprint = ? ORDER BY published_at DESC LIMIT 1', ['perf-1']);
    assert.match(JSON.stringify(sourcePlan), /idx_articles_source_pub/);
    assert.match(JSON.stringify(fpPlan), /idx_articles_fingerprint_pub/);
  }
});

test('search index stays correct after inserts, updates and deletes', async () => {
  const result = await upsertArticle({ sourceId: source.id, title: 'Zebracomet satellite', summary: 'Orbit research.',
    url: 'https://test.example/index-sync', category: 'Tech', publishedAt: Date.now() });
  assert.ok((await listArticles({ q: 'zebracomet' })).articles.some((article) => article.id === result.article.id));
  if (getDb().isPg) {
    await getDb().run('UPDATE articles SET title = ? WHERE id = ?', ['Quartzfalcon satellite', result.article.id]);
    assert.equal((await listArticles({ q: 'zebracomet' })).total, 0);
    assert.equal((await listArticles({ q: 'quartzfalcon' })).total, 1);
  }
  await getDb().run('DELETE FROM articles WHERE id = ?', [result.article.id]);
  assert.equal((await listArticles({ q: 'zebracomet' })).total, 0);
  assert.equal((await listArticles({ q: 'quartzfalcon' })).total, 0);
});
