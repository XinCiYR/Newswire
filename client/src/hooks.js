import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from './api';
import { useAuth } from './auth';

/** Fetch a paged article list, reconciling async updates (prevents stale writes). */
export function useArticles(params = {}) {
  const { user, ready } = useAuth();
  const [state, setState] = useState({ articles: [], total: 0, loading: true, error: null });
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mySeq = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api.articles(params);
      if (seq.current === mySeq) {
        setState({ articles: data.articles || [], total: data.total || 0, loading: false, error: null });
      }
    } catch (e) {
      if (seq.current === mySeq) {
        setState((s) => ({ ...s, loading: false, error: e.message }));
      }
    }
  }, [JSON.stringify(params), user?.id, ready]);

  useEffect(() => {
    load();
    return () => { seq.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  return { ...state, reload: load };
}

export function useCategories() {
  const [cats, setCats] = useState([]);
  useEffect(() => {
    api.categories().then((r) => setCats(r.categories || [])).catch(() => {});
  }, []);
  return cats;
}
