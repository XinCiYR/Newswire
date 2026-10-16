import { Router } from 'express';
import { createUser, findByEmail, publicUser, getTokenVersion, bumpTokenVersion, updateName } from '../models/users.js';
import { hashPassword, verifyPassword, validateEmail } from '../auth/password.js';
import { verifyRefreshToken } from '../auth/jwt.js';
import { issueTokens } from '../auth/sessions.js';
import getDb from '../db/database.js';
import { requireAuth } from '../auth/middleware.js';
import { rateLimit } from '../middleware/rateLimit.js';

const router = Router();
const authLimiter = rateLimit({ windowMs: 60000, max: 20 });

function isValidPassword(p) {
  return typeof p === 'string' && p.length >= 8 && p.length <= 128;
}

/** Normalize an optional display name: trim, collapse spaces, cap length. */
function normalizeName(name) {
  if (typeof name !== 'string') return null;
  const n = name.replace(/\s+/g, ' ').trim();
  if (!n) return null;
  return n.slice(0, 60);
}

function body(req) {
  return req.body || {};
}

// POST /api/auth/register
router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const { email, password, name } = body(req);
    const normalized = validateEmail(email);
    if (!normalized) return res.status(400).json({ error: 'A valid email is required' });
    if (!isValidPassword(password)) {
      return res.status(400).json({ error: 'Password must be 8–128 characters' });
    }
    const existing = await findByEmail(normalized);
    if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

    const passwordHash = await hashPassword(password);
    const user = await createUser(normalized, passwordHash, normalizeName(name));
    return res.status(201).json({ user: await publicUser(user.id), ...await issueTokens(user) });
  } catch (e) {
    next(e);
  }
});

// POST /api/auth/login
router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const { email, password } = body(req);
    const normalized = validateEmail(email);
    if (!normalized) return res.status(400).json({ error: 'A valid email is required' });
    if (!isValidPassword(password)) return res.status(401).json({ error: 'Invalid email or password' });
    const user = await findByEmail(normalized);
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    const ok = await verifyPassword(password || '', user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password' });
    return res.json({ user: await publicUser(user.id), ...await issueTokens(user) });
  } catch (e) {
    next(e);
  }
});

// POST /api/auth/refresh -> rotates the refresh token
router.post('/refresh', authLimiter, async (req, res, next) => {
  try {
    const { refreshToken } = body(req);
    if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });
    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }
    if (payload.type !== 'refresh') return res.status(401).json({ error: 'Invalid token type' });
    const user = await publicUser(Number(payload.sub));
    if (!user) return res.status(401).json({ error: 'Account no longer exists' });
    const ver = await getTokenVersion(user.id);
    if (Number(payload.ver) !== ver) return res.status(401).json({ error: 'Refresh token revoked' });
    const tokens = await issueTokens({ ...user, token_version: ver }, refreshToken);
    if (!tokens) return res.status(401).json({ error: 'Refresh token already used or revoked' });
    return res.json(tokens);
  } catch (e) {
    next(e);
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await publicUser(req.user.id);
    return res.json({ user });
  } catch (e) {
    next(e);
  }
});

// PATCH /api/auth/profile — update the display name
router.patch('/profile', requireAuth, async (req, res, next) => {
  try {
    const { name } = body(req);
    const user = await updateName(req.user.id, normalizeName(name));
    return res.json({ user });
  } catch (e) {
    next(e);
  }
});

// POST /api/auth/logout -> bumps token_version (invalidates all refresh tokens)
router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await bumpTokenVersion(req.user.id);
    await getDb().run('DELETE FROM refresh_tokens WHERE user_id = ?', [req.user.id]);
    return res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
