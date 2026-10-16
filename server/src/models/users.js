import getDb from '../db/database.js';
import config from '../config.js';

export async function createUser(email, passwordHash, name = null) {
  const now = Date.now();
  const db = getDb();
  await db.run('INSERT INTO users (email, name, password_hash, token_version, created_at) VALUES (?, ?, ?, 0, ?)', [
    email,
    name || null,
    passwordHash,
    now,
  ]);
  return findByEmail(email);
}

export async function findByEmail(email) {
  return getDb().get('SELECT * FROM users WHERE email = ?', [email]);
}

export async function findById(id) {
  return getDb().get('SELECT id, email, name, created_at FROM users WHERE id = ?', [id]);
}

export async function publicUser(id) {
  const user = await getDb().get('SELECT id, email, name, created_at FROM users WHERE id = ?', [id]);
  return user ? { ...user, isAdmin: config.adminUserIds.includes(Number(user.id)) } : null;
}

export async function updateName(id, name) {
  await getDb().run('UPDATE users SET name = ? WHERE id = ?', [name || null, id]);
  return publicUser(id);
}

export async function getTokenVersion(id) {
  const r = await getDb().get('SELECT token_version FROM users WHERE id = ?', [id]);
  return r ? Number(r.token_version || 0) : null;
}

/** Increment token_version: invalidates all existing refresh tokens (logout). */
export async function bumpTokenVersion(id) {
  await getDb().run('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [id]);
  return getTokenVersion(id);
}
