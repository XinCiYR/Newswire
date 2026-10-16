import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useArticles } from '../hooks';
import ArticleGrid from '../components/ArticleGrid';
import { Pager } from '../components/Tabs';
import Seo from '../components/Seo';
import { EmptySearchIcon } from '../components/Icons';

const PAGE_SIZE = 24;

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const offset = Math.max(0, parseInt(params.get('offset'), 10) || 0);
  function setOffset(next) {
    setParams((prev) => {
      const nextParams = new URLSearchParams(prev);
      if (next) nextParams.set('offset', String(next));
      else nextParams.delete('offset');
      return nextParams;
    });
  }
  const loadParams = useCallback(() => ({ q, limit: PAGE_SIZE, offset }), [q, offset]);
  const { articles, total, loading, error, reload } = useArticles(loadParams());

  return (
    <div className="container" style={{ paddingTop: 36, paddingBottom: 40 }}>
      <Seo title={q ? `Search: ${q}` : 'Search'} description={`Search results for “${q}”.`} />
      <div className="section-head">
        <h2>{q ? `Results for “${q}”` : 'Search'}</h2>
        <span className="count">{total} results</span>
      </div>
      <ArticleGrid
        articles={articles}
        loading={loading}
        error={error}
        onRetry={reload}
        empty={{ icon: <EmptySearchIcon />, title: 'No results', message: `Nothing matched “${q}”. Try a different keyword.` }}
      />
      <Pager offset={offset} limit={PAGE_SIZE} total={total} onPage={(p) => { setOffset((p - 1) * PAGE_SIZE); window.scrollTo({ top: 0 }); }} />
    </div>
  );
}
