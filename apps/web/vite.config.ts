import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_TARGET =
  process.env.VITE_PROXY_TARGET ||
  (process.env.API_PORT ? `http://127.0.0.1:${process.env.API_PORT}` : 'http://127.0.0.1:4001');

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@irrigiq/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
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
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json,woff,woff2,ttf}'],
        runtimeCaching: [
          {
            // Cache Noto Sans font families with CacheFirst strategy (Phase 22)
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/fonts/') ||
              url.pathname.endsWith('.woff2') ||
              url.pathname.endsWith('.ttf'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'irrigiq-fonts-cache',
              cacheableResponse: {
                statuses: [0, 200],
              },
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 365 * 24 * 60 * 60, // 1 year
              },
            },
          },
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
      '/auth': API_TARGET,
      '/fields': API_TARGET,
      '/crops': API_TARGET,
      '/sensor-readings': API_TARGET,
      '/sync': API_TARGET,
      '/reports': API_TARGET,
      '/scheduler': API_TARGET,
      '/health': API_TARGET,
      '/ready': API_TARGET,
    },
  },
});
