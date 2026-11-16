import { runScrapeCycle } from './worker.js';
import config from '../config.js';
import getDb from '../db/database.js';

let timer = null;
let running = false;

/**
 * Trigger one scrape cycle, guarding against overlapping runs.
 * Returns the summary. Used by the scheduler and the external /api/cron/trigger.
 */
export async function triggerScrape() {
  if (running) {
    return { skipped: true, reason: 'already-running' };
  }
  running = true;
  try {
    const summary = await runScrapeCycle();
    return summary;
  } finally {
    running = false;
  }
}

/** Start the in-process scheduler (an initial run + periodic runs). */
export function startScheduler() {
  if (!config.scrape.enableInProcessCron) {
    console.log('[scheduler] disabled (ENABLE_IN_PROCESS_CRON=false)');
    return;
  }
  const intervalMs = config.scrape.intervalMinutes * 60 * 1000;
  // First run shortly after boot.
  setTimeout(() => {
    triggerScrape()
      .then((s) => console.log('[scheduler] initial scrape done:', summarize(s)))
      .catch((e) => console.error('[scheduler] initial scrape failed', e));
  }, 5000);

  timer = setInterval(() => {
    triggerScrape()
      .then((s) => console.log(`[scheduler] periodic scrape done:`, summarize(s)))
      .catch((e) => console.error('[scheduler] periodic scrape failed', e));
  }, intervalMs);
  console.log(`[scheduler] started: every ${config.scrape.intervalMinutes} min`);
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** True when the last successful cycle is older than two scrape intervals. */
export function scrapeIsStale(lastScrapeAt, now = Date.now()) {
  const maxAgeMs = config.scrape.intervalMinutes * 2 * 60 * 1000;
  return !Number(lastScrapeAt) || now - Number(lastScrapeAt) > maxAgeMs;
}

const WATCHDOG_CHECK_MS = 60 * 1000;
let lastWatchdogCheck = 0;

/**
 * Self-healing fallback for sleeping/ephemeral deployments that rely on an
 * external scheduler (e.g. a free Render instance + cron-job.org). A request
 * wakes the process; if the stored last-scrape time is older than two intervals
 * we start one catch-up cycle in the background. It is a no-op while either the
 * in-process or the external scheduler keeps the data fresh, and never throws
 * into the request path.
 */
export async function ensureFreshData() {
  if (!config.scrape.watchdog) return;
  const now = Date.now();
  if (now - lastWatchdogCheck < WATCHDOG_CHECK_MS) return;
  lastWatchdogCheck = now;
  try {
    const row = await getDb().get("SELECT value FROM app_meta WHERE key = 'last_scrape_at'");
    let last = null;
    if (row) {
      try { last = Number(JSON.parse(row.value)); } catch { last = Number(row.value); }
    }
    if (!scrapeIsStale(last, now)) return;
    console.log('[watchdog] data is stale; starting a catch-up scrape');
    triggerScrape()
      .then((s) => console.log('[watchdog] catch-up scrape done:', summarize(s)))
      .catch((e) => console.error('[watchdog] catch-up scrape failed', e));
  } catch {
    // A watchdog failure must never affect the request that woke the instance.
  }
}

function summarize(s) {
  if (s && s.skipped) return `skipped (${s.reason})`;
  return `fetched=${s.totalFetched} inserted=${s.totalInserted} dup=${s.totalDuplicates} errors=${s.errors.length}`;
}
