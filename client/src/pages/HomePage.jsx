import { useState, useMemo } from 'react';
import { useArticles } from '../hooks';
import ArticleGrid from '../components/ArticleGrid';
import { CategoryBar, Pager } from '../components/Tabs';
import Seo from '../components/Seo';
import { NewsIcon } from '../components/Icons';
import DailyHighlights from '../components/DailyHighlights';
import FilterBar, { RANGE_MS } from '../components/FilterBar';

const PAGE_SIZE = 24;

export default function HomePage() {
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState('new'); // 'new' (Latest) | 'views' (Trending)
  const [source, setSource] = useState('');
  const [range, setRange] = useState('');

  const loadParams = useMemo(() => ({
    limit: PAGE_SIZE,
    offset,
    order: sort,
    sourceId: source || undefined,
    since: range ? Date.now() - RANGE_MS[range] : undefined,
  }), [offset, sort, source, range]);
  const { articles, total, loading, error, reload } = useArticles(loadParams);

  function switchSort(next) {
    if (next === sort) return;
    setSort(next);
    setOffset(0);
    window.scrollTo({ top: 0 });
  }

  return (
    <>
      <Seo />
      <section className="hero">
        <div className="hero-inner">
          <div className="kicker">Curated from across the web</div>
          <h1>All the news that&rsquo;s fit to read.</h1>
          <p>
            A multi-source English news brief — automatically gathered, categorized, and
            made searchable. Read the original articles at their source.
          </p>
        </div>
      </section>

      <div className="container" style={{ paddingBottom: 40 }}>
        <DailyHighlights />
        <CategoryBar active="All" />
        <FilterBar source={source} range={range} onChange={(p) => { setSource(p.source ?? source); setRange(p.range ?? range); setOffset(0); }} />
        <div className="section-head">
          <div className="sort-toggle" role="tablist">
            <button role="tab" className={sort === 'new' ? 'active' : ''} onClick={() => switchSort('new')}>Latest</button>
            <button role="tab" className={sort === 'views' ? 'active' : ''} onClick={() => switchSort('views')}>Trending</button>
          </div>
          <span className="count">{total} articles</span>
        </div>
        <ArticleGrid
          articles={articles}
          loading={loading}
          error={error}
          onRetry={reload}
          empty={{ icon: <NewsIcon />, title: 'No articles meet these filters', message: 'Try widening the source or time range.' }}
        />
        <Pager offset={offset} limit={PAGE_SIZE} total={total} onPage={(p) => { setOffset((p - 1) * PAGE_SIZE); window.scrollTo({ top: 0 }); }} />
      </div>
    </>
  );
}
