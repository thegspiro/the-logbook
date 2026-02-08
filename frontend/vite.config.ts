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
    sourcemap: true,
    rollupOptions: {
      output: {
        // Strategic code splitting for optimal caching and performance
        manualChunks: (id) => {
          // Core vendor libraries (framework essentials)
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/react-router-dom')) {
            return 'vendor-router';
          }

          // UI libraries
          if (id.includes('node_modules/lucide-react')) {
            return 'vendor-icons';
          }
          if (id.includes('node_modules/react-hook-form') || id.includes('node_modules/zod')) {
            return 'vendor-forms';
          }

          // Feature modules - split by domain for better caching
          if (id.includes('/modules/onboarding/')) {
            return 'module-onboarding';
          }
          if (id.includes('/modules/apparatus/')) {
            return 'module-apparatus';
          }
          if (id.includes('/modules/public-portal/')) {
            return 'module-portal';
          }

          // Page groups - split by feature area
          if (id.includes('/pages/Training') || id.includes('/pages/CreateTrainingSession') || id.includes('/pages/ExternalTraining')) {
            return 'pages-training';
          }
          if (id.includes('/pages/Event') || id.includes('/pages/Analytics')) {
            return 'pages-events';
          }
          if (id.includes('/pages/Member') || id.includes('/pages/AddMember') || id.includes('/pages/ImportMember')) {
            return 'pages-members';
          }
          if (id.includes('/pages/Settings') || id.includes('/pages/Role')) {
            return 'pages-settings';
          }

          // Other vendor libraries
          if (id.includes('node_modules')) {
            return 'vendor-libs';
          }
        },
      },
    },
    // Additional optimizations
    chunkSizeWarningLimit: 1000, // Warn for chunks > 1MB
    minify: 'esbuild', // Fast minification
  },
  preview: {
    port: 3000,
    host: true,
  },
});
