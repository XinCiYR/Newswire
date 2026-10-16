import Parser from 'rss-parser';
import { toEpochMs } from '../utils/text.js';
import { httpUrl } from '../utils/url.js';
import config from '../config.js';

/**
 * rss-parser with extra namespaced fields so we can pull image URLs that feeds
 * put in media:content / media:thumbnail / content:encoded.
 */
const parser = new Parser({
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: false }],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: false }],
      ['content:encoded', 'contentEncoded', { keepArray: false }],
    ],
  },
});

const MAX_SUMMARY_LEN = 400;

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Sentence-aware summary: keeps whole sentences up to `max` chars (never cuts a
 * sentence mid-way on a word boundary), adds an ellipsis if truncated.
 */
function summarize(text, max) {
  const t = stripHtml(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (t.length <= max) return t;
  const sentences = t.match(/[^.!?]+[.!?]+/g) || [t];
  let out = '';
  for (const s of sentences) {
    const next = out ? `${out} ${s}` : s;
    if (next.length > max) break;
    out = next;
  }
  if (!out) {
    // No whole sentence fit — cut on the last word boundary within the limit.
    out = t.slice(0, max);
    const sp = out.lastIndexOf(' ');
    if (sp > max * 0.6) out = out.slice(0, sp);
    out += '…';
  } else if (t.length > out.length) {
    out += '…';
  }
  return out.trim();
}

function pickImage(item) {
  // 1) Structured media fields (enclosure, media:content, media:thumbnail).
  const candidates = [item.mediaContent, item.mediaThumbnail, item.enclosure];
  for (const c of candidates) {
    if (c && typeof c === 'object' && c.url) return c.url;
    if (typeof c === 'string' && /^https?:\/\//.test(c)) return c;
  }
  // 2) First <img> embedded in the raw content/description HTML.
  const raw = [item.contentEncoded, item.content, item['content:encoded'], item.description, item.summary]
    .filter(Boolean)
    .join(' ');
  const m = raw.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (m && /^https?:\/\//.test(m[1]) && !/logo|icon|avatar|pixel|tracking|spacer/i.test(m[1])) {
    return m[1];
  }
  return null;
}

/**
 * Fetch and parse a feed. Resolves to a list of normalized article-ish objects.
 * Throws on network errors so the caller can log + continue with other feeds.
 */
export async function fetchFeed(feedUrl, {
  etag = null, lastModified = null,
  timeoutMs = config.scrape.timeoutMs, maxBytes = config.scrape.maxResponseBytes,
} = {}) {
  const url = httpUrl(feedUrl);
  if (!url) throw new Error('Feed must use an absolute HTTP(S) URL');
  const headers = {
    'User-Agent': 'Newswire/1.0 (RSS reader)',
    Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
  };
  if (etag) headers['If-None-Match'] = etag;
  if (lastModified) headers['If-Modified-Since'] = lastModified;
  // The signal also bounds streaming/slow response bodies, not just headers.
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  const validators = {
    etag: response.headers.get('etag'),
    lastModified: response.headers.get('last-modified'),
  };
  if (response.status === 304) {
    return { items: [], notModified: true, etag: validators.etag || etag, lastModified: validators.lastModified || lastModified };
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Feed HTTP ${response.status}`);
  }
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    throw new Error(`Feed exceeds ${maxBytes} byte limit`);
  }
  const chunks = [];
  let size = 0;
  if (!response.body) throw new Error('Feed response has no body');
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      // Counts decoded bytes too, so compression cannot bypass the memory cap.
      if (size > maxBytes) throw new Error(`Feed exceeds ${maxBytes} byte limit`);
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const feed = await parser.parseString(Buffer.concat(chunks, size).toString('utf8'));
  const items = (feed.items || []).map((item) => {
    const title = stripHtml(item.title || '').trim();
    const url = httpUrl(item.link) || '';
    // Prefer RSS description; fall back to content/encoded, then content.
    const rawSummary = item.contentSnippet || item.content || item.summary || item.contentEncoded || '';
    const summary = summarize(rawSummary, MAX_SUMMARY_LEN);
    const publishedAt = toEpochMs(item.isoDate || item.pubDate || item.pubdate);
    const imageUrl = httpUrl(pickImage(item));
    return { title, url, summary, publishedAt, imageUrl };
  });
  return { feedTitle: feed.title || feedUrl, items, notModified: false, ...validators };
}

export { stripHtml };
