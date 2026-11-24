import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Yahoo Finance's chart endpoint does not send CORS headers, so the dev server
// proxies it: the browser calls /yf/... and Vite forwards to Yahoo.
const yahooProxy = {
  target: 'https://query1.finance.yahoo.com',
  changeOrigin: true,
  rewrite: (p) => p.replace(/^\/yf/, ''),
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
};

// NSE publishes its stock and index lists as CSV files without CORS headers.
const nseProxy = {
  target: 'https://archives.nseindia.com',
  changeOrigin: true,
  rewrite: (p) => p.replace(/^\/nse/, ''),
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
};

export default defineConfig({
  plugins: [react()],
  server: { host: '10.0.0.10', port: 5173, strictPort: true, proxy: { '/yf': yahooProxy, '/nse': nseProxy } },
  preview: { port: 4173, proxy: { '/yf': yahooProxy, '/nse': nseProxy } },
});
