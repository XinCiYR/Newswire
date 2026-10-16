import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { isolateDatabase } from './helpers/database.js';

// Isolated test database + no scheduler.
const cleanupDatabase = await isolateDatabase();
process.env.ADMIN_USER_IDS = '2';
process.env.TRUST_PROXY = '0';

const { ensureSchema } = await import('../src/db/migrate.js');
const { createApp } = await import('../src/app.js');
const { getDb } = await import('../src/db/database.js');
const { createSource } = await import('../src/models/sources.js');
const { upsertArticle } = await import('../src/models/articles.js');
const { fingerprint } = await import('../src/utils/text.js');
const { classify } = await import('../src/scraper/classify.js');
const { createUser } = await import('../src/models/users.js');
const { hashPassword } = await import('../src/auth/password.js');
const { issueTokens } = await import('../src/auth/sessions.js');
const { cleanupArticles } = await import('../src/db/cleanup.js');
const { invalidateDaily } = await import('../src/services/daily.js');

let server;
let base;
let reader;
let admin;

before(async () => {
  await ensureSchema();
  reader = await createUser('reader@example.com', await hashPassword('password123'));
  admin = await createUser('admin@example.com', await hashPassword('password123'));
  // Seed a source + a couple of articles so the user-flow tests have data.
  const source = await createSource({ name: 'Test Source', url: 'https://test.example', feed_url: 'https://test.example/feed.xml', enabled: 1 });
  const samples = [
    { title: 'OpenAI launches a new AI model for developers', summary: 'The new model improves coding and reasoning tasks.' },
    { title: 'Global markets rally after central bank surprise', summary: 'Equities climbed on the rate decision.' },
    { title: 'Election results change the political landscape', summary: 'Voters turned out in record numbers.' },
  ];
  const now = Date.now();
  for (let i = 0; i < samples.length; i++) {
    const { category } = classify(samples[i].title, samples[i].summary);
    await upsertArticle({
      sourceId: source.id,
      title: samples[i].title,
      summary: samples[i].summary,
      url: `https://test.example/article/${i + 1}`,
      imageUrl: null,
      publishedAt: now - i * 60000,
      category,
      fetchedAt: now,
      fingerprint: fingerprint(samples[i].title),
    });
  }

  const app = createApp();
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  try { await getDb().close(); }
  finally { await cleanupDatabase(); }
});

async function jfetch(path, { method = 'GET', token, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(base + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

test('health & categories are reachable', async () => {
  const h = await jfetch('/api/health');
  assert.equal(h.status, 200);
  assert.equal(h.json.ok, true);
  assert.equal(h.json.version, '1.5.0');

  const c = await jfetch('/api/categories');
  assert.equal(c.status, 200);
  assert.ok(Array.isArray(c.json.categories));
});

test('articles list & search work', async () => {
  const list = await jfetch('/api/articles?limit=5');
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.json.articles));
  assert.ok(list.json.total >= 0);

  const q = encodeURIComponent('AI');
  const search = await jfetch(`/api/articles?q=${q}&limit=25`);
  assert.equal(search.status, 200);
  assert.ok(Array.isArray(search.json.articles));
});

test('register -> login -> me -> refresh', async () => {
  const email = `u${randomUUID().slice(0, 8)}@example.com`;
  const password = 'password123';

  const reg = await jfetch('/api/auth/register', { method: 'POST', body: { email, password } });
  assert.equal(reg.status, 201, JSON.stringify(reg.json));
  assert.ok(reg.json.accessToken && reg.json.refreshToken && reg.json.user.email === email);

  const me = await jfetch('/api/auth/me', { token: reg.json.accessToken });
  assert.equal(me.status, 200);
  assert.equal(me.json.user.email, email);

  const refresh = await jfetch('/api/auth/refresh', { method: 'POST', body: { refreshToken: reg.json.refreshToken } });
  assert.equal(refresh.status, 200);
  assert.ok(refresh.json.accessToken && refresh.json.refreshToken);

  // duplicate register rejected
  const dup = await jfetch('/api/auth/register', { method: 'POST', body: { email, password } });
  assert.equal(dup.status, 409);

  // valid login
  const login = await jfetch('/api/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(login.status, 200);
  assert.ok(login.json.accessToken);

  // bad login rejected
  const bad = await jfetch('/api/auth/login', { method: 'POST', body: { email, password: 'wrongpass123' } });
  assert.equal(bad.status, 401);
});

test('favorite add/list/remove and history view/clear', async () => {
  const email = `u${randomUUID().slice(0, 8)}@example.com`;
  const password = 'password123';
  const reg = await jfetch('/api/auth/register', { method: 'POST', body: { email, password } });
  const token = reg.json.accessToken;

  const list = await jfetch('/api/articles?limit=1');
  assert.ok(list.json.articles.length > 0, 'expected at least one article');
  const article = list.json.articles[0];

  // unauthorized favorite rejected
  const noAuth = await jfetch(`/api/favorites/${article.id}`, { method: 'POST' });
  assert.equal(noAuth.status, 401);

  // add favorite
  const add = await jfetch(`/api/favorites/${article.id}`, { method: 'POST', token });
  assert.equal(add.status, 200);

  // list includes it
  const favs = await jfetch('/api/favorites', { token });
  assert.ok(favs.json.articles.some((a) => a.id === article.id));

  // record a view + history
  const view = await jfetch(`/api/articles/${article.id}/view`, { method: 'POST', token });
  assert.equal(view.status, 200);
  const hist = await jfetch('/api/history', { token });
  assert.ok(hist.json.articles.some((a) => a.id === article.id));

  // remove favorite
  const rem = await jfetch(`/api/favorites/${article.id}`, { method: 'DELETE', token });
  assert.equal(rem.status, 200);
  const favs2 = await jfetch('/api/favorites', { token });
  assert.ok(!favs2.json.articles.some((a) => a.id === article.id));

  // clear history
  const clr = await jfetch('/api/history', { method: 'DELETE', token });
  assert.equal(clr.status, 200);
  const hist2 = await jfetch('/api/history', { token });
  assert.equal(hist2.json.articles.length, 0);
});

test('detail endpoint + category correction (auth)', async () => {
  const list = await jfetch('/api/articles?limit=1');
  const article = list.json.articles[0];
  const det = await jfetch(`/api/articles/${article.id}`);
  assert.equal(det.status, 200);
  assert.ok(det.json.article.title);

  const cat = await jfetch(`/api/articles/${article.id}/category`, {
    method: 'PATCH',
    token: null,
    body: { category: 'Tech' },
  });
  // correction is authenticated
  assert.equal(cat.status, 401);
});

test('administrative writes reject ordinary users and validate URLs', async () => {
  const token = (await issueTokens(reader)).accessToken;
  const adminToken = (await issueTokens(admin)).accessToken;
  const article = (await jfetch('/api/articles?limit=1')).json.articles[0];
  assert.equal((await jfetch(`/api/articles/${article.id}/category`, {
    method: 'PATCH', token, body: { category: 'Tech' },
  })).status, 403);
  const sourceBody = { name: 'Internal probe', url: 'https://test.example', feed_url: 'http://127.0.0.1/private' };
  assert.equal((await jfetch('/api/sources', { method: 'POST', token, body: sourceBody })).status, 403);
  assert.equal((await jfetch('/api/sources', {
    method: 'POST', token: adminToken, body: { ...sourceBody, url: 'javascript:alert(1)' },
  })).status, 400);
  assert.equal((await jfetch(`/api/articles/${article.id}/category`, {
    method: 'PATCH', token: adminToken, body: { category: 'Tech' },
  })).status, 200);
  const me = await jfetch('/api/auth/me', { token: adminToken });
  assert.equal(me.json.user.isAdmin, true);
  assert.equal((await jfetch('/api/auth/me', { token })).json.user.isAdmin, false);
});

test('refresh tokens are single-use under concurrent requests and logout revokes both token types', async () => {
  const session = await issueTokens(reader);
  const results = await Promise.all([1, 2].map(() => jfetch('/api/auth/refresh', {
    method: 'POST', body: { refreshToken: session.refreshToken },
  })));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 401]);
  const rotated = results.find((r) => r.status === 200).json;
  assert.notEqual(rotated.refreshToken, session.refreshToken);
  assert.equal((await jfetch('/api/auth/refresh', {
    method: 'POST', body: { refreshToken: session.refreshToken },
  })).status, 401);
  assert.equal((await jfetch('/api/auth/logout', { method: 'POST', token: rotated.accessToken })).status, 200);
  assert.equal((await jfetch('/api/auth/me', { token: rotated.accessToken })).status, 401);
  assert.equal((await jfetch('/api/auth/refresh', {
    method: 'POST', body: { refreshToken: rotated.refreshToken },
  })).status, 401);
});

test('daily cache never shares one user\'s favorite flags with another request', async () => {
  const user = await createUser('daily@example.com', await hashPassword('password123'));
  const token = (await issueTokens(user)).accessToken;
  invalidateDaily();
  const article = (await jfetch('/api/daily')).json.articles[0];
  await jfetch(`/api/favorites/${article.id}`, { method: 'POST', token });
  const own = await jfetch('/api/daily', { token });
  assert.equal(own.json.articles.find((a) => a.id === article.id).favorited, true);
  const anonymous = await jfetch('/api/daily');
  assert.ok(anonymous.json.articles.every((a) => a.favorited === undefined));
  const otherToken = (await issueTokens(admin)).accessToken;
  const [first, second] = await Promise.all([
    jfetch('/api/daily', { token }), jfetch('/api/daily', { token: otherToken }),
  ]);
  assert.equal(first.json.articles.find((a) => a.id === article.id).favorited, true);
  assert.equal(second.json.articles.find((a) => a.id === article.id).favorited, false);
});

test('search honors time filters, punctuation is safe, and pagination is bounded', async () => {
  const source = await getDb().get('SELECT id FROM sources LIMIT 1');
  const old = await upsertArticle({ sourceId: source.id, title: 'Obsolete AI model announcement',
    url: 'https://test.example/old', category: 'AI', publishedAt: Date.now() - 40 * 86400000 });
  const recent = await jfetch(`/api/articles?q=AI&since=${Date.now() - 86400000}`);
  assert.equal(recent.status, 200);
  assert.ok(recent.json.articles.length > 0);
  assert.ok(recent.json.articles.every((a) => a.id !== old.article.id));
  const punctuation = await jfetch('/api/articles?q=%21%21%21');
  assert.equal(punctuation.status, 200);
  assert.equal(punctuation.json.total, 0);
  assert.equal((await jfetch('/api/articles?limit=-1')).status, 400);
  assert.equal((await jfetch('/api/articles/1/related?limit=-1')).status, 400);
  assert.equal((await jfetch('/api/articles?sourceId=invalid')).status, 400);
  const token = (await issueTokens(admin)).accessToken;
  assert.equal((await jfetch('/api/favorites?limit=-1', { token })).status, 400);
  assert.equal((await jfetch('/api/history?limit=-1', { token })).status, 400);
  await jfetch(`/api/favorites/${old.article.id}`, { method: 'POST', token });
  await cleanupArticles();
  assert.ok(await getDb().get('SELECT id FROM articles WHERE id = ?', [old.article.id]), 'favorite must survive cleanup');
});

test('SPA deep links bypass HTML caching and changelog is packaged', async () => {
  assert.equal((await jfetch('/api/changelog')).status, 200);
  const response = await fetch(`${base}/article/1`);
  if (response.status === 200) assert.match(response.headers.get('cache-control'), /no-store/);
});
