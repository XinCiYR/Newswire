import { createHash } from 'node:crypto';
import getDb from '../db/database.js';
import config from '../config.js';
import { signAccessToken, signRefreshToken } from './jwt.js';

const hash = (token) => createHash('sha256').update(token).digest('hex');

/** Store only a digest. On refresh, one atomic update consumes the old token. */
export async function issueTokens(user, previousToken = null) {
  const db = getDb();
  const accessToken = signAccessToken(user.id, user.token_version);
  const refreshToken = signRefreshToken(user.id, user.token_version);
  const expiresAt = Date.now() + config.jwt.refreshTtl * 1000;
  if (previousToken) {
    const result = await db.run(
      `UPDATE refresh_tokens SET token_hash = ?, expires_at = ?
       WHERE token_hash = ? AND user_id = ? AND expires_at > ?
         AND EXISTS (SELECT 1 FROM users WHERE id = ? AND token_version = ?)`,
      [hash(refreshToken), expiresAt, hash(previousToken), user.id, Date.now(), user.id, user.token_version]
    );
    if (!result.changes) return null;
  } else {
    await db.run('DELETE FROM refresh_tokens WHERE expires_at <= ?', [Date.now()]);
    await db.run('INSERT INTO refresh_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
      [hash(refreshToken), user.id, expiresAt]);
  }
  return { accessToken, refreshToken, tokenType: 'Bearer' };
}
