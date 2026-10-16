import { Router } from 'express';
import { listSources, createSource } from '../models/sources.js';
import { requireAuth, requireAdmin } from '../auth/middleware.js';
import { httpUrl } from '../utils/url.js';

const router = Router();

// GET /api/sources
router.get('/api/sources', async (_req, res, next) => {
  try {
    const sources = await listSources({});
    return res.json({ sources });
  } catch (e) {
    next(e);
  }
});

// POST /api/sources (authenticated; simple admin to add a feed)
router.post('/api/sources', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { name, url, feed_url, enabled } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || name.length > 120 || !httpUrl(url) || !httpUrl(feed_url)) {
      return res.status(400).json({ error: 'A name (1–120 characters) and valid HTTP(S) URLs are required' });
    }
    const source = await createSource({ name: name.trim(), url: httpUrl(url), feed_url: httpUrl(feed_url), enabled: enabled === false ? 0 : 1 });
    return res.status(201).json({ source });
  } catch (e) {
    next(e);
  }
});

export default router;
