import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import FavoriteButton from '../components/FavoriteButton';
import ArticleCard from '../components/ArticleCard';
import { Loader, Empty } from '../components/States';
import { CategoryBar } from '../components/Tabs';
import Seo from '../components/Seo';
import ShareButton from '../components/ShareButton';
import Dropdown from '../components/Dropdown';
import { EmptySearchIcon } from '../components/Icons';
import { formatTime, CATEGORIES, categoryGlassGradient, readingTime } from '../lib';

export default function ArticlePage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [article, setArticle] = useState(null);
  const [related, setRelated] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    Promise.all([api.article(id), api.related(id)]).then(([a, r]) => {
      if (!live) return;
      setArticle(a.article);
      setRelated(r.articles || []);
    })
      .catch((e) => { if (live) setError(e.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [id, user?.id]);

  // Record a view (public endpoint counts views; also logs history if logged in).
  useEffect(() => {
    if (id) api.recordView(id).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function correctCategory(cat) {
    try {
      const r = await api.correctCategory(id, cat);
      setArticle(r.article);
      setEditing(false);
    } catch { /* ignore */ }
  }

  if (loading) return <Loader />;
  if (error || !article) return <Empty icon={<EmptySearchIcon />} title="Article not found" message={error} />;

  return (
    <>
      <Seo title={article.title} description={article.summary} image={article.imageUrl} type="article" />
      <div className="container" style={{ paddingTop: 24 }}>
        <CategoryBar active={article.category} />
      </div>
      <article className="detail">
      <span className="cat">{article.category}</span>
      <h1>{article.title}</h1>
      <div className="byline">
        <a className="source" href={article.sourceUrl} target="_blank" rel="noopener noreferrer">{article.sourceName}</a>
        <span>·</span>
        <span>{article.publishedAt ? formatTime(article.publishedAt) : 'recent'}</span>
        <span>·</span>
        <span>{readingTime(article.summary)}</span>
        <span>·</span>
        <Link to={`/category/${article.category}`}>{article.category}</Link>
      </div>

      <div className="cover" style={{ background: categoryGlassGradient(article.category) }} />

      {article.coverage && article.coverage.length > 0 ? (
        <div className="coverage-note">
          <span className="coverage-label">Also covered by</span>
          <span className="coverage-sources">
            {article.coverage.map((s, i) => (
              <span key={i}>
                {i > 0 && <span className="coverage-sep">, </span>}
                <a href={s.url} target="_blank" rel="noopener noreferrer">{s.name}</a>
              </span>
            ))}
          </span>
        </div>
      ) : null}

      <div className="actions-row">
        <a className="read-original" href={article.url} target="_blank" rel="noopener noreferrer">
          Read original ↗
        </a>
        <FavoriteButton articleId={article.id} initial={article.favorited} size="lg" />
        <ShareButton title={article.title} url={article.url} />
        {user?.isAdmin && (
          editing ? (
            <Dropdown
              value={article.category}
              onChange={(v) => { correctCategory(String(v)); setEditing(false); }}
              ariaLabel="Edit category"
              options={CATEGORIES.filter((c) => c.key !== 'All').map((c) => ({ value: c.key, label: c.label }))}
            />
          ) : (
            <button className="link-btn" onClick={() => setEditing(true)}>Edit category</button>
          )
        )}
      </div>

      <p className="summary">{article.summary || 'This article has no summary available. Open the original source for full details.'}</p>

      <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
        We only display a short summary and a link to the original publisher. Please
        read the full article on {article.sourceName}.
      </p>
      </article>

      {related.length > 0 && (
        <div className="container" style={{ paddingBottom: 40 }}>
          <div className="section-head">
            <h2>Related</h2>
            <span className="count">{related.length} articles</span>
          </div>
          <div className="grid">
            {related.map((a) => <ArticleCard key={a.id} article={a} />)}
          </div>
        </div>
      )}
    </>
  );
}
