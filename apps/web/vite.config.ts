import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'IrrigIQ - Smart Irrigation Planner',
        short_name: 'IrrigIQ',
        description: 'Water-saving irrigation planner for smallholder farms in India',
        theme_color: '#16a34a',
        background_color: '#f0fdf4',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json}'],
        runtimeCaching: [
          {
            // stale-while-revalidate for GET /fields, /crops and recommendations
            urlPattern: ({ url, request }) =>
              request.method === 'GET' &&
              (url.pathname.startsWith('/fields') || url.pathname.startsWith('/crops')),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'irrigiq-api-cache',
              cacheableResponse: {
                statuses: [0, 200],
              },
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 24 * 60 * 60, // 24 hours
              },
            },
          },
          {
            // network-first with a timeout for auth endpoints
            urlPattern: ({ url, request }) =>
              request.method === 'GET' && url.pathname.startsWith('/auth'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'irrigiq-auth-cache',
              networkTimeoutSeconds: 5,
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: {
      '/auth': 'http://127.0.0.1:4000',
      '/fields': 'http://127.0.0.1:4000',
      '/crops': 'http://127.0.0.1:4000',
      '/sensor-readings': 'http://127.0.0.1:4000',
      '/sync': 'http://127.0.0.1:4000',
      '/reports': 'http://127.0.0.1:4000',
      '/scheduler': 'http://127.0.0.1:4000',
      '/health': 'http://127.0.0.1:4000',
      '/ready': 'http://127.0.0.1:4000',
    },
  },
});
