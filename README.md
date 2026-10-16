# 📰 Newswire — Multi-Source English News Aggregator

A professional, responsive news aggregator that automatically scrapes multiple English
news sources (RSS/Atom), classifies every article into a topic, and presents a clean,
editorial reading experience — with user accounts, bookmarking, and browsing history.

Built to be **simple, reliable, and free-to-deploy** (Render / Railway / Docker).

> 🌐 **Live:** [https://newswire-2dq6.onrender.com](https://newswire-2dq6.onrender.com)
> — deployed on Render (free web) + Neon Postgres + cron-job.org (every 30 min).

---

## ✨ Features

- **Multi-source scraping** — 10 RSS/Atom sources; feeds are fetched **in parallel**; one
  dead or geo-blocked feed never breaks the run.
- **Automatic classification** — keyword/rule classifier buckets each article into
  `AI`, `Tech`, `Finance`, `Business`, `Politics`, `Sports`, `Entertainment`, or `Other`.
- **Deduplication** — exact-URL dedupe + normalized-title fingerprint dedupe.
- **Home / Category / Search pages** — responsive card grid, pagination, live counts.
- **Article detail** — summary + a clearly-labeled **“Read original ↗”** link (we never
  copy full article text).
- **User accounts** — register / login / logout, passwords hashed with `scrypt`,
  **JWT** access + rotating refresh tokens (server-side revoke on logout).
- **Favorites** — heart toggle on every card and detail page, persistent per user.
- **Browsing history** — opening an article records a view; view/clear history page.
- **Administration** — only existing accounts listed in `ADMIN_USER_IDS` can correct categories or add feeds.
- **Display name** — set a name at registration; edit it inline from the header.
- **Trending & views** — every article has a view counter; the home page toggles
  between **Latest** and **Trending** (most-viewed). Related articles appear on detail pages.
- **Full-text search** — SQLite `FTS5` / Postgres `tsvector` replaces simple `LIKE`.
- **SEO / social meta** — per-article `description`/`og:`/`twitter:` tags via client-side meta.
- **Performance** — skeleton loading, `content-visibility` lazy rendering, DB indexes.
- **Ops** — auth + cron rate limiting, per-source failure backoff, `/api/scrape/health`.
- **Scheduling** — in-process timer (default every 30 min) **plus** a protected
  `/api/cron/trigger` endpoint for external schedulers (e.g. cron-job.org) on platforms
  that put containers to sleep.

---

## 🧰 Tech stack

| Layer      | Choice                                             |
|------------|----------------------------------------------------|
| Backend    | Node.js + Express (ESM)                            |
| Frontend   | React 18 + React Router 6, bundled with **esbuild** |
| Styling    | Hand-crafted CSS design system (no framework dep)  |
| Database   | SQLite (built-in `node:sqlite`) for local/dev; PostgreSQL via `DATABASE_URL` for production |
| RSS parsing| `rss-parser` + global `fetch`                      |
| Auth       | `crypto.scrypt` hashing + `jsonwebtoken` (access + refresh) |
| Scheduling | `setInterval` in-process + external cron endpoint  |

> **Why esbuild instead of Vite?** The build is a plain, dependency-light esbuild CLI
> command (`npm run build`) that produces a static bundle the Express server serves in
> production. It needs no framework-specific dev server and works identically in CI and
> on any Node host. This keeps the deploy surface tiny and fully self-contained.

**Why a custom CSS system instead of Tailwind?** Fewer moving parts, no PostCSS build
step, and full control over the editorial, NYT/Guardian-style aesthetic while staying a
single, dependency-light build.

---

## 📁 Directory structure

```
.
├── Dockerfile                # multi-stage build (client + server)
├── docker-compose.yml        # local / self-hosted run (+ optional Postgres)
├── render.yaml               # Render.com blueprint (web + Postgres)
├── railway.json              # Railway config (uses Dockerfile)
├── .env.example              # all env vars, with docs
├── server/
│   ├── package.json
│   ├── src/
│   │   ├── index.js          # entry: migrate → listen → start scheduler
│   │   ├── app.js            # Express app + static SPA serving
│   │   ├── config.js         # env config
│   │   ├── auth/             # scrypt, JWT, middleware
│   │   ├── db/               # database adapter, schema, migrate, seed
│   │   ├── models/           # users, articles, favorites, history, sources
│   │   ├── routes/           # auth, articles, favorites, history, sources, cron
│   │   ├── scraper/          # sources, fetch, classify, worker, run-once, scheduler
│   │   └── utils/            # text normalisation / fingerprints
│   └── test/integration.test.js
└── client/
    ├── index.html
    ├── package.json
    ├── scripts/              # copy-index, smoke (jsdom render test)
    └── src/
        ├── main.jsx, App.jsx, api.js, auth.jsx, hooks.js, lib.js, styles.css
        ├── components/       # Navbar, ArticleCard, ArticleGrid, FavoritesButton, ...
        └── pages/            # Home, Category, Search, Article, Favorites, History, Login, Register
```

---

## 🗃️ Data model

Booleans stored as `INTEGER 0/1`; timestamps as `BIGINT` epoch ms (identical on both
backends, so the schema is dialect-agnostic).

- **users** — `id, email (unique), password_hash, token_version, created_at`
- **sources** — `id, name, url, feed_url, enabled, created_at`
- **articles** — `id, source_id (FK), title, summary, url (unique), image_url, published_at, category, fetched_at, fingerprint`; indexes on `published_at` and `category`
- **favorites** — `user_id + article_id (PK)`, `created_at`
- **history** — `id, user_id, article_id, viewed_at`; index on `(user_id, viewed_at)`

---

## ⚙️ Architecture / data flow

```
 external cron ──POST /api/cron/trigger──┐
                                         ▼
  [RSS feeds] ──(parallel fetch, rss-parser)──> [normalise + classify + fingerprint]
                                                      │
                                                      ▼
                                              articles (dedupe by url/fingerprint)
                                                      │
                       ┌──────────────────────────────┘
                       ▼
              [Express API  /api/...]
                       │
                       ▼
        React SPA (served from client/dist in production)
                       │
              users / favorites / history (auth)
```

- **Fetching:** each feed is parsed into `{title, url, summary, imageUrl, publishedAt}`.
  Feed errors are logged and the source is skipped.
- **Classifying:** keyword scoring (`title`×2 + `summary`×1); best category wins, else `Other`.
- **Deduping:** skip if `url` exists; else skip if a recent article has the same
  normalized-title fingerprint.
- **Scheduling:** `ENABLE_IN_PROCESS_CRON=true` runs an initial + periodic scrape in the
  container. For sleeping free-tier platforms, set it `false` and use an external cron
  hitting the protected trigger endpoint.

---

## 🚀 Local development

**Prereqs:** Node.js 24.x (the server imports built-in `node:sqlite`).

```bash
# 1. Install deps (uses npm; installs into server/ and client/)
npm run install:all

# 2. Copy env and set secrets (fill in real values)
copy .env.example server\.env   # Windows
#   …or:  cp .env.example server/.env   (macOS/Linux)

# 3. Initialise DB + seed sources (10 feeds)
npm run migrate
npm run seed

# 4. Build the React client (esbuild)
npm run build:client

# 5. Start the server (API + static SPA + scheduler)
npm start
# open http://localhost:4000
```

> Generate strong secrets:
> `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

**Dev convenience.** Run the server with auto-restart via `npm run dev:server`.
The client is a static bundle; rebuild after editing UI files (`npm run build:client`).

**Offline / sample data.** If you have no network (or want instant content), seed a
handful of clearly-labeled sample articles:
```bash
npm run seed -- --demo
```

**Run one scrape now** (populates the DB from live feeds):
```bash
npm run fetch
```

---

## 🔑 Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `4000` | HTTP port |
| `NODE_ENV` | `development` | `production` in prod |
| `DATABASE_URL` | *(empty)* | PostgreSQL connection string; **empty → SQLite** |
| `SQLITE_PATH` | `./data/news.sqlite` | SQLite file location (when no `DATABASE_URL`) |
| `JWT_ACCESS_SECRET` | *(dev)* | Access-token signing secret |
| `JWT_REFRESH_SECRET` | *(dev)* | Refresh-token signing secret |
| `JWT_ACCESS_TTL` | `900` (15 min) | Access token lifetime (s) |
| `JWT_REFRESH_TTL` | `2592000` (30 d) | Refresh token lifetime (s) |
| `ADMIN_USER_IDS` | *(empty)* | Comma-separated IDs of existing administrator accounts; empty disables admin writes |
| `TRUST_PROXY` | `0` | Trusted reverse-proxy hops; use `1` behind the configured Render proxy |
| `SCRAPE_INTERVAL_MINUTES` | `30` | In-process scrape interval |
| `SCRAPE_CONCURRENCY` | `4` | Maximum simultaneous feed requests (capped at 16) |
| `SCRAPE_TIMEOUT_MS` | `20000` | Timeout for HTTP headers and body |
| `SCRAPE_MAX_RESPONSE_BYTES` | `2097152` | Maximum feed size in bytes, including decompressed content |
| `CRON_SECRET` | *(dev)* | Shared secret for `/api/cron/trigger` |
| `ENABLE_IN_PROCESS_CRON` | `true` | Enable the in-container scheduler |
| `CORS_ORIGINS` | `http://localhost:5173` | Allowed origins (comma-separated) |
| `MAX_ARTICLES_PER_SOURCE` | `1000` | Articles kept per source after cleanup |
| `ARTICLE_RETENTION_DAYS` | `30` | Drop articles older than N days (favorites kept) |
| `HISTORY_LIMIT` | `200` | Browsing-history rows kept per user |
| `CLEANUP_ENABLED` | `true` | Auto-cleanup after each scrape |

---

## 📡 API reference

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | – | Create account, returns tokens |
| POST | `/api/auth/login` | – | Login, returns tokens |
| POST | `/api/auth/refresh` | – | Rotate refresh token |
| GET | `/api/auth/me` | ✓ | Current user |
| POST | `/api/auth/logout` | ✓ | Revoke refresh tokens |
| GET | `/api/categories` | – | Categories with counts |
| GET | `/api/articles` | opt | List (params: `category`, `sourceId`, `q` (full-text), `order` `new|views`, `limit`, `offset`) |
| GET | `/api/articles/:id` | opt | Article detail |
| GET | `/api/articles/:id/related` | opt | Related (same-category) articles |
| POST | `/api/articles/:id/view` | opt | Count a view (also logs history when authenticated) |
| PATCH | `/api/articles/:id/category` | admin | Correct a category |
| GET | `/api/favorites` | ✓ | List favorites |
| POST | `/api/favorites/:id` | ✓ | Add favorite |
| DELETE | `/api/favorites/:id` | ✓ | Remove favorite |
| GET | `/api/history` | ✓ | List history |
| DELETE | `/api/history` | ✓ | Clear history |
| GET | `/api/sources` | – | List sources |
| GET | `/api/scrape/health` | – | Fetch + source health (last scrape, per-source status) |
| POST | `/api/cron/trigger` | `x-cron-secret` | Trigger one scrape |

Auth uses `Authorization: Bearer <accessToken>`.

---

## 🧪 Testing

```bash
# Backend + frontend regression tests (isolated temporary database)
npm test
# Build and smoke-render the SPA against an isolated API server
npm --prefix client run smoke:test
```

The suite covers: health & categories, article list & search, register→login→me→refresh,
duplicate/bad-login rejection, favorite add/list/remove, view-record + history list/clear,
and category-correction auth.

The review and complete change inventory are recorded in `PROJECT_REVIEW.md`.
The performance/ingestion iteration, PostgreSQL and Docker verification commands are
recorded in `ITERATION_NOTES.md`. `.github/workflows/verify.yml` runs SQLite/client,
PostgreSQL 16/18, and Docker startup/persistence checks on pushes and pull requests.
On the first deployment of the session-security fixes, existing sessions must sign in again.
Production requires distinct random JWT secrets and a random cron secret, each at least 32 characters.

---

## 🗂️ Deployment

> **Recommended: Render + persistent Postgres + external cron.**
> See the full step-by-step runbook in **`DEPLOYMENT.md`**.

### Option A — Render.com (blueprint, free-capable)
1. Push to GitHub.
2. On Render → **New → Blueprint**, select the repo (it reads `render.yaml`).
3. Set `DATABASE_URL` to a **durable Postgres** (recommend **Neon/Supabase** free tier;
   Render's own free Postgres expires after 30 days). Render generates `JWT_*`/`CRON_SECRET`.
4. Deploy, get the `https://…onrender.com` URL.

Free-tier notes: web services **sleep** after ~15 min idle; set `ENABLE_IN_PROCESS_CRON=false`
and use an external scheduler (Option D) so scraping keeps running. The app auto-migrates
**and auto-seeds its 10 default sources** on first boot, so no manual DB setup.

### Option B — Railway
Railway auto-detects the `Dockerfile` (or use `railway.json`). Set the same env vars,
attached a Postgres plugin/volume for durability.

### Option C — Docker (self-hosted / VPS)
```bash
docker compose up --build
# → http://localhost:4000  (SQLite persisted in a volume)
```
For production Postgres, uncomment the `db` service in `docker-compose.yml` and set
`DATABASE_URL` to `postgres://newswire:newswire@db:5432/newswire`.
Set all three secret variables in your shell or root `.env` before running Compose.

### Option D — External scheduler (for sleeping containers)
Set `ENABLE_IN_PROCESS_CRON=false`, then schedule a cron (e.g. **cron-job.org**) on
`POST https://YOUR-URL/api/cron/trigger` with header `x-cron-secret: <CRON_SECRET>`
every 30 minutes. This wakes/keeps the feed fresh regardless of container sleeps.

---

## 🖼️ Screenshots

The app was verified to render (brand, hero, and a grid of **live article cards**) via an
automated headless DOM smoke test (`client/scripts/smoke.mjs`). No GUI browser was
available in the build sandbox, so no screenshots were captured here. After a local run,
open `http://localhost:4000` to view it directly.

---

## 🔒 Compliance & safety

- Only summaries + original links are shown; **no full article text is copied**.
- Feeds fetched with a reasonable `User-Agent`, per-feed timeouts, and parallel fetch;
  individual failures are logged and never crash the run.
- Passwords hashed with `scrypt` (never plaintext); access tokens short-lived; refresh
  tokens carry a `token_version` so logout revokes them server-side.
- Parameterized SQL everywhere in the repository layer; no raw string interpolation into
  SQL from client input.

---

## ⚠️ Known limitations & honest notes

- **This sandbox could not fetch every feed.** While running here, 7/10 feeds were
  reachable and produced real articles (TechCrunch, The Verge, CNBC, Ars Technica, NPR,
  Wired, CBS News). BBC / The Guardian / NYT timed out from this network (geo/IP
  restrictions) but are valid production feeds and are expected to work from a normal
  host. The scraper logs and skips any feed that fails, so this is safe.
- **No live public URL was deployed from the sandbox** (no outbound internet for deployment
  / no account credentials). A complete, verified one-click deploy path is provided above
  (Render blueprint, Railway, Docker) so you can stand it up in minutes.
- **Free-tier persistence caveats:** SQLite on an ephemeral free container is lost on
  redeploy/restart; use PostgreSQL for durable data. Free web containers sleep and need an
  external cron (Option D) for uninterrupted scraping.

---

## 🔭 Roadmap (P1/P2 not yet done)

- [x] Full-text search (FTS5 / tsvector) ✅
- [x] Dark mode (toggle in header, persisted) ✅
- [x] Retention cleanup (article + history caps) ✅
- [ ] OAuth (Google / GitHub) sign-in
- [ ] Admin panel for source management & bulk category correction
- [ ] RSS output, data export
- [ ] Postgres-backed full index tuning / caching layer (Redis)

---

## 📄 License

For demonstration/learning use. Respect each publisher's terms, `robots.txt`, and copyright.
