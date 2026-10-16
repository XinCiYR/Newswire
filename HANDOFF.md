# Newswire — Project Handoff / Status

> 2026-10-16 review: see `PROJECT_REVIEW.md` for the current findings, fixes and
> verification. Node 24.x is required; `npm test` now runs on Windows. Admin writes
> require `ADMIN_USER_IDS`; sessions predating the security migration must sign in again.
> Older sandbox limitations and roadmap entries below are historical, not current checks.

> Performance/ingestion follow-up: `ITERATION_NOTES.md` records batched favorites,
> PostgreSQL GIN/source/fingerprint indexes, bounded/conditional feed fetches and
> classifier boundaries. CI now covers PostgreSQL 16/18 and Docker. Run `npm test`,
> `npm run test:postgres` (with TEST_DATABASE_URL) or `npm run test:docker`.

> Handoff so a **fresh session (or future you) can continue instantly** from disk.
> The conversation history is NOT required — everything is in this repo.

## What this is
A self-hostable **multi-source English news aggregator**:
- Backend: Node.js + Express (ESM), JWT auth, SQLite/Postgres, RSS scraper.
- Frontend: React 18 SPA, built with **esbuild CLI** (custom CSS design system, dark glass aesthetic).
- Scrape: parallel RSS fetch → keyword classify → URL+fingerprint dedupe → insert; in-process 30-min cron + external `/api/cron/trigger`.

## Where everything lives (`D:\AI_Deepseek_Workplace_NEWS_Web`)
```
server/          Express API + scraper + migration/seed
client/          React SPA (src/, scripts/, build via esbuild)
Dockerfile, docker-compose.yml, render.yaml, railway.json
README.md        full docs (setup / deploy / API / limitations)
.env.example     all env vars
server/data/news.sqlite   current database (articles, users, favorites, history)
client/dist/     built frontend (served by Express)
```

## How to run (locally)
```
npm run install:all
copy .env.example server\.env         # set JWT secrets etc.
npm run migrate && npm run seed       # schema + news sources
npm run build:client                  # esbuild bundle (includes fonts)
npm start                             # → http://localhost:4000
```
> Note: `node --test` can't spawn in this sandbox; run tests directly:
> `node server/test/integration.test.js`

## Current feature set (implemented, validated)
- 10 RSS sources; **full-text search** (FTS5 / Postgres tsvector); **Trending** (views) + **Latest** toggle.
- **Views counter**, **related articles**, **client-side SEO/og meta**, **skeleton loading**, content-visibility, DB indexes.
- Auth (scrypt + JWT access/refresh + token_version), **display name** (editable inline), favorites (red heart), history (with favorite sync).
- Rate limiting (auth/cron), per-source **failure backoff**, `/api/scrape/health`.
- Category taxonomy: AI, Tech, Finance, Business, Politics, Entertainment, Other (**Sports removed**).
- Design: Newsreader + Inter variable fonts (self-hosted), glass cards, hero drift + logo hover shimmer, back-to-top, focus-visible a11y, reduced-motion support.

## Known / environment caveats
- **This sandbox has no outbound internet except the npm mirror**, and Node can't spawn children with piped stdio → **no Vite/esbuild-JS-API**; the client uses **esbuild CLI** directly.
- Sandbox blocks BBC/Guardian/NYT feeds (geo/IP) — they error + go into backoff; 7 sources work here.
- **No live public URL** (no deploy credentials/outbound for deploys); one-click deploy configs are ready.
- `git` is NOT available in this sandbox — consider committing the repo elsewhere for persistence.

## Roadmap / next steps (not yet done)
- Route-level **code-splitting** (needs `--splitting` + build-pipeline tweak; deferred).
- **Dark mode**, **personalization/digest**, **OAuth**, **notifications**, **admin panel** (source mgmt / bulk category fix), **i18n**, **PWA/offline**, **Redis caching**, **structured logging/metrics/CI**, backups.

## How to continue in a fresh session
1. Open a new agent **in this working directory** (`pwd` → the repo root).
2. Read `README.md` and this file; inspect `server/src` / `client/src` as needed.
3. Run `npm start` (server should auto-migrate on boot); build client after UI edits:
   `client> esbuild src/main.jsx --bundle --minify --format=esm --loader:.jsx=jsx --loader:.woff2=file --loader:.woff=file --loader:.ttf=file --jsx=automatic --target=es2020 --outdir=dist/assets --public-path=/assets --entry-names=[name]-[hash]`
   then `node scripts/copy-index.mjs`.
4. Validate: `node server/test/integration.test.js` and `node client/scripts/smoke.mjs` (requires server up).

## Current running state (last known)
- **🌐 Live (public):** https://newswire-2dq6.onrender.com
  - Render **free web** service (`newswire`, Live) + **Neon Postgres** (`DATABASE_URL`).
  - In-process cron **off** (`ENABLE_IN_PROCESS_CRON=false`); external scheduler on
    **cron-job.org** (`newswire-scrape`) hits `/api/cron/trigger` **every 30 min**.
  - 10 sources all reachable (BBC/Guardian/NYT work in production); ~265 articles.
- **Local dev:** `http://localhost:4000`, DB `server/data/news.sqlite`.
- See `DEPLOYMENT.md` for full deploy/maintenance/rollback/backup runbook.
