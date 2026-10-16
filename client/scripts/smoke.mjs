// Smoke-render the built SPA in a jsdom DOM to catch fatal runtime errors and
// confirm real data actually renders. Requires the backend to be running
// (it proxies the app's /api requests to http://localhost:4000).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(clientRoot, 'dist');
const html = readFileSync(path.join(dist, 'index.html'), 'utf8');
const bundleFile = html.match(/src="\/assets\/([^"]+\.js)"/)?.[1];
if (!bundleFile) throw new Error('No JS bundle found in dist/assets');
const baseUrl = process.env.SMOKE_BASE_URL || 'http://localhost:4000';
const realFetch = globalThis.fetch;

const dom = new JSDOM(html, {
  url: baseUrl,
  pretendToBeVisual: true,
});
const { window } = dom;

// Expose browser globals to the ESM bundle.
for (const key of Object.getOwnPropertyNames(window)) {
  if (!(key in globalThis)) {
    try {
      const val = window[key];
      Object.defineProperty(globalThis, key, { configurable: true, get: () => window[key] });
    } catch {
      // ignore non-configurable
    }
  }
}

// Patch fetch so relative URLs like "/api/..." reach the live server.
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? new URL(input, baseUrl).href : input;
  return realFetch(url, init);
};
window.fetch = globalThis.fetch;

// Patch history/matcher helpers if present.
if (typeof window.history !== 'undefined' && !window.history.pushState) {
  window.history.pushState = (s, t, u) => { window.location.href = u; };
}

const root = window.document.getElementById('root');
if (!root) throw new Error('No #root element in index.html');

await import(pathToFileURL(path.join(dist, 'assets', bundleFile)).href);

// Give React + a network round-trip time to render.
await new Promise((r) => setTimeout(r, 1500));

const cards = root.querySelectorAll('.card');
const brand = root.querySelector('.logo')?.textContent || '';
const heroH1 = root.querySelector('.hero h1')?.textContent || '';
const allTab = root.querySelector('.cat-tabs a');
const allCount = allTab?.querySelector('.num')?.textContent?.trim() || '';
const solidThumb = root.querySelector('.card .thumb');
const thumbBanner = root.querySelector('.card .thumb-banner');
const bannerBg = thumbBanner?.style?.background || '';

console.log('root children:', root.childElementCount);
console.log('brand:', brand.trim());
console.log('hero:', heroH1.trim());
console.log('article cards rendered:', cards.length);
console.log('All tab count:', allCount, '(should be a positive number)');
console.log('thumb present:', !!solidThumb, '| gradient banner:', !!thumbBanner);

if (root.childElementCount === 0) {
  console.error('SMOKE FAIL: React did not mount.');
  process.exit(1);
}
if (/◆|mark/i.test(brand)) {
  console.error('SMOKE FAIL: logo mark (red square) is still present.');
  process.exit(1);
}
if (!cards.length) {
  console.error('SMOKE FAIL: no article cards rendered (check API/search).');
  console.error('Root HTML snippet:', root.innerHTML.slice(0, 500));
  process.exit(1);
}
if (!(Number(allCount) > 0)) {
  console.error('SMOKE FAIL: "All" category tab has no count.');
  process.exit(1);
}
if (!solidThumb || !thumbBanner || !bannerBg) {
  console.error('SMOKE FAIL: card thumb is not rendering the category gradient banner.');
  process.exit(1);
}
console.log('SMOKE OK: React mounted, logo cleaned, "All" tab count present, gradient banner rendered.');
dom.window.close();
globalThis.fetch = realFetch;
