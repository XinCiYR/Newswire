# 🚀 Deploy Newswire to Render.com — Detailed Step-by-Step

A click-by-click, command-by-command guide (Windows PowerShell / terminal assumed).
Do it in order. Total ≈ 20–30 min.

> Quick facts: Render (free) **sleeps** after ~15 min idle, so we use an external
> scheduler (cron-job.org) to keep news fresh. We use an **external Postgres**
> (Neon) so user data survives redeploys. The app auto-migrates + auto-seeds
> the 10 default sources — no manual DB seeding.

---

## 0. Prerequisites
- A **GitHub** account.
- **Git** installed on your PC. Check: `git --version`. If missing:
  - Windows: open PowerShell → `winget install --id Git.Git` → reopen terminal → `git --version`.
- A **Neon** account (https://neon.tech) for the database.
- A **Render** account (https://render.com).
- (Optional) A **cron-job.org** account (free) for the external scheduler.

---

## 1. Put the project on GitHub

### 1.1 Open a terminal in the project folder
```powershell
cd D:\AI_Deepseek_Workplace_NEWS_Web
```

### 1.2 Tell Git who you are (once)
```powershell
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

### 1.3 Init + first commit
```powershell
git init
git add -A
git commit -m "Newswire — news aggregator"
git branch -M main
```
> Expected: a few lines like `create mode 100644 ...`.

### 1.4 Create the GitHub repo
- Go to https://github.com/new
- Repository name: `newswire`
- **Do NOT** tick "Add a README / .gitignore / license" (we already have them; skipping avoids a push conflict).
- **Public** or **Private** both work (Render needs access; public is simplest).
- Click **Create repository**.

### 1.5 Link and push
```powershell
git remote add origin https://github.com/YOUR_USERNAME/newswire.git
git push -u origin main
```
- Git will ask for login. On Windows:
  - It may open a browser → sign in → **Authorize**.
  - If it asks for a **password/token**, use a **Personal Access Token** (see below), not your account password.

### 1.6 If auth fails — create a Personal Access Token (PAT)
- GitHub → top-right avatar → **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)** → **Generate new token (classic)**.
- Check the `repo` scope → Generate → **copy** the token (starts `ghp_...`).
- Push again; when asked for password paste the **token**.
```powershell
git push -u origin main
```
> Verify: refresh the GitHub repo page — you should see `server/`, `client/`, `render.yaml`, etc.

---

## 2. Create the durable database on Neon

1. Sign in at https://neon.tech → **New Project**.
2. Name: `newswire-db`. Region: pick something **close to your Render region** (e.g., `us-east-1`). Leave defaults → **Create**.
3. Wait ~1 min for the database to be ready. You'll land on the project dashboard.
4. Click **Connect** (top right). You'll see the connection string.
5. Choose the **Pooled** connection for a web app (the one containing `-pooler` or `-pooler`), e.g.:
   ```
   postgresql://user:password@ep-xxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require
   ```
   Copy it. **Keep it.** This is your `DATABASE_URL`.
6. If the URL has no `?sslmode=require`, **add it** to the end.
> ✅ You now hold a `DATABASE_URL`.

---

## 3. Deploy on Render

### 3.1 Sign in & connect GitHub
1. https://render.com → sign up / sign in.
2. Render → **New +** (top right) → **Blueprint** (this reads `render.yaml`).
3. It asks to **connect a GitHub repository** → click **Connect account** → authorize. Pick the `newswire` repo → **Connect**.

### 3.2 Apply the blueprint
1. Render reads `render.yaml` and shows a plan with **one web service `newswire`** (Plan **Free**).
2. It may list env vars. For **`DATABASE_URL`** (marked `sync: false`) you must provide a value → paste your Neon connection string.
3. Click **Apply**. Render then runs the build.

### 3.3 What happens during build
Render runs:
```bash
npm ci --prefix server
npm ci --prefix client
npm run build --prefix client
npm run start
```
- First build installs deps + bundles the React frontend (with fonts) — takes a few minutes.
- The app boots, **auto-migrates** the DB, **auto-seeds the 10 sources**, and starts on port 4000.
- When finished you get a URL like: `https://newswire-xxxx.onrender.com`.

> If anything red appears in the **Logs** tab, wait a bit then retry; the most common
> first-time issue is a slow npm registry or the Client build. See section 7 (troubleshooting).

### 3.4 (Alternative) Manual web service, if Blueprint gives trouble
- **New + → Web Service** → connect repo → pick `newswire`.
- **Runtime**: `Node`.
- **Build Command**:
  ```bash
  npm ci --prefix server && npm ci --prefix client && npm run build --prefix client
  ```
- **Start Command**: `npm run start`.
- **Instance Type**: Free. → **Create Web Service**.
- Then set env vars (section 4).

---

## 4. Set environment variables

In Render: your service → **Environment** tab. Click **Add Environment Variable** for each:

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `NODE_VERSION` | `24` |
| `TRUST_PROXY` | `1` for this Render reverse-proxy topology |
| `ADMIN_USER_IDS` | IDs of existing accounts you control; empty disables administrative writes |
| `DATABASE_URL` | your Neon connection string |
| `JWT_ACCESS_SECRET` | long random |
| `JWT_REFRESH_SECRET` | long random |
| `CRON_SECRET` | long random |
| `ENABLE_IN_PROCESS_CRON` | `false` |
| `SCRAPE_INTERVAL_MINUTES` | `30` |
| `CORS_ORIGINS` | `*` |

To generate the secrets (run in your local terminal):
```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```
Run it **3 times** and paste each into `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CRON_SECRET`.

After editing env vars, click **Restart service** (top of the service page) to apply.

Use Node 24.x. All three secrets must be random, at least 32 characters, with different
JWT access/refresh secrets; startup now rejects development defaults in production.
For administrator access, first sign in to an existing owner-controlled account and
read its `id` from `/api/auth/me`, then configure `ADMIN_USER_IDS` (e.g. `4,12`).
Do not guess IDs of accounts that have not been created. Existing sessions must sign
in again once after deploying the refresh-token migration; accounts and saved data remain.

---

## 5. External scheduler (wake the seed / keep news fresh)

Render free instances **sleep after ~15 min idle**. While asleep the internal cron
pauses, so we call the scrape endpoint externally.

1. Open https://cron-job.org → **Sign up** (free) → confirm email → log in.
2. Click **Create cronjob**.
3. Fill:
   - **Title**: `newswire-scrape`
   - **URL**: `https://newswire-xxxx.onrender.com/api/cron/trigger`
   - **Execution method**: `POST`
   - **Headers**: add one row: key `x-cron-secret`, value = your `CRON_SECRET`
   - **Request body**: leave empty (or `{}`)
   - **Schedule**: `*/30 * * * *` (every 30 min)
4. **Save**. It will start hitting your site every 30 minutes.

> If you later move to an always-on plan, set `ENABLE_IN_PROCESS_CRON=true` and
> delete the cron-job.org job.

---

## 6. Verify (acceptance)

Open the app URL and check:
- [ ] Home loads; **Latest / Trending** toggle works; search returns results.
- [ ] Register → login → set display name; favorite/unfavorite (red heart); History records + hearts sync.
- [ ] Article page shows **Related** below and SEO title/description (browser tab title = article title).
- [ ] `https://your-url/api/health` → `{"ok":true}`.
- [ ] `https://your-url/api/scrape/health` → shows sources, last scrape time, article count.
- [ ] Trigger one scrape now: `curl -X POST https://your-url/api/cron/trigger -H "x-cron-secret: <CRON_SECRET>"` → check `/api/scrape/health` updated.

---

## 7. Troubleshooting

- **`DATABASE_URL` empty / connection errors** → confirm you set it in Environment and restarted; verify the string is the **pooled** Neon URL with `?sslmode=require`.
- **Build fails at `npm ci`** → free-tier build may be slow/timeout; go to **Events** and **Redeploy** (or bump plan during the first build). Also ensure you didn't accidentally wait a long time.
- **esbuild error in client build** → make sure you're using the repo's `client/package.json` build script (it includes the font loaders). Don't change it.
- **Site loads but no articles** → check `/api/scrape/health`; if sources exist but errors, wait for the next cron or trigger one. BBC/Guardian/NYT may need a real network (they work in production).
- **Login doesn't persist across restart** → secrets must stay the same; don't regenerate them after deploy.
- **Everything works but news not updating** → confirm cron-job.org job is enabled and `ENABLE_IN_PROCESS_CRON=false`, and that `x-cron-secret` matches.

---

## 8. Optional — custom domain
- Render → service → **Settings → Custom Domains** → add your domain.
- Follow the DNS instructions (add a CNAME). Render issues HTTPS automatically.

---

## 9. Daily ops / iteration

- **Verify changes**: `npm test`; for a dedicated test database set `TEST_DATABASE_URL`
  and run `npm run test:postgres`; with a running Docker engine use `npm run test:docker`.
  Tests create isolated temporary schemas and never select the application's `DATABASE_URL`.
- **New indexes**: startup adds fingerprint/publication, source/publication/ID, and
  PostgreSQL full-text GIN indexes. PostgreSQL builds these with `CONCURRENTLY` outside
  a transaction so ongoing article writes can continue; first startup can take longer.
  Monitor migration logs, disk space and DB activity when deploying against a large table.
- **Feed limits**: default concurrency 4, timeout 20 seconds, response limit 2 MiB;
  configure `SCRAPE_CONCURRENCY`, `SCRAPE_TIMEOUT_MS`, `SCRAPE_MAX_RESPONSE_BYTES` if needed.
  ETag/Last-Modified are persisted automatically; HTTP 304 is recorded as success.
- **Deploy code**: `git add -A && git commit -m "..." && git push` → Render auto-redeploys.
- **Add sources**: `POST /api/sources` with an administrator access token. Editing the built-in source list alone does not update a nonempty database; run `npm run seed` deliberately to sync defaults.
- **Backups**: use Neon snapshots / `pg_dump`. Back up accounts/favorites/history.
- **Rollback**: `git revert <sha>` + push, or Render → **Redeploy previous version**.
- **Monitor**: `https://your-url/api/health` (uptime monitor) + `/api/scrape/health`.
