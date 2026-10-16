import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const configUrl = new URL('../src/config.js', import.meta.url).href;
const secrets = {
  JWT_ACCESS_SECRET: 'a'.repeat(48), JWT_REFRESH_SECRET: 'b'.repeat(48), CRON_SECRET: 'c'.repeat(48),
};
const check = (extra) => spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(configUrl)})`], {
  env: { ...process.env, NODE_ENV: 'production', ...secrets, ...extra }, encoding: 'utf8',
});

test('production rejects development secrets and reused JWT secrets', () => {
  assert.equal(check({}).status, 0);
  assert.notEqual(check({ JWT_ACCESS_SECRET: 'dev-access-secret' }).status, 0);
  assert.notEqual(check({ CRON_SECRET: 'change-me-cron' }).status, 0);
  assert.notEqual(check({ JWT_REFRESH_SECRET: secrets.JWT_ACCESS_SECRET }).status, 0);
});
