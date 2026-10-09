import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// assets/ (samples + fabrics) is served as the public dir: /samples/*.jpg, /fabrics/*.png
// VITE_BASE: deploy sub-path, e.g. /curtain-project/ for GitHub Pages.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  publicDir: '../../assets',
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
});
