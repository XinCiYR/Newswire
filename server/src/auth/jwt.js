import jwt from 'jsonwebtoken';
import config from '../config.js';
import { randomUUID } from 'node:crypto';

const { accessSecret, refreshSecret, accessTtl, refreshTtl } = config.jwt;

const OPTS = { issuer: 'news-aggregator', audience: 'news-aggregator-web' };

export function signAccessToken(userId, tokenVersion) {
  return jwt.sign({ type: 'access', sub: String(userId), ver: Number(tokenVersion) }, accessSecret, {
    ...OPTS,
    expiresIn: accessTtl,
  });
}

export function signRefreshToken(userId, tokenVersion) {
  // A unique jti prevents two logins within the same second sharing a token.
  return jwt.sign({ type: 'refresh', sub: String(userId), ver: tokenVersion }, refreshSecret, {
    ...OPTS,
    jwtid: randomUUID(),
    expiresIn: refreshTtl,
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, accessSecret, { ...OPTS, algorithms: ['HS256'] });
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, refreshSecret, { ...OPTS, algorithms: ['HS256'] });
}
