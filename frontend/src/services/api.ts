import axios from 'axios';

// Use a same-origin baseURL by default so that the Vite dev server's proxy
// (see vite.config.ts) can forward /api/* to the real backend on :3000.
// Set VITE_API_URL in a `.env`/`.env.local` file to override (e.g. when
// pointing at a deployed backend that should NOT go through the proxy).
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('fln_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
