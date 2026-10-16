import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rateLimit } from '../src/middleware/rateLimit.js';

test('cron and auth limiters keep separate counters for the same IP', () => {
  const auth = rateLimit({ max: 2 });
  const cron = rateLimit({ max: 1 });
  const response = { setHeader() {}, status(code) { this.code = code; return this; }, json() {} };
  let passed = 0;
  auth({ ip: '127.0.0.1' }, response, () => passed++);
  cron({ ip: '127.0.0.1' }, response, () => passed++);
  auth({ ip: '127.0.0.1' }, response, () => passed++);
  assert.equal(passed, 3);
  cron({ ip: '127.0.0.1' }, response, () => passed++);
  assert.equal(response.code, 429);
});
