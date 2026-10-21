import axios from 'axios';

/**
 * Where the API lives.
 *
 * In development there is nothing to set: the Vite dev server runs on 5173 and
 * the API on 5000 on the same machine, which is the fallback below.
 *
 * Deployed, the two halves sit on different hosts — the site on Vercel, the API
 * on Render — so the address is given at build time as VITE_API_URL in the
 * hosting dashboard, e.g. https://secureenroll-api.onrender.com/api. It is
 * baked into the bundle when the site is built, so changing it means a rebuild,
 * and it must include the /api at the end.
 */
const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const api = axios.create({ baseURL });

// Attach the saved token to every outgoing request automatically.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// The server refuses every request from an account that still has the
// temporary password an administrator gave it. Rather than show a wall of
// "403" errors, the browser goes to the page where that is fixed.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const code = error.response?.data?.code;
    if (error.response?.status === 403 && code === 'PASSWORD_CHANGE_REQUIRED'
        && window.location.pathname !== '/change-password') {
      window.location.assign('/change-password');
    }
    return Promise.reject(error);
  }
);

export default api;