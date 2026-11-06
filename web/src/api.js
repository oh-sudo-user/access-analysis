const TOKEN_KEY = 'monitor-token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function request(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Monitor-Token': getToken(),
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    clearToken();
    window.dispatchEvent(new Event('monitor-unauthorized'));
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      msg = body.message || msg;
    } catch { /* ignore */ }
    throw new Error(Array.isArray(msg) ? msg.join(', ') : msg);
  }
  return res.json();
}

export const api = {
  meta: () => fetch('/api/meta').then((r) => r.json()),
  login: (password) =>
    request('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),
  overview: (hours) => request(`/api/overview?hours=${hours}`),
  timeseries: (hours, bucketMin) => request(`/api/timeseries?hours=${hours}&bucketMin=${bucketMin}`),
  top: (dim, hours, limit = 10) => request(`/api/top?dim=${dim}&hours=${hours}&limit=${limit}`),
  countries: (hours, limit = 20) => request(`/api/countries?hours=${hours}&limit=${limit}`),
  events: ({ hours, limit = 50, action }) =>
    request(`/api/events?hours=${hours}&limit=${limit}${action ? `&action=${action}` : ''}`),
  security: (hours) => request(`/api/security?hours=${hours}`),
  userShare: (hours) => request(`/api/usershare?hours=${hours}`),
};
