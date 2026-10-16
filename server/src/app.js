import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import config from './config.js';
import authRoutes from './routes/auth.js';
import articleRoutes from './routes/articles.js';
import favoriteRoutes from './routes/favorites.js';
import historyRoutes from './routes/history.js';
import sourceRoutes from './routes/sources.js';
import cronRoutes from './routes/cron.js';
import metaRoutes from './routes/meta.js';
import { VERSION } from './version.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '100kb' }));

  // Lightweight request logging.
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const dur = Date.now() - start;
      if (req.originalUrl.startsWith('/api')) {
        console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${dur}ms`);
      }
    });
    next();
  });

  // Health check (also used by platform uptime checks).
  app.get('/api/health', (req, res) => {
    res.json({ ok: true, version: VERSION, commit: process.env.RENDER_GIT_COMMIT || null, ts: Date.now(), env: config.env });
  });

  // API routes.
  app.use('/api/auth', authRoutes);
  app.use(articleRoutes);
  app.use(favoriteRoutes);
  app.use(historyRoutes);
  app.use(sourceRoutes);
  app.use(cronRoutes);
  app.use(metaRoutes);

  // 404 for unknown API routes.
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Static frontend (built with esbuild). Fall back to index.html for SPA routes.
  const clientDist = path.resolve(config.serverRoot, '..', 'client', 'dist');
  if (fs.existsSync(clientDist)) {
    // Assets are content-hashed (main-<hash>.js/css) so cache them immutably;
    // the HTML is served no-store so reloads always pick up the latest bundle.
    app.use(
      express.static(clientDist, {
        index: 'index.html',
        maxAge: '1y',
        immutable: true,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          }
        },
      })
    );
    app.get('*', (req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'), { headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' } });
    });
    console.log(`[app] serving static frontend from ${clientDist}`);
  } else {
    console.log('[app] client/dist not found; serving API only (run the client build)');
    app.get('/', (req, res) => res.send('News Aggregator API is running. Build the client to see the UI.'));
  }

  // Central error handler.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[error]', err);
    if (res.headersSent) return next(err);
    const status = err.statusCode || err.status || 500;
    if (status >= 400 && status < 500) {
      return res.status(status).json({ error: err.message || 'Bad request' });
    }
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
