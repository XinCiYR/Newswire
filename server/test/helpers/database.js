import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

/** Tests never use DATABASE_URL. PostgreSQL gets its own disposable schema per process. */
export async function isolateDatabase() {
  process.env.NODE_ENV = 'test';
  process.env.ENABLE_IN_PROCESS_CRON = 'false';
  process.env.TRUST_PROXY = '0';
  const testUrl = process.env.TEST_DATABASE_URL;
  if (testUrl) {
    const schema = `nw_test_${randomUUID().replaceAll('-', '')}`;
    const owner = new pg.Pool({ connectionString: testUrl, connectionTimeoutMillis: 10000 });
    try {
      await owner.query(`CREATE SCHEMA "${schema}"`);
    } catch (error) {
      await owner.end();
      throw error;
    }
    const url = new URL(testUrl);
    url.searchParams.set('options', `-c search_path=${schema},public`);
    process.env.DATABASE_URL = url.href;
    return async () => {
      try { await owner.query(`DROP SCHEMA "${schema}" CASCADE`); }
      finally { await owner.end(); }
    };
  }
  process.env.DATABASE_URL = '';
  const dir = mkdtempSync(path.join(tmpdir(), 'newswire-test-'));
  const sqlitePath = path.join(dir, 'news.sqlite');
  process.env.SQLITE_PATH = sqlitePath;
  return async () => {
    rmSync(sqlitePath, { force: true });
    rmdirSync(dir);
  };
}
