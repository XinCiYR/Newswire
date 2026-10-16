import getDb from '../db/database.js';

export async function listSources({ enabledOnly = false } = {}) {
  const where = enabledOnly ? 'WHERE enabled = 1' : '';
  return getDb().all(`SELECT * FROM sources ${where} ORDER BY enabled DESC, name ASC`);
}

export async function createSource({ name, url, feed_url, enabled = 1, authority = 3 }) {
  const now = Date.now();
  const id = await getDb().insertRowId(
    'INSERT INTO sources (name, url, feed_url, authority, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [name, url, feed_url, authority, enabled ? 1 : 0, now]
  );
  return getDb().get('SELECT * FROM sources WHERE id = ?', [id]);
}

export async function findById(id) {
  return getDb().get('SELECT * FROM sources WHERE id = ?', [id]);
}

export async function setEnabled(id, enabled) {
  return getDb().run('UPDATE sources SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, id]);
}

/** Record the outcome of a feed fetch, updating status + exponential backoff. */
export async function recordFetch(id, { ok, error, etag = null, lastModified = null }) {
  const db = getDb();
  const now = Date.now();
  if (ok) {
    await db.run(
      'UPDATE sources SET last_fetched_at = ?, last_error = NULL, fail_count = 0, next_retry_at = NULL, etag = ?, last_modified = ? WHERE id = ?',
      [now, etag, lastModified, id]
    );
  } else {
    const s = await db.get('SELECT fail_count FROM sources WHERE id = ?', [id]);
    const fc = Number(s?.fail_count || 0) + 1;
    const backoffMs = Math.min(60 * 60 * 1000, Math.pow(2, Math.min(fc, 6)) * 10 * 1000); // 10s→…→1h
    await db.run(
      'UPDATE sources SET last_fetched_at = ?, last_error = ?, fail_count = ?, next_retry_at = ? WHERE id = ?',
      [now, String(error || 'error').slice(0, 300), fc, now + backoffMs, id]
    );
  }
}
