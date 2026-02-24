import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'robots.txt', 'apple-touch-icon.png'],
      workbox: {
        // Prevent the service worker from caching API responses
        // containing sensitive/PII data (HIPAA compliance).
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
          {
            urlPattern: /^.*\/api\/.*/,
            handler: 'NetworkOnly',
          },
        ],
      },
      manifest: {
        name: 'The Logbook',
        short_name: 'Logbook',
        description:
          'Volunteer Fire Department Intranet - HIPAA Compliant & Secure',
        theme_color: '#991b1b',
        background_color: '#0f172a',
        display: 'standalone',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/api': {
        target: process.env.VITE_BACKEND_URL || 'http://localhost:3001',
        changeOrigin: true,
      },
      '/docs': {
        target: process.env.VITE_BACKEND_URL || 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false, // Disabled in production to prevent source code exposure
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // Check specific sub-framework chunks first (before the
            // broad 'react' match below catches them)
            if (id.includes('react-router') || id.includes('@remix-run')) {
              return 'vendor-router';
            }
            if (id.includes('lucide-react') || id.includes('@headlessui')) {
              return 'vendor-ui';
            }
            if (id.includes('recharts') || id.includes('d3-')) {
              return 'vendor-charts';
            }
            if (id.includes('date-fns')) {
              return 'vendor-date';
            }
            if (id.includes('zustand')) {
              return 'vendor-state';
            }
            // React core + scheduler + all React-dependent libs in one
            // chunk. This prevents circular inter-chunk dependencies
            // (e.g. react-dom→scheduler in vendor, vendor→react).
            if (id.includes('react') || id.includes('scheduler') || id.includes('@hookform')) {
              return 'vendor-react';
            }
            return 'vendor';
          }
        },
      },
    },
    chunkSizeWarningLimit: 600, // Warn for chunks > 600KB
    minify: 'esbuild', // Fast minification
  },
  preview: {
    port: 3000,
    host: true,
  },
});
