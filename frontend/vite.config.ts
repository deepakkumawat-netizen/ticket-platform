import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Backend routes are globally prefixed with /api (see backend's
      // main.ts) — forward as-is, no rewrite, so dev matches production
      // (where the backend serves both the API and the built frontend from
      // one process and origin).
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
