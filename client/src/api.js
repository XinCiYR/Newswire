// Thin API client with in-memory + localStorage token handling and
// automatic access-token refresh on 401.

const API_BASE = '/api';
const STORAGE_KEY = 'newswire_auth';

function readAuth() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
}
function writeAuth(auth) {
  if (auth) localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
  else localStorage.removeItem(STORAGE_KEY);
}

export function getAuth() {
  return readAuth();
}
export function setAuth(auth) {
  writeAuth(auth);
}
export function clearAuth() {
  writeAuth(null);
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const authState = readAuth();
  let token = authState?.accessToken;
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // One refresh attempt on 401 for authenticated calls.
  if (res.status === 401 && auth && authState?.refreshToken) {
    const refreshed = await refreshTokens(authState);
    if (refreshed) {
      headers.Authorization = `Bearer ${refreshed.accessToken}`;
      res = await fetch(`${API_BASE}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    }
  }

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  if (!res.ok) {
    const message = json?.error || `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

let refreshFlight = null;

function refreshTokens(authState) {
  const current = readAuth();
  if (!current || current.user?.id !== authState.user?.id) return Promise.resolve(null);
  if (current.refreshToken !== authState.refreshToken) return Promise.resolve(current);
  if (refreshFlight?.token === authState.refreshToken) return refreshFlight.promise;
  const flight = { token: authState.refreshToken };
  flight.promise = performRefresh(authState).finally(() => {
    if (refreshFlight === flight) refreshFlight = null;
  });
  refreshFlight = flight;
  return flight.promise;
}

async function performRefresh(authState) {
  if (!authState?.refreshToken) return null;
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: authState.refreshToken }),
    });
    const json = await res.json();
    // A sign-out or another sign-in may have happened while fetch was pending.
    if (readAuth()?.refreshToken !== authState.refreshToken) return null;
    if (!res.ok) {
      if (res.status === 401 || res.status === 400) clearAuth();
      else throw Object.assign(new Error(json?.error || 'Session refresh unavailable'), { status: res.status });
      return null;
    }
    const next = {
      accessToken: json.accessToken,
      refreshToken: json.refreshToken,
      user: authState.user,
    };
    writeAuth(next);
    return { accessToken: json.accessToken };
  } catch (error) {
    throw Object.assign(new Error('Session refresh unavailable. Please try again.'), { status: error.status || 503 });
  }
}

// ---- API surface ----
export const api = {
  // auth
  register: (email, password, name) => request('/auth/register', { method: 'POST', body: { email, password, name }, auth: false }),
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password }, auth: false }),
  me: () => request('/auth/me'),
  updateProfile: (body) => request('/auth/profile', { method: 'PATCH', body }),
  logout: () => request('/auth/logout', { method: 'POST' }),

  // articles & categories
  articles: (params) => request(`/articles?${new URLSearchParams(cleanParams(params))}`),
  daily: () => request('/daily'),
  article: (id) => request(`/articles/${id}`),
  related: (id) => request(`/articles/${id}/related`),
  categories: () => request('/categories'),
  sources: () => request('/sources'),
  changelog: () => request('/changelog'),
  recordView: (id) => request(`/articles/${id}/view`, { method: 'POST' }),
  correctCategory: (id, category) => request(`/articles/${id}/category`, { method: 'PATCH', body: { category } }),

  // favorites
  favoritesList: (params) => request(`/favorites?${new URLSearchParams(cleanParams(params))}`),
  addFavorite: (id) => request(`/favorites/${id}`, { method: 'POST' }),
  removeFavorite: (id) => request(`/favorites/${id}`, { method: 'DELETE' }),

  // history
  historyList: (params) => request(`/history?${new URLSearchParams(cleanParams(params))}`),
  clearHistory: () => request('/history', { method: 'DELETE' }),
};

function cleanParams(params = {}) {
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}
