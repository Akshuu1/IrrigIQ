import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: {
      '/auth': 'http://127.0.0.1:4000',
      '/fields': 'http://127.0.0.1:4000',
      '/crops': 'http://127.0.0.1:4000',
      '/sensor-readings': 'http://127.0.0.1:4000',
      '/health': 'http://127.0.0.1:4000',
      '/ready': 'http://127.0.0.1:4000',
    },
  },
});
