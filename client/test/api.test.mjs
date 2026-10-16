import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { api, setAuth, getAuth, clearAuth } from '../src/api.js';

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};
beforeEach(() => setAuth({ accessToken: 'expired', refreshToken: 'refresh-old', user: { id: 1 } }));
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('parallel 401 responses share one refresh request', async () => {
  let refreshCount = 0;
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/auth/refresh')) {
      refreshCount++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return json({ accessToken: 'new', refreshToken: 'refresh-new' });
    }
    return options.headers.Authorization === 'Bearer new' ? json({ articles: [] }) : json({ error: 'expired' }, 401);
  };
  await Promise.all([api.articles(), api.daily(), api.me()]);
  assert.equal(refreshCount, 1);
  assert.equal(getAuth().refreshToken, 'refresh-new');
});

test('a delayed refresh cannot restore a signed-out session', async () => {
  let release;
  let started;
  const refreshing = new Promise((resolve) => { started = resolve; });
  globalThis.fetch = async (url) => {
    if (url.endsWith('/auth/refresh')) {
      started();
      return new Promise((resolve) => { release = resolve; });
    }
    return json({ error: 'expired' }, 401);
  };
  const pending = api.me();
  await refreshing;
  clearAuth();
  release(json({ accessToken: 'new', refreshToken: 'refresh-new' }));
  await assert.rejects(pending, { status: 401 });
  assert.equal(getAuth(), null);
});

test('temporary refresh failures preserve the session for retry', async () => {
  globalThis.fetch = async (url) => json({ error: 'unavailable' }, url.endsWith('/auth/refresh') ? 503 : 401);
  await assert.rejects(api.me(), { status: 503 });
  assert.equal(getAuth().refreshToken, 'refresh-old');
});
