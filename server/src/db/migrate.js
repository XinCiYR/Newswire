import getDb from './database.js';
import { schema } from './schema.js';

/** Create tables/indexes if they don't exist. Safe to call on every boot. */
export async function ensureSchema() {
  const db = getDb();
  await db.testConnection();
  const dialect = db.isPg ? 'pg' : 'sqlite';
  const stmts = schema(dialect);
  const tables = stmts.filter((s) => !/CREATE INDEX/i.test(s));
  const indexes = stmts.filter((s) => /CREATE INDEX/i.test(s));

  // 1) Tables first.
  for (const stmt of tables) {
    await db.exec(stmt);
  }
  if (!db.isPg) {
    await db.exec('PRAGMA foreign_keys = ON');
    await db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(title, summary, tokenize='porter')");
  }

  // 2) Add any columns missing from pre-existing databases (before indexes).
  await addColumnIfMissing(db, 'users', 'name', 'TEXT');
  await addColumnIfMissing(db, 'articles', 'views', 'INTEGER NOT NULL DEFAULT 0');
  await addColumnIfMissing(db, 'sources', 'last_fetched_at', 'BIGINT');
  await addColumnIfMissing(db, 'sources', 'last_error', 'TEXT');
  await addColumnIfMissing(db, 'sources', 'fail_count', 'INTEGER NOT NULL DEFAULT 0');
  await addColumnIfMissing(db, 'sources', 'next_retry_at', 'BIGINT');
  await addColumnIfMissing(db, 'sources', 'authority', 'INTEGER NOT NULL DEFAULT 3');
  await addColumnIfMissing(db, 'sources', 'etag', 'TEXT');
  await addColumnIfMissing(db, 'sources', 'last_modified', 'TEXT');

  // 3) Indexes (now that columns exist).
  for (const stmt of indexes) {
    await db.exec(stmt);
  }

  if (!db.isPg) {
    await db.exec(
      `INSERT INTO articles_fts(rowid, title, summary)
       SELECT id, title, coalesce(summary, '') FROM articles
       WHERE id NOT IN (SELECT rowid FROM articles_fts)`
    );
  }
  return dialect;
}

async function columnExists(db, table, column) {
  if (db.isPg) {
    const r = await db.get(
      `SELECT 1 AS x FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ? AND column_name = ?`,
      [table, column]
    );
    return Boolean(r);
  }
  const cols = await db.all(`PRAGMA table_info(${table})`);
  return cols.some((c) => c.name === column);
}

async function addColumnIfMissing(db, table, column, type) {
  if (await columnExists(db, table, column)) return;
  if (db.isPg) {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${type}`);
  } else {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
  console.log(`[migrate] added column ${table}.${column}`);
}

// CLI: `npm run migrate`
if (process.argv[1] && process.argv[1].endsWith('migrate.js')) {
  ensureSchema()
    .then((dialect) => {
      console.log(`[migrate] OK: ${dialect} schema ready`);
      return getDb().close();
    })
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('[migrate] FAILED', e);
      process.exit(1);
    });
}
