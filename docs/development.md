# Newswire developer reference

[Project overview](../README.md) · [Deployment runbook](../DEPLOYMENT.md) · [Implementation notes](../ITERATION_NOTES.md)

## Layout

| Path | Responsibility |
| --- | --- |
| `client/src/pages/` | News, daily brief, search, articles, and account pages |
| `client/src/api.js` | API requests and session refresh |
| `server/src/app.js` | Express API and frontend serving |
| `server/src/scraper/` | Feed definitions, HTTP fetching, classification, and scheduling |
| `server/src/db/` | SQLite and PostgreSQL connections, migrations, and retention |
| `server/src/models/` | News, bookmark and history queries |
| `server/test/`, `client/test/` | Regression and integration tests |

## Configuration

Copy [`.env.example`](../.env.example) to `server/.env` to customize a local run. An empty `DATABASE_URL` uses SQLite at `SQLITE_PATH`; PostgreSQL is recommended for deployments without a persistent filesystem. In production use separate random signing keys and a random cron secret (at least 32 characters each). Keep secrets out of Git.

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | HTTP listener |
| `DATABASE_URL` | empty | PostgreSQL connection string |
| `SQLITE_PATH` | `./data/news.sqlite` | Local database path, relative to `server/` |
| `ENABLE_IN_PROCESS_CRON` | `true` | Initial and recurring in-process scrape |
| `SCRAPE_WATCHDOG` | `true` | Background catch-up on requests when feeds are stale |
| `SCRAPE_INTERVAL_MINUTES` | `30` | In-process scrape interval |
| `SCRAPE_CONCURRENCY` | `4` | Concurrent feed requests (capped at 16) |
| `SCRAPE_TIMEOUT_MS` | `20000` | Timeout for the HTTP request and body |
| `SCRAPE_MAX_RESPONSE_BYTES` | `2097152` | Feed response cap, including decoded content |
| `ARTICLE_RETENTION_DAYS` | `30` | Age-based pruning, with favorites protected |
| `MAX_ARTICLES_PER_SOURCE` | `1000` | Per-source retention cap |
| `HISTORY_LIMIT` | `200` | Browsing-history row limit per user |
| `ADMIN_USER_IDS` | empty | Comma-separated IDs for source and category writes |

## API

Authenticated endpoints accept `Authorization: Bearer <accessToken>`.

| Method and path | Access | Purpose |
| --- | --- | --- |
| `GET /api/health` | Public | Version and deployment health |
| `GET /api/categories`, `GET /api/sources` | Public | Categories and feed sources |
| `GET /api/articles` | Public | List or search; supports `category`, `sourceId`, `since`, `q`, `order`, `limit`, `offset` |
| `GET /api/articles/:id`, `GET /api/articles/:id/related` | Public | Article detail or related stories |
| `POST /api/articles/:id/view` | Public | Increment views and append history when signed in |
| `GET /api/daily` | Public | Ranked brief and freshness information |
| `GET /api/changelog` | Public | App update log |
| `POST /api/auth/register`, `/login`, `/refresh` | Public | Create or renew a session |
| `GET /api/auth/me`, `PATCH /api/auth/profile`, `POST /api/auth/logout` | Signed in | Account and session settings |
| `GET /api/favorites`, `POST /api/favorites/:id`, `DELETE /api/favorites/:id` | Signed in | Manage bookmarks |
| `GET /api/history`, `DELETE /api/history` | Signed in | Read or clear browsing history |
| `PATCH /api/articles/:id/category`, `POST /api/sources` | Admin | Correct classification or add a source |
| `GET /api/scrape/health` | Public | Last scrape and source health |
| `POST /api/cron/trigger` | `x-cron-secret` | Trigger an ingestion cycle |

## Checks

```bash
npm test
npm --prefix client run smoke:test
npm run test:postgres  # With TEST_DATABASE_URL pointing to a disposable database
npm run test:docker    # With Docker running
```

Rebuild the frontend with `npm run build:client` after changing client code. Use `npm run dev:server` to restart the server automatically during development.
