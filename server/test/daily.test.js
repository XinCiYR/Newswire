import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateDatabase } from './helpers/database.js';

// Isolated database + no scheduler.
const cleanupDatabase = await isolateDatabase();
const { ensureSchema } = await import('../src/db/migrate.js');
const { getDb } = await import('../src/db/database.js');
const { createSource } = await import('../src/models/sources.js');
const { upsertArticle } = await import('../src/models/articles.js');
const { computeDaily, invalidateDaily } = await import('../src/services/daily.js');
const { default: config } = await import('../src/config.js');

let source;

before(async () => {
  await ensureSchema();
  source = await createSource({
    name: 'Daily Test Source',
    url: 'https://daily.test',
    feed_url: 'https://daily.test/feed.xml',
    authority: 4,
    enabled: 1,
  });
});

beforeEach(async () => {
  // Each scenario starts from an empty article set so windows don't overlap.
  await getDb().run('DELETE FROM articles_fts');
  await getDb().run('DELETE FROM articles');
  await getDb().run('DELETE FROM favorites');
  await getDb().run('DELETE FROM history');
  invalidateDaily();
});

after(async () => {
  try { await getDb().close(); }
  finally { await cleanupDatabase(); }
});

const CATEGORIES = ['AI', 'Tech', 'Finance', 'Business'];

/** Insert `count` articles published `ageMs` ago, spread over four categories. */
async function seed(count, ageMs, tag) {
  const publishedAt = Date.now() - ageMs;
  for (let i = 0; i < count; i++) {
    await upsertArticle({
      sourceId: source.id,
      title: `${tag} story number ${i} about technology and markets`,
      summary: `${tag} summary ${i}`,
      url: `https://daily.test/${tag}/${i}`,
      imageUrl: null,
      publishedAt,
      category: CATEGORIES[i % CATEGORIES.length],
      fetchedAt: Date.now(),
      fingerprint: null,
    });
  }
}

test('fresh stories produce a non-stale, day-window brief', async () => {
  await seed(12, 2 * 60 * 1000, 'fresh');
  const brief = await computeDaily();
  assert.equal(brief.meta.stale, false);
  assert.equal(brief.meta.windowHours, 24);
  assert.ok(brief.articles.length > 0);
  assert.equal(brief.articles.length, config.daily.limit);
  assert.ok(Date.now() - brief.meta.latestAt < 10 * 60 * 1000);
});

test('a quiet but fresh day returns the available stories without a stale flag', async () => {
  await seed(3, 2 * 3600 * 1000, 'quiet');
  const brief = await computeDaily();
  assert.equal(brief.meta.windowHours, 24);
  assert.equal(brief.meta.stale, false);
  assert.equal(brief.articles.length, 3);
});

test('a sparse day widens to 72h and flags itself as stale', async () => {
  await seed(12, 48 * 3600 * 1000, 'two-days');
  const brief = await computeDaily();
  assert.equal(brief.meta.windowHours, 72);
  assert.equal(brief.meta.stale, true);
  assert.ok(brief.articles.length > 0);
  // Never present 48h-old stories as "fresh".
  assert.ok(Date.now() - brief.meta.latestAt > 24 * 3600 * 1000);
});

test('an empty week falls back to the newest available stories instead of nothing', async () => {
  await seed(12, 40 * 86400 * 1000, 'old');
  const brief = await computeDaily();
  assert.ok(brief.articles.length > 0, 'brief must not be empty when articles exist');
  assert.equal(brief.meta.stale, true);
  assert.equal(brief.meta.windowHours, null);
  assert.ok(Date.now() - brief.meta.latestAt > 7 * 86400 * 1000);
});

test('with no articles at all the brief stays empty and not stale', async () => {
  const brief = await computeDaily();
  assert.deepEqual(brief.articles, []);
  assert.equal(brief.meta.stale, false);
  assert.equal(brief.meta.latestAt, null);
});
