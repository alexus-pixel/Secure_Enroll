import axios from 'axios';

const api = axios.create({
  // In production (Vercel/Netlify) set VITE_API_URL to the backend, e.g.
  // https://secureenroll-api.onrender.com/api. Locally it falls back to :5000.
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
});

// Attach the saved token to every outgoing request automatically.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default api;