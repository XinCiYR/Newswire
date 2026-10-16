import { Router } from 'express';
import { listArticles, findById, setCategory, incrementViews, relatedArticles, coverageFor } from '../models/articles.js';
import { withFavoriteState } from '../models/favorites.js';
import { optionalAuth, requireAuth, requireAdmin } from '../auth/middleware.js';
import { getDb } from '../db/database.js';
import { getDaily } from '../services/daily.js';
import { queryInteger } from '../utils/query.js';

const router = Router();
export const CATEGORIES = ['AI', 'Finance', 'Politics', 'Tech', 'Business', 'Entertainment', 'Other'];

// GET /api/categories -> list with article counts
router.get('/api/categories', async (_req, res, next) => {
  try {
    const rows = await getDb().all(
      `SELECT category, COUNT(*) AS n FROM articles GROUP BY category ORDER BY n DESC`
    );
    const counts = {};
    for (const c of CATEGORIES) counts[c] = 0;
    for (const r of rows) if (counts[r.category] !== undefined) counts[r.category] = Number(r.n);
    const list = CATEGORIES.map((key) => ({ key, label: key, displayLabel: key, count: counts[key] }));
    // Include "其他" even if only "Other" indexed.
    return res.json({ categories: list });
  } catch (e) {
    next(e);
  }
});

// GET /api/daily -> today's curated "must-read" top 10 (scored + category-balanced)
router.get('/api/daily', optionalAuth, async (req, res, next) => {
  try {
    const articles = await withFavoriteState(req.user?.id, await getDaily());
    return res.json({ date: new Date().toISOString().slice(0, 10), articles });
  } catch (e) {
    next(e);
  }
});

// GET /api/articles
router.get('/api/articles', optionalAuth, async (req, res, next) => {
  try {
    const { category, sourceId, q, order } = req.query;
    const limit = queryInteger(req.query.limit, { fallback: 24, min: 1, max: 100 });
    const offset = queryInteger(req.query.offset);
    const since = queryInteger(req.query.since);
    if (q !== undefined && (typeof q !== 'string' || q.length > 300)) {
      return res.status(400).json({ error: 'Search query must be a string of at most 300 characters' });
    }
    const result = await listArticles({
      category: category ? String(category) : undefined,
      sourceId: queryInteger(sourceId, { min: 1 }),
      q: q ? String(q) : undefined,
      order: order || 'new',
      limit,
      offset,
      since,
    });
    result.articles = await withFavoriteState(req.user?.id, result.articles);
    return res.json(result);
  } catch (e) {
    next(e);
  }
});

// GET /api/articles/:id -> detail
router.get('/api/articles/:id', optionalAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad id' });
    let article = await findById(id);
    if (!article) return res.status(404).json({ error: 'Article not found' });
    [article] = await withFavoriteState(req.user?.id, [article]);
    article.coverage = await coverageFor(id);
    return res.json({ article });
  } catch (e) {
    next(e);
  }
});

// POST /api/articles/:id/view -> count a view (any visitor); also records
// history when the request is authenticated.
router.post('/api/articles/:id/view', optionalAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad id' });
    const views = await incrementViews(id);
    if (views === null) return res.status(404).json({ error: 'Article not found' });
    if (req.user) {
      const { recordView } = await import('../models/history.js');
      await recordView(req.user.id, id);
    }
    return res.json({ ok: true, views });
  } catch (e) {
    next(e);
  }
});

// GET /api/articles/:id/related -> similar-category articles
router.get('/api/articles/:id/related', optionalAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad id' });
    const article = await findById(id);
    if (!article) return res.status(404).json({ error: 'Article not found' });
    const limit = queryInteger(req.query.limit, { fallback: 6, min: 1, max: 12 });
    const related = await withFavoriteState(req.user?.id, await relatedArticles(id, { limit }));
    return res.json({ articles: related });
  } catch (e) {
    next(e);
  }
});

// Admin-ish: PATCH /api/articles/:id/category (classified correction)
router.patch('/api/articles/:id/category', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { category } = req.body || {};
    if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'Invalid category' });
    const article = await setCategory(id, category);
    if (!article) return res.status(404).json({ error: 'Article not found' });
    return res.json({ article });
  } catch (e) {
    next(e);
  }
});

export default router;
