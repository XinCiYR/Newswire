import { useState, useMemo, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useArticles } from '../hooks';
import ArticleGrid from '../components/ArticleGrid';
import { CategoryBar, Pager } from '../components/Tabs';
import Seo from '../components/Seo';
import FilterBar, { RANGE_MS } from '../components/FilterBar';
import { CATEGORIES } from '../lib';

const PAGE_SIZE = 24;

export default function CategoryPage() {
  const { category } = useParams();
  const valid = CATEGORIES.some((c) => c.key === category);
  const [offset, setOffset] = useState(0);
  const [source, setSource] = useState('');
  const [range, setRange] = useState('');
  const loadParams = useMemo(() => ({
    category, limit: PAGE_SIZE, offset,
    sourceId: source || undefined,
    since: range ? Date.now() - RANGE_MS[range] : undefined,
  }), [category, offset, source, range]);
  const { articles, total, loading, error, reload } = useArticles(loadParams);

  // Reset to the first page when jumping to another category.
  useEffect(() => {
    setOffset(0);
    window.scrollTo({ top: 0 });
  }, [category]);

  if (!valid) {
    return (
      <div className="container" style={{ padding: '80px 20px' }}>
        <p>Unknown category. <Link to="/">Back to home</Link></p>
      </div>
    );
  }

  return (
    <div className="container" style={{ paddingTop: 36, paddingBottom: 40 }}>
      <Seo title={category} description={`The latest news in the ${category} category.`} />
      <CategoryBar active={category} />
      <FilterBar source={source} range={range} onChange={(p) => { setSource(p.source ?? source); setRange(p.range ?? range); setOffset(0); }} />
      <div className="section-head">
        <h2>{category}</h2>
        <span className="count">{total} articles</span>
      </div>
      <ArticleGrid
        articles={articles}
        loading={loading}
        error={error}
        onRetry={reload}
        empty={{ title: `No ${category} articles meet these filters`, message: 'Try widening the source or time range.' }}
      />
      <Pager offset={offset} limit={PAGE_SIZE} total={total} onPage={(p) => { setOffset((p - 1) * PAGE_SIZE); window.scrollTo({ top: 0 }); }} />
    </div>
  );
}
