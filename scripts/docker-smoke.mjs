import { spawnSync } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const id = `nw-test-${randomUUID().slice(0, 8)}`;
const image = `${id}:local`;
const network = `${id}-network`;
const database = `${id}-postgres`;
const containers = [];
const volumes = [];
let built = false;
let networkCreated = false;

function docker(args, { allowFailure = false, stream = false, timeout = 120000 } = {}) {
  const result = spawnSync('docker', args, { cwd, encoding: 'utf8', stdio: stream ? 'inherit' : 'pipe', timeout });
  if (result.error && !allowFailure) throw new Error(`Docker unavailable: ${result.error.message}`);
  if (result.status !== 0 && !allowFailure) throw new Error(`docker ${args[0]} failed: ${result.stderr || result.error?.message || result.status}`);
  return result.stdout?.trim() || '';
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check, label) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch { /* wait for startup */ }
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function verify(mode) {
  const name = `${id}-${mode}`;
  const volume = `${name}-data`;
  volumes.push(volume);
  docker(['volume', 'create', volume]);
  containers.push(name);
  const args = ['run', '-d', '--name', name, '--network', network, '-p', '127.0.0.1::4000',
    '-e', 'ENABLE_IN_PROCESS_CRON=false', '-e', `JWT_ACCESS_SECRET=${randomBytes(32).toString('hex')}`,
    '-e', `JWT_REFRESH_SECRET=${randomBytes(32).toString('hex')}`, '-e', `CRON_SECRET=${randomBytes(32).toString('hex')}`,
    '-v', `${volume}:/app/server/data`];
  if (mode === 'pg') args.push('-e', `DATABASE_URL=postgres://newswire_test:local_ci_password@${database}:5432/newswire_test`);
  args.push(image);
  docker(args);
  const port = docker(['port', name, '4000/tcp']).split(':').at(-1);
  const base = `http://127.0.0.1:${port}`;
  await waitFor(async () => (await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) })).ok, name);
  const request = async (url, { token, method = 'GET', body } = {}) => {
    const response = await fetch(base + url, { method, signal: AbortSignal.timeout(5000),
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await response.json();
    assert.ok(response.ok, `${mode} ${url}: ${response.status} ${JSON.stringify(json)}`);
    return json;
  };
  assert.equal((await request('/api/sources')).sources.length, 10);
  assert.ok((await request('/api/changelog')).entries.length > 0, 'changelog survives a mounted data volume');
  const htmlResponse = await fetch(`${base}/article/1`);
  assert.match(htmlResponse.headers.get('cache-control'), /no-store/);
  const html = await htmlResponse.text();
  const asset = html.match(/src="(\/assets\/[^\"]+\.js)"/)?.[1];
  assert.ok(asset, 'built frontend entry exists');
  assert.equal((await fetch(base + asset)).status, 200);
  // This writes only inside the disposable test container/database.
  docker(['exec', name, 'node', '--input-type=module', '-e', `
    const { getDb } = await import('./src/db/database.js');
    const { upsertArticle } = await import('./src/models/articles.js');
    const source = await getDb().get('SELECT id FROM sources LIMIT 1');
    await upsertArticle({ sourceId: source.id, title: 'Docker smoke article', summary: 'Container validation.',
      url: 'https://test.example/docker', category: 'Tech', publishedAt: Date.now() });
    await getDb().close();`]);
  const article = (await request('/api/articles?limit=1')).articles[0];
  const credentials = { email: 'docker@example.com', password: 'test-password-123' };
  const session = await request('/api/auth/register', { method: 'POST', body: credentials });
  await request(`/api/favorites/${article.id}`, { method: 'POST', token: session.accessToken });
  await request(`/api/articles/${article.id}/view`, { method: 'POST', token: session.accessToken });
  assert.equal((await request('/api/favorites', { token: session.accessToken })).total, 1);
  assert.equal((await request('/api/history', { token: session.accessToken })).total, 1);
  const rotated = await request('/api/auth/refresh', { method: 'POST', body: { refreshToken: session.refreshToken } });
  assert.notEqual(rotated.refreshToken, session.refreshToken);
  docker(['restart', name]);
  await waitFor(async () => (await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) })).ok, `${name} restart`);
  const login = await request('/api/auth/login', { method: 'POST', body: credentials });
  assert.equal((await request('/api/favorites', { token: login.accessToken })).total, 1);
  assert.equal((await request('/api/articles?q=docker')).total, 1);
  console.log(`[docker-smoke] ${mode}: startup, assets, changelog, auth, favorites, history, search and restart persistence passed`);
}

try {
  docker(['info'], { timeout: 15000 });
  built = true;
  docker(['build', '-t', image, '.'], { stream: true, timeout: 900000 });
  docker(['network', 'create', network]);
  networkCreated = true;
  containers.push(database);
  docker(['run', '-d', '--name', database, '--network', network,
    '-e', 'POSTGRES_USER=newswire_test', '-e', 'POSTGRES_PASSWORD=local_ci_password', '-e', 'POSTGRES_DB=newswire_test',
    'postgres:16-alpine']);
  await waitFor(() => docker(['exec', database, 'pg_isready', '-U', 'newswire_test', '-d', 'newswire_test'], { allowFailure: true }).includes('accepting connections'), 'PostgreSQL');
  await verify('sqlite');
  await verify('pg');
} catch (error) {
  for (const name of containers) {
    const logs = docker(['logs', '--tail', '100', name], { allowFailure: true });
    if (logs) console.error(logs);
  }
  throw error;
} finally {
  for (const name of containers.reverse()) docker(['rm', '-fv', name], { allowFailure: true });
  for (const volume of volumes) docker(['volume', 'rm', volume], { allowFailure: true });
  if (networkCreated) docker(['network', 'rm', network], { allowFailure: true });
  if (built) docker(['image', 'rm', image], { allowFailure: true });
}
