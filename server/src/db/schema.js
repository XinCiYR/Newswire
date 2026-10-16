import { articleSearchVector } from './search.js';

/**
 * Schema definitions for both backends.
 * Booleans are INTEGER 0/1; timestamps are BIGINT Unix epoch ms.
 * Returns an array of SQL statements suitable for `db.exec()` / multi-statement.
 */
export function schema(dialect /* 'sqlite' | 'pg' */) {
  const isPg = dialect === 'pg';
  const pk = isPg ? 'BIGSERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  const ref = isPg ? 'BIGINT' : 'INTEGER';
  const createIndex = isPg ? 'CREATE INDEX CONCURRENTLY IF NOT EXISTS' : 'CREATE INDEX IF NOT EXISTS';

  return [
    `
CREATE TABLE IF NOT EXISTS users (
  id ${pk},
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  password_hash TEXT NOT NULL,
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
)`,
    `
CREATE TABLE IF NOT EXISTS sources (
  id ${pk},
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  feed_url TEXT NOT NULL,
  authority INTEGER NOT NULL DEFAULT 3,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL
)`,
    `
CREATE TABLE IF NOT EXISTS refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id ${ref} NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL
)`,
    `CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens (user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expiry ON refresh_tokens (expires_at)`,
    `
CREATE TABLE IF NOT EXISTS articles (
  id ${pk},
  source_id ${ref} NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  url TEXT NOT NULL UNIQUE,
  image_url TEXT,
  published_at BIGINT,
  category TEXT,
  views INTEGER NOT NULL DEFAULT 0,
  fetched_at BIGINT NOT NULL,
  fingerprint TEXT,
  CONSTRAINT fk_articles_source FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
)`,
    `
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles (published_at DESC)`,
    `
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles (category)`,
    `
CREATE INDEX IF NOT EXISTS idx_articles_views ON articles (views DESC)`,
    `
CREATE INDEX IF NOT EXISTS idx_articles_cat_pub ON articles (category, published_at DESC)`,
    `${createIndex} idx_articles_fingerprint_pub ON articles (fingerprint, published_at DESC)`,
    `${createIndex} idx_articles_source_pub ON articles (source_id, published_at DESC, id DESC)`,
    ...(isPg ? [`${createIndex} idx_articles_search ON articles USING GIN (${articleSearchVector()})`] : []),
    `
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT
)`,
    `
CREATE TABLE IF NOT EXISTS favorites (
  user_id ${ref} NOT NULL,
  article_id ${ref} NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, article_id),
  CONSTRAINT fk_fav_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_fav_article FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
)`,
    `
CREATE TABLE IF NOT EXISTS history (
  id ${pk},
  user_id ${ref} NOT NULL,
  article_id ${ref} NOT NULL,
  viewed_at BIGINT NOT NULL,
  CONSTRAINT fk_history_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_history_article FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
)`,
    `
CREATE INDEX IF NOT EXISTS idx_history_user_viewed ON history (user_id, viewed_at DESC)`,
  ];
}
