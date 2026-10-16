import { fetchFeed } from './fetch.js';
import { classify } from './classify.js';
import { fingerprint } from '../utils/text.js';
import { listSources, recordFetch } from '../models/sources.js';
import { upsertArticle } from '../models/articles.js';
import getDb from '../db/database.js';
import { cleanupArticles } from '../db/cleanup.js';
import config from '../config.js';
import { mapConcurrent } from '../utils/concurrency.js';

async function setMeta(key, value) {
  const db = getDb();
  await db.run(
    'INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    [key, JSON.stringify(value)]
  );
}

/**
 * Run one scrape cycle over all enabled sources.
 *
 * Feeds are fetched in parallel (the slow, network-bound part) so one slow or
 * dead feed never blocks the others. Inserts run sequentially to avoid SQLite
 * write contention. Sources in a failure backoff window are skipped; every
 * outcome is recorded (status/last error/backoff) and the cycle stores the last
 * scrape time + stats so `/api/scrape/health` can report it.
 */
export async function runScrapeCycle({ limit = 60 } = {}) {
  const now = Date.now();
  const sources = await listSources({ enabledOnly: true });
  const summary = {
    startedAt: now,
    sources: [],
    totalFetched: 0,
    totalInserted: 0,
    totalDuplicates: 0,
    totalNotModified: 0,
    errors: [],
  };

  // Fetch all feeds in parallel (bounded concurrency) with per-source errors captured.
  const fetched = await mapConcurrent(sources, config.scrape.concurrency, async (source) => {
    // Respect the failure backoff window (skip sources still cooling down).
    if (source.next_retry_at && Number(source.next_retry_at) > now) {
      return { source, items: [], error: 'backoff', skipped: true };
    }
    try {
      const result = await fetchFeed(source.feed_url, { etag: source.etag, lastModified: source.last_modified });
      return { source, ...result, items: result.items.slice(0, limit), error: null, skipped: false };
    } catch (e) {
      const error = String(e && e.message || e);
      return { source, items: [], error, skipped: false };
    }
  });

  for (const { source, items, error, skipped, notModified, etag, lastModified } of fetched) {
    const srcStat = {
      sourceId: Number(source.id),
      sourceName: source.name,
      fetched: skipped ? 0 : items.length,
      inserted: 0,
      duplicated: 0,
      failed: 0,
      notModified: Boolean(notModified),
      error: error || null,
      skipped: Boolean(skipped),
    };
    if (error) {
      summary.errors.push({ source: source.name, error, skipped: Boolean(skipped) });
    }
    for (const item of items) {
      if (!item.title || !item.url) continue; // skip malformed entries
      try {
        const { category } = classify(item.title, item.summary);
        const fp = fingerprint(item.title);
        const result = await upsertArticle({
          sourceId: source.id,
          title: item.title,
          summary: item.summary || null,
          url: item.url,
          imageUrl: item.imageUrl || null,
          publishedAt: item.publishedAt,
          category,
          fetchedAt: Date.now(),
          fingerprint: fp,
        });
        if (result.inserted) srcStat.inserted += 1;
        else srcStat.duplicated += 1;
      } catch (e) {
        const insertError = `insert: ${String(e && e.message || e)}`;
        srcStat.failed += 1;
        srcStat.error = srcStat.error || insertError;
        summary.errors.push({ source: source.name, error: insertError, skipped: false });
      }
    }
    // Commit validators only after successful ingestion, so failed writes get retried.
    if (!skipped) await recordFetch(source.id, { ok: !srcStat.error, error: srcStat.error, etag, lastModified });
    summary.sources.push(srcStat);
    summary.totalFetched += srcStat.fetched;
    summary.totalInserted += srcStat.inserted;
    summary.totalDuplicates += srcStat.duplicated;
    if (notModified) summary.totalNotModified += 1;
  }

  summary.finishedAt = Date.now();
  // Enforce retention: keep the DB bounded (newest N per source, not older than N days).
  summary.cleanup = await cleanupArticles();
  // Persist last-scrape metadata for the health endpoint.
  await setMeta('last_scrape_at', now);
  await setMeta('last_scrape_stats', summary);
  return summary;
}
