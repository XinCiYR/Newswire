import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, getAuth, setAuth, clearAuth } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = getAuth();
    if (stored?.accessToken) {
      setUser(stored.user || null);
      // Validate/hydrate the user from the server.
      api.me()
        .then((r) => {
          if (!getAuth() || getAuth()?.user?.id !== stored.user?.id) return;
          const next = { ...getAuth(), user: r.user };
          setAuth(next);
          setUser(r.user);
        })
        .catch((err) => {
          const current = getAuth();
          if (current && current.user?.id !== stored.user?.id) return;
          if (err.status === 401) {
            clearAuth();
            setUser(null);
          }
        })
        .finally(() => setReady(true));
    } else {
      setReady(true);
    }
  }, []);

  const login = useCallback(async (email, password) => {
    const r = await api.login(email, password);
    setAuth({ accessToken: r.accessToken, refreshToken: r.refreshToken, user: r.user });
    setUser(r.user);
    return r.user;
  }, []);

  const register = useCallback(async (email, password, name) => {
    const r = await api.register(email, password, name);
    setAuth({ accessToken: r.accessToken, refreshToken: r.refreshToken, user: r.user });
    setUser(r.user);
    return r.user;
  }, []);

  const updateName = useCallback(async (name) => {
    const r = await api.updateProfile({ name });
    const next = { ...getAuth(), user: r.user };
    setAuth(next);
    setUser(r.user);
    return r.user;
  }, []);

  const logout = useCallback(async () => {
    try { await api.logout(); } catch { /* ignore */ }
    clearAuth();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, ready, login, register, updateName, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
