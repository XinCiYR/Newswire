import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';

export default function FavoriteButton({ articleId, initial, size = 'sm', onChanged }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [on, setOn] = useState(Boolean(initial));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setOn(Boolean(user && initial)); }, [articleId, initial, user?.id]);

  async function toggle(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!user) {
      navigate('/login', { state: { from: location.pathname } });
      return;
    }
    setBusy(true);
    try {
      if (on) {
        const r = await api.removeFavorite(articleId);
        setOn(r.favorited);
        onChanged && onChanged(r.favorited, articleId);
      } else {
        const r = await api.addFavorite(articleId);
        setOn(r.favorited);
        onChanged && onChanged(r.favorited, articleId);
      }
    } catch (err) {
      // transient failure — leave as-is
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={`fav-btn ${size === 'lg' ? 'lg' : ''} ${on ? 'on' : ''}`}
      onClick={toggle}
      disabled={busy}
      title={on ? 'Remove from favorites' : 'Save to favorites'}
      aria-label={on ? 'Remove from favorites' : 'Save to favorites'}
    >
      {on ? '♥' : '♡'}
    </button>
  );
}
