import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import { isolateDatabase } from './helpers/database.js';

const cleanupDatabase = await isolateDatabase();
const { ensureSchema } = await import('../src/db/migrate.js');
const { getDb } = await import('../src/db/database.js');
const { fetchFeed } = await import('../src/scraper/fetch.js');
const { runScrapeCycle } = await import('../src/scraper/worker.js');
const { createSource } = await import('../src/models/sources.js');
const { default: config } = await import('../src/config.js');
let server;
let base;
let active = 0;
let peak = 0;
const conditionalRequests = [];
let brokenArticle = true;
const modified = 'Wed, 14 Oct 2026 08:00:00 GMT';
const feed = (key, link = `https://test.example/${key}`) => `<?xml version="1.0"?><rss version="2.0"><channel>
  <title>Test feed</title><link>https://test.example</link><description>Local fixture</description>
  <item><title>Technology research ${key}</title><link>${link}</link><description>Software and chips.</description>
  <pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`;

before(async () => {
  await ensureSchema();
  server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/rss+xml');
    if (req.url === '/conditional' || req.url === '/write-failure') {
      conditionalRequests.push({ path: req.url, etag: req.headers['if-none-match'], modified: req.headers['if-modified-since'] });
      const tag = req.url === '/conditional' ? '"v1"' : '"failed-v1"';
      res.setHeader('ETag', tag);
      res.setHeader('Last-Modified', modified);
      if (req.headers['if-none-match'] === tag) { res.writeHead(304); res.end(); return; }
      const xml = feed(req.url, req.url === '/write-failure' && brokenArticle ? `https://test.example/${'x'.repeat(150)}` : undefined);
      res.end(xml);
    } else if (req.url.startsWith('/work/')) {
      active++;
      peak = Math.max(active, peak);
      res.once('close', () => { active--; });
      setTimeout(() => res.end(feed(req.url)), 35);
    } else if (req.url === '/large-length') {
      res.writeHead(200, { 'Content-Length': '100000' }); res.end('too large');
    } else if (req.url === '/chunked') {
      res.write('x'.repeat(80)); res.end('x'.repeat(80));
    } else if (req.url === '/compressed') {
      const compressed = gzipSync(feed('gzip') + ' '.repeat(10000));
      res.writeHead(200, { 'Content-Encoding': 'gzip', 'Content-Length': compressed.length }); res.end(compressed);
    } else if (req.url === '/slow-body') {
      res.write('<rss>'); setTimeout(() => res.end('</rss>'), 200);
    } else if (req.url === '/slow-headers') {
      setTimeout(() => res.end(feed('slow')), 200);
    } else if (req.url === '/broken') {
      res.end('<rss><broken>');
    } else if (req.url === '/unavailable') {
      res.writeHead(503); res.end('unavailable');
    } else if (req.url === '/atom') {
      res.end(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title>
        <entry><title>AI research</title><id>urn:test:1</id><link href="https://test.example/atom"/>
        <summary>A short report.</summary><updated>${new Date().toISOString()}</updated></entry></feed>`);
    } else {
      res.end(feed('normal'));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  try { await getDb().close(); } finally { await cleanupDatabase(); }
});

test('RSS and Atom parsing preserve normalized article data', async () => {
  for (const endpoint of ['/normal', '/atom']) {
    const result = await fetchFeed(base + endpoint);
    assert.equal(result.notModified, false);
    assert.equal(result.items.length, 1);
    assert.ok(result.items[0].publishedAt > 0);
    assert.match(result.items[0].url, /^https:\/\/test\.example/);
  }
});

test('conditional GET sends both validators and treats 304 as a successful no-op', async () => {
  const first = await fetchFeed(base + '/conditional');
  assert.equal(first.etag, '"v1"');
  const second = await fetchFeed(base + '/conditional', { etag: first.etag, lastModified: first.lastModified });
  assert.equal(second.notModified, true);
  assert.deepEqual(second.items, []);
  assert.equal(second.etag, first.etag);
  assert.equal(conditionalRequests.at(-1).modified, modified);
});

test('response size cap covers content-length, streaming and decompressed bytes', async () => {
  for (const [endpoint, maxBytes] of [['/large-length', 64], ['/chunked', 64], ['/compressed', 1024]]) {
    await assert.rejects(fetchFeed(base + endpoint, { maxBytes }), /byte limit/, endpoint);
  }
});

test('timeout bounds both headers and body, while HTTP and parse failures stay visible', async () => {
  for (const endpoint of ['/slow-headers', '/slow-body']) {
    await assert.rejects(fetchFeed(base + endpoint, { timeoutMs: 30 }), /abort|timeout/i);
  }
  await assert.rejects(fetchFeed(base + '/unavailable'), /HTTP 503/);
  await assert.rejects(fetchFeed(base + '/broken'));
});

test('worker bounds actual network concurrency and still ingests every source', async () => {
  await getDb().run('UPDATE sources SET enabled = 0');
  for (const topic of ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta']) {
    await createSource({ name: `Concurrent ${topic}`, url: 'https://test.example', feed_url: `${base}/work/${topic}` });
  }
  const previous = config.scrape.concurrency;
  config.scrape.concurrency = 2;
  peak = 0;
  try {
    const result = await runScrapeCycle();
    assert.equal(result.totalInserted, 6);
    assert.equal(result.errors.length, 0);
    assert.equal(peak, 2, 'six sources must never create more than two simultaneous HTTP requests');
  } finally { config.scrape.concurrency = previous; }
});

test('worker persists validators and 304 clears backoff without reinserting', async () => {
  const db = getDb();
  await db.run('UPDATE sources SET enabled = 0');
  const source = await createSource({ name: 'Conditional', url: 'https://test.example', feed_url: `${base}/conditional` });
  const first = await runScrapeCycle();
  assert.equal(first.totalFetched, 1);
  assert.equal((await db.get('SELECT etag FROM sources WHERE id = ?', [source.id])).etag, '"v1"');
  await db.run('UPDATE sources SET fail_count = 2, last_error = ? WHERE id = ?', ['previous error', source.id]);
  const second = await runScrapeCycle();
  assert.equal(second.totalNotModified, 1);
  assert.equal(second.totalInserted, 0);
  assert.equal(second.errors.length, 0);
  const stored = await db.get('SELECT * FROM sources WHERE id = ?', [source.id]);
  assert.equal(Number(stored.fail_count), 0);
  assert.equal(stored.last_error, null);
  assert.equal(stored.etag, '"v1"');
});

test('failed writes are reported and do not save validators that would suppress retries', async () => {
  const db = getDb();
  await db.run('UPDATE sources SET enabled = 0');
  const source = await createSource({ name: 'Write failure', url: 'https://test.example', feed_url: `${base}/write-failure` });
  // A real database constraint fails this article, instead of mocking repository code.
  if (db.isPg) await db.exec('ALTER TABLE articles ADD CONSTRAINT test_url_length CHECK (length(url) < 120)');
  else await db.exec(`CREATE TRIGGER test_url_length BEFORE INSERT ON articles
    WHEN length(NEW.url) >= 120 BEGIN SELECT RAISE(ABORT, 'test URL length'); END`);
  try {
    const first = await runScrapeCycle();
    assert.equal(first.sources[0].failed, 1);
    assert.ok(first.errors.some((error) => error.error.startsWith('insert:')));
    assert.equal((await db.get('SELECT etag FROM sources WHERE id = ?', [source.id])).etag, null);
    brokenArticle = false;
    await db.run('UPDATE sources SET next_retry_at = NULL WHERE id = ?', [source.id]);
    const retry = await runScrapeCycle();
    assert.equal(retry.totalNotModified, 0);
    assert.equal(retry.totalInserted, 1);
    assert.equal(conditionalRequests.at(-1).etag, undefined);
  } finally {
    if (db.isPg) await db.exec('ALTER TABLE articles DROP CONSTRAINT test_url_length');
    else await db.exec('DROP TRIGGER test_url_length');
  }
});
