import { Router } from 'express';
import { addFavorite, removeFavorite, listFavorites } from '../models/favorites.js';
import { findById } from '../models/articles.js';
import { requireAuth } from '../auth/middleware.js';
import { queryInteger } from '../utils/query.js';

const router = Router();

// GET /api/favorites
router.get('/api/favorites', requireAuth, async (req, res, next) => {
  try {
    const limit = queryInteger(req.query.limit, { fallback: 60, min: 1, max: 200 });
    const offset = queryInteger(req.query.offset);
    const result = await listFavorites(req.user.id, { limit, offset });
    return res.json({ ...result, count: result.total });
  } catch (e) {
    next(e);
  }
});

// POST /api/favorites/:articleId
router.post('/api/favorites/:articleId', requireAuth, async (req, res, next) => {
  try {
    const articleId = Number(req.params.articleId);
    if (!Number.isFinite(articleId)) return res.status(400).json({ error: 'Bad id' });
    const article = await findById(articleId);
    if (!article) return res.status(404).json({ error: 'Article not found' });
    const favorited = await addFavorite(req.user.id, articleId);
    return res.json({ favorited });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/favorites/:articleId
router.delete('/api/favorites/:articleId', requireAuth, async (req, res, next) => {
  try {
    const articleId = Number(req.params.articleId);
    if (!Number.isFinite(articleId)) return res.status(400).json({ error: 'Bad id' });
    await removeFavorite(req.user.id, articleId);
    return res.json({ favorited: false });
  } catch (e) {
    next(e);
  }
});

export default router;
