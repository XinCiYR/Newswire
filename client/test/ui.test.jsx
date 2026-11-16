import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../src/auth';
import { api } from '../src/api';
import HomePage from '../src/pages/HomePage';
import CategoryPage from '../src/pages/CategoryPage';
import DailyPage from '../src/pages/DailyPage';

let dom;
let root;
beforeEach(() => {
  dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  for (const key of ['window', 'document', 'localStorage', 'navigator']) {
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.scrollTo = () => {};
  root = createRoot(document.getElementById('root'));
  api.categories = async () => ({ categories: [] });
  api.sources = async () => ({ sources: [] });
  api.daily = async () => ({ articles: [] });
});
afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
});

for (const [name, Component, url, route] of [
  ['home', HomePage, '/', '/'],
  ['category', CategoryPage, '/category/Tech', '/category/:category'],
]) {
  test(`${name}: time filtering settles after loading without repeated requests`, async () => {
    let count = 0;
    const queries = [];
    api.articles = (params) => {
      queries.push({ ...params });
      count++;
      // Stop a regression from looping forever; the request-count assertion catches it.
      if (count > 10) return new Promise(() => {});
      return new Promise((resolve) => setTimeout(() => resolve({ articles: [], total: 0 }), 2));
    };
    await act(async () => root.render(
      <MemoryRouter initialEntries={[url]}><AuthProvider>
        <Routes><Route path={route} element={<Component />} /></Routes>
      </AuthProvider></MemoryRouter>
    ));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 15)); });
    const before = count;
    await act(async () => document.querySelector('[aria-label="Filter by time"]').click());
    const option = [...document.querySelectorAll('[role="option"]')].find((el) => el.textContent === 'Past 24 hours');
    await act(async () => option.click());
    for (let i = 0; i < 4; i++) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 15)); });
    }
    assert.equal(count, before + 1, 'one selection should issue exactly one article request');
    assert.ok(queries.at(-1).since > 0);
    assert.equal(document.querySelector('.loader'), null);
  });
}

test('daily: stale data shows the latest stories plus a freshness note', async () => {
  const publishedAt = Date.now() - 40 * 86400000;
  api.daily = async () => ({
    articles: [{
      id: 1,
      title: 'Still worth reading',
      category: 'Tech',
      publishedAt,
      sourceName: 'Test Source',
      sourceUrl: 'https://test.example',
    }],
    stale: true,
    windowHours: null,
    latestAt: publishedAt,
    lastScrapeAt: Date.now() - 31 * 86400000,
  });

  await act(async () => root.render(
    <MemoryRouter initialEntries={['/daily']}><AuthProvider>
      <Routes><Route path="/daily" element={<DailyPage />} /></Routes>
    </AuthProvider></MemoryRouter>
  ));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 15)); });

  const note = document.querySelector('.alert.info');
  assert.ok(note, 'stale data must be explained in the UI');
  assert.match(note.textContent, /No fresh stories/);
  assert.match(note.textContent, /latest available brief/);
  assert.equal(document.querySelectorAll('.daily-item').length, 1);
});

test('daily: fresh data has no freshness warning', async () => {
  const publishedAt = Date.now() - 3600000;
  api.daily = async () => ({
    articles: [{ id: 2, title: 'Fresh story', category: 'Tech', publishedAt, sourceName: 'Test Source', sourceUrl: 'https://test.example' }],
    stale: false,
    windowHours: 24,
    latestAt: publishedAt,
    lastScrapeAt: publishedAt,
  });

  await act(async () => root.render(
    <MemoryRouter initialEntries={['/daily']}><AuthProvider>
      <Routes><Route path="/daily" element={<DailyPage />} /></Routes>
    </AuthProvider></MemoryRouter>
  ));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 15)); });

  assert.equal(document.querySelector('.alert.info'), null);
  assert.equal(document.querySelectorAll('.daily-item').length, 1);
});
