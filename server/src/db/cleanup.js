import getDb from '../db/database.js';
import config from '../config.js';
import { invalidateDaily } from '../services/daily.js';

async function deleteByIds(db, ids) {
  const nums = [...new Set(ids.map(Number))].filter((n) => Number.isFinite(n) && n > 0);
  if (!nums.length) return 0;
  let deleted = 0;
  for (let i = 0; i < nums.length; i += 500) {
    const chunk = nums.slice(i, i + 500);
    const ph = chunk.map(() => '?').join(',');
    // Recheck protection at deletion time: a favorite may have arrived since selection.
    const r = await db.run(`DELETE FROM articles WHERE id IN (${ph}) AND NOT EXISTS
      (SELECT 1 FROM favorites f WHERE f.article_id = articles.id)`, chunk);
    deleted += r.changes;
    if (!db.isPg) {
      // Keep the SQLite FTS index in sync with the articles table.
      await db.run(`DELETE FROM articles_fts WHERE rowid IN (${ph})
        AND rowid NOT IN (SELECT id FROM articles)`, chunk);
    }
  }
  return deleted;
}

/**
 * Enforce article retention:
 *   - per-source cap: keep the newest N per source
 *   - age cap: drop articles older than N days
 *   - favorites are NEVER deleted (protected)
 * Favorited articles are skipped; history/favorites rows of pruned articles are
 * removed via FK cascade (Postgres) / explicit FTS cleanup (SQLite).
 * Runs after each scrape cycle. Config-driven, bounded and safe.
 */
export async function cleanupArticles() {
  const db = getDb();
  const total = { perSource: 0, byAge: 0, deleted: 0 };
  if (!config.scrape.cleanupEnabled) return total;

  const ids = [];

  // 1) Per-source cap.
  if (config.scrape.maxArticlesPerSource > 0) {
    const sources = await db.all('SELECT id FROM sources');
    for (const s of sources) {
      const rows = await db.all(
        `SELECT a.id FROM articles a
          WHERE a.source_id = ?
            AND a.id NOT IN (
              SELECT id FROM articles
               WHERE source_id = ?
               ORDER BY published_at DESC, id DESC
               LIMIT ?
            )
            AND a.id NOT IN (SELECT article_id FROM favorites)`,
        [s.id, s.id, config.scrape.maxArticlesPerSource]
      );
      total.perSource += rows.length;
      for (const r of rows) ids.push(r.id);
    }
  }

  // 2) Age-based retention.
  if (config.scrape.retentionDays > 0) {
    const cutoff = Date.now() - config.scrape.retentionDays * 86400000;
    const rows = await db.all(
      `SELECT a.id FROM articles a
        WHERE a.published_at IS NOT NULL AND a.published_at < ?
          AND a.id NOT IN (SELECT article_id FROM favorites)`,
      [cutoff]
    );
    total.byAge += rows.length;
    for (const r of rows) ids.push(r.id);
  }

  total.deleted = await deleteByIds(db, ids);
  if (total.deleted) invalidateDaily();
  return total;
}

/**
 * Cap each user's browsing history to the newest `limit` rows.
 * Call after recording a view.
 */
export async function trimHistory(userId, limit) {
  if (!limit || limit <= 0) return;
  const db = getDb();
  await db.run(
    `DELETE FROM history
      WHERE user_id = ?
        AND id NOT IN (
          SELECT id FROM history WHERE user_id = ? ORDER BY viewed_at DESC LIMIT ?
        )`,
    [userId, userId, limit]
  );
}
