import { Router } from 'express';
import { listHistory, clearHistory } from '../models/history.js';
import { withFavoriteState } from '../models/favorites.js';
import { requireAuth } from '../auth/middleware.js';
import { queryInteger } from '../utils/query.js';

const router = Router();

// GET /api/history
router.get('/api/history', requireAuth, async (req, res, next) => {
  try {
    const limit = queryInteger(req.query.limit, { fallback: 60, min: 1, max: 200 });
    const offset = queryInteger(req.query.offset);
    const result = await listHistory(req.user.id, { limit, offset });
    // Reflect each article's current favorite state so hearts sync with Favorites.
    result.articles = await withFavoriteState(req.user.id, result.articles);
    return res.json(result);
  } catch (e) {
    next(e);
  }
});

// DELETE /api/history
router.delete('/api/history', requireAuth, async (req, res, next) => {
  try {
    await clearHistory(req.user.id);
    return res.json({ ok: true, cleared: true });
  } catch (e) {
    next(e);
  }
});

export default router;
