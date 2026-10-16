import { Router } from 'express';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const router = Router();
const routeDir = path.dirname(fileURLToPath(import.meta.url));
const bundledChangelog = path.resolve(routeDir, '../data/changelog.json');
const changelogPath = existsSync(bundledChangelog) ? bundledChangelog : path.resolve(routeDir, '../../data/changelog.json');
let cached = null;

// GET /api/changelog -> the site's update log (edited in data/changelog.json).
router.get('/api/changelog', (_req, res, next) => {
  try {
    if (!cached) cached = JSON.parse(readFileSync(changelogPath, 'utf8'));
    return res.json({ entries: cached });
  } catch (e) {
    next(e);
  }
});

export default router;
