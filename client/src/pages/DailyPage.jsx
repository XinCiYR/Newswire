import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { formatTime } from '../lib';
import FavoriteButton from '../components/FavoriteButton';
import Seo from '../components/Seo';
import { Loader, Empty } from '../components/States';

export default function DailyPage() {
  const { user } = useAuth();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    api.daily()
      .then((r) => { if (live) setItems(r.articles || []); })
      .catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [user?.id]);

  if (error) return <Empty icon="⚠️" title="Couldn’t load today’s brief" message={error} />;
  if (!items) return <Loader />;

  return (
    <div className="container" style={{ paddingTop: 36, paddingBottom: 40 }}>
      <Seo title="Today’s Must-Reads" description="A curated daily brief of the top stories." />
      <div className="section-head">
        <h2>Today’s Must-Reads</h2>
        <span className="count">{items.length} picks</span>
      </div>
      {items.length === 0 ? (
        <Empty icon="📰" title="Nothing curated yet" message="The daily brief will populate as feeds are scraped." />
      ) : (
        <ol className="daily-list">
          {items.map((a, i) => (
            <li key={a.id} className="daily-item">
              <span className="daily-num">{i + 1}</span>
              <div className="daily-body">
                <div className="meta">
                  <span className="cat">{a.category}</span>
                  <span className="dot" />
                  <span>{formatTime(a.publishedAt)}</span>
                  <span className="dot" />
                  <a className="src" href={a.sourceUrl} target="_blank" rel="noopener noreferrer">{a.sourceName}</a>
                </div>
                <h3><Link to={`/article/${a.id}`}>{a.title}</Link></h3>
                {a.summary ? <p className="summary">{a.summary}</p> : null}
              </div>
              <FavoriteButton articleId={a.id} initial={a.favorited} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
