import getDb from '../db/database.js';
import { invalidateDaily } from '../services/daily.js';
import { articleSearchVector } from '../db/search.js';

// Helper to map a DB row to the API shape we expose to the client.
export function toArticle(row) {
  if (!row) return row;
  return {
    id: Number(row.id),
    title: row.title,
    summary: row.summary,
    url: row.url,
    imageUrl: row.image_url,
    publishedAt: row.published_at ? Number(row.published_at) : null,
    category: row.category,
    views: row.views ? Number(row.views) : 0,
    fetchedAt: row.fetched_at ? Number(row.fetched_at) : null,
    sourceId: Number(row.source_id),
    sourceName: row.source_name,
    sourceUrl: row.source_url,
  };
}

export async function findById(id) {
  const row = await getDb().get(
    `SELECT a.*, s.name AS source_name, s.url AS source_url
       FROM articles a JOIN sources s ON s.id = a.source_id
      WHERE a.id = ?`,
    [id]
  );
  return toArticle(row);
}

export async function findByUrl(url) {
  const row = await getDb().get('SELECT * FROM articles WHERE url = ?', [url]);
  return row;
}

// Find by url joined with source info (used by dedupe + public detail).
async function findByUrlJoined(url) {
  return getDb().get(
    `SELECT a.*, s.name AS source_name, s.url AS source_url
       FROM articles a JOIN sources s ON s.id = a.source_id
      WHERE a.url = ?`,
    [url]
  );
}

/** Find a recent article with the same fingerprint (title-similarity dedupe). */
export async function findByFingerprint(fingerprint) {
  return getDb().get(
    `SELECT a.*, s.name AS source_name, s.url AS source_url
       FROM articles a JOIN sources s ON s.id = a.source_id
      WHERE a.fingerprint = ?
      ORDER BY a.published_at DESC
      LIMIT 1`,
    [fingerprint]
  );
}

/**
 * Upsert an article with dual dedupe:
 *   1. exact URL match -> duplicate (no-op)
 *   2. normalized-title fingerprint match (within a recent window) -> duplicate (no-op)
 * Returns { article, inserted, duplicate, reason }.
 */
export async function upsertArticle({ sourceId, title, summary, url, imageUrl, publishedAt, category, fetchedAt, fingerprint }) {
  const db = getDb();
  const byUrl = await findByUrlJoined(url);
  if (byUrl) {
    return { article: toArticle(byUrl), inserted: false, duplicate: true, reason: 'url' };
  }
  if (fingerprint) {
    const byFp = await findByFingerprint(fingerprint);
    if (byFp) {
      return { article: toArticle(byFp), inserted: false, duplicate: true, reason: 'fingerprint' };
    }
  }
  const pub = publishedAt || Date.now();
  const id = await db.insertRowId(
    `INSERT INTO articles
       (source_id, title, summary, url, image_url, published_at, category, fetched_at, fingerprint)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [sourceId, title, summary || null, url, imageUrl || null, pub, category || '其他', fetchedAt || Date.now(), fingerprint || null]
  );
  if (!db.isPg) {
    await db.run('INSERT INTO articles_fts(rowid, title, summary) VALUES (?, ?, ?)', [id, title, summary || '']);
  }
  const article = await findById(id);
  invalidateDaily();
  return { article, inserted: true, duplicate: false, reason: null };
}

// Build a safe FTS5 MATCH expression from user input (prefix terms joined by OR).
function buildFts(query) {
  const tokens = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}]+/gu, ''))
    .filter(Boolean)
    .slice(0, 8);
  return tokens.length ? tokens.map((t) => `"${t}"*`).join(' OR ') : '';
}

async function listArticlesSearch(db, { category, sourceId, q, limit, offset, since }) {
  // PostgreSQL: native full-text search via tsvector/tsquery.
  if (db.isPg) {
    const where = [
      `${articleSearchVector('a')} @@ plainto_tsquery('english', ?)`,
    ];
    const params = [q];
    if (category && category !== '全部' && category !== 'All') { where.push('a.category = ?'); params.push(category); }
    if (sourceId) { where.push('a.source_id = ?'); params.push(Number(sourceId)); }
    if (since) { where.push('a.published_at >= ?'); params.push(Number(since)); }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const rows = await db.all(
      `SELECT a.*, s.name AS source_name, s.url AS source_url
         FROM articles a JOIN sources s ON s.id = a.source_id ${whereSql}
        ORDER BY a.published_at DESC LIMIT ? OFFSET ?`,
      [...params, Number(limit), Number(offset)]
    );
    const totalRow = await db.get(`SELECT COUNT(*) AS n FROM articles a ${whereSql}`, params);
    return { articles: rows.map(toArticle), total: Number(totalRow?.n || 0) };
  }

  // SQLite: FTS5, ranked by relevance.
  const fts = buildFts(q);
  if (!fts) return { articles: [], total: 0 };
  const conds = ['articles_fts MATCH ?'];
  const params = [fts];
  if (category && category !== '全部' && category !== 'All') { conds.push('a.category = ?'); params.push(category); }
  if (sourceId) { conds.push('a.source_id = ?'); params.push(Number(sourceId)); }
  if (since) { conds.push('a.published_at >= ?'); params.push(Number(since)); }
  const whereSql = `WHERE ${conds.join(' AND ')}`;
  const rows = await db.all(
    `SELECT a.*, s.name AS source_name, s.url AS source_url
       FROM articles_fts
       JOIN articles a ON a.id = articles_fts.rowid
       JOIN sources s ON s.id = a.source_id
       ${whereSql}
      ORDER BY rank
      LIMIT ? OFFSET ?`,
    [...params, Number(limit), Number(offset)]
  );
  const totalRow = await db.get(
    `SELECT COUNT(*) AS n FROM articles_fts JOIN articles a ON a.id = articles_fts.rowid ${whereSql}`,
    params
  );
  return { articles: rows.map(toArticle), total: Number(totalRow?.n || 0) };
}

/** List articles with filters and pagination. */
export async function listArticles({ category, sourceId, q, order = 'new', limit = 24, offset = 0, since = 0 } = {}) {
  const db = getDb();
  if (q) return listArticlesSearch(db, { category, sourceId, q, limit, offset, since });

  const where = [];
  const params = [];

  if (category && category !== '全部' && category !== 'All') {
    where.push('a.category = ?');
    params.push(category);
  }
  if (sourceId) {
    where.push('a.source_id = ?');
    params.push(Number(sourceId));
  }
  if (since) {
    where.push('a.published_at >= ?');
    params.push(Number(since));
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderSql = order === 'popular' || order === 'views'
    ? 'a.views DESC, a.published_at DESC'
    : 'a.published_at DESC';
  const rows = await db.all(
    `SELECT a.*, s.name AS source_name, s.url AS source_url
       FROM articles a JOIN sources s ON s.id = a.source_id
       ${whereSql}
      ORDER BY ${orderSql}
      LIMIT ? OFFSET ?`,
    [...params, Number(limit), Number(offset)]
  );
  const totalRow = await db.get(`SELECT COUNT(*) AS n FROM articles a ${whereSql}`, params);
  return { articles: rows.map(toArticle), total: Number(totalRow?.n || 0) };
}

export async function incrementViews(id) {
  const db = getDb();
  const r = await db.run('UPDATE articles SET views = views + 1 WHERE id = ?', [id]);
  if (r.changes === 0) return null;
  const row = await db.get('SELECT views FROM articles WHERE id = ?', [id]);
  return Number(row.views);
}

const STOP = new Set(['the','a','an','to','of','in','on','at','for','and','or','but','with','from','by','is','are','was','were','be','been','has','have','had','it','its','this','that','as','after','over','into','than','their','they','we','you','your','he','she','his','her','will','would','should','could','can','not','no','yes','what','who','how','why','when','where','do','does','did','about','more','most','some','any','all','just','new','news','says','said','say','amid','us','uk','world','today','live']);

function words(t) {
  return ((t || '').toLowerCase().match(/[a-z0-9]{2,}/g) || []).filter((word) => !STOP.has(word));
}

/**
 * Related articles, ranked by title-keyword overlap with the current article so
 * same-event / cross-source coverage surfaces first, then recency.
 */
export async function relatedArticles(id, { limit = 6 } = {}) {
  const db = getDb();
  const current = await db.get('SELECT id, category, title FROM articles WHERE id = ?', [id]);
  if (!current) return [];
  const rows = await db.all(
    `SELECT a.*, s.name AS source_name, s.url AS source_url
       FROM articles a JOIN sources s ON s.id = a.source_id
      WHERE a.category = ? AND a.id != ?
      ORDER BY a.published_at DESC
      LIMIT 60`,
    [current.category, id]
  );
  const target = new Set(words(current.title));
  const scored = rows
    .map((r) => {
      const w = new Set(words(r.title));
      let overlap = 0;
      for (const t of target) if (w.has(t)) overlap += 1;
      return { r, overlap };
    })
    .sort((a, b) => b.overlap - a.overlap || (b.r.published_at - a.r.published_at))
    .slice(0, limit)
    .map((x) => x.r);
  return scored.map(toArticle);
}

/**
 * Distinct OTHER sources covering the same story as `id` (share >=2 title words
 * within the recent window). Used to label "Also covered by" on the detail page.
 */
export async function coverageFor(id) {
  const db = getDb();
  const cur = await db.get('SELECT id, title, source_id FROM articles WHERE id = ?', [id]);
  if (!cur) return [];
  const rows = await db.all(
    `SELECT a.source_id, s.name AS source_name, s.url AS source_url, a.title
       FROM articles a JOIN sources s ON s.id = a.source_id
      WHERE a.id != ? AND a.source_id != ? AND a.published_at >= ?
      ORDER BY a.published_at DESC
      LIMIT 300`,
    [id, cur.source_id, Date.now() - 4 * 24 * 3600 * 1000]
  );
  const target = new Set(words(cur.title));
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (seen.has(r.source_id)) continue;
    const w = new Set(words(r.title));
    let shared = 0;
    for (const t of target) { if (w.has(t)) { shared += 1; if (shared >= 2) break; } }
    if (shared >= 2) {
      seen.add(r.source_id);
      out.push({ name: r.source_name, url: r.source_url });
      if (out.length >= 5) break;
    }
  }
  return out;
}

export async function setCategory(id, category) {
  await getDb().run('UPDATE articles SET category = ? WHERE id = ?', [category, id]);
  invalidateDaily();
  return findById(id);
}
