import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { categoryGlassGradient, formatTime } from '../lib';

/** Homepage "Today's Must-Reads": a compact strip of the top 3 daily picks. */
export default function DailyHighlights() {
  const [daily, setDaily] = useState({ items: [], stale: false });

  useEffect(() => {
    let live = true;
    api.daily()
      .then((r) => {
        if (!live) return;
        setDaily({ items: (r.articles || []).slice(0, 3), stale: Boolean(r.stale) });
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  if (!daily.items.length) return null;

  return (
    <section className="daily">
      <div className="section-head">
        <h2>{daily.stale ? 'Latest Must-Reads' : 'Today’s Must-Reads'}</h2>
        <Link className="daily-more" to="/daily">Full brief →</Link>
      </div>
      <div className="daily-strip">
        {daily.items.map((a, i) => (
          <Link key={a.id} className="daily-row" to={`/article/${a.id}`}>
            <span className="daily-row-num">{i + 1}</span>
            <span className="daily-row-accent" style={{ background: categoryGlassGradient(a.category) }} />
            <span className="daily-row-text">
              <span className="daily-row-title">{a.title}</span>
              <span className="meta">
                <span className="cat">{a.category}</span>
                <span className="dot" />
                <span>{formatTime(a.publishedAt)}</span>
                <span className="dot" />
                <span className="src">{a.sourceName}</span>
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
