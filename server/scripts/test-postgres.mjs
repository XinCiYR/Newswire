import { spawnSync } from 'node:child_process';

if (!process.env.TEST_DATABASE_URL) {
  console.error('Set TEST_DATABASE_URL to a dedicated local/CI PostgreSQL database; DATABASE_URL is never used by tests.');
  process.exit(1);
}
const result = spawnSync(process.execPath, ['--test', 'test/*.test.js'], {
  cwd: new URL('..', import.meta.url), env: process.env, stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
