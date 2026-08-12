import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';

// Unique build ID generated once per build. Injected into the app via
// `define` and written to `/version.json` so the running app can poll
// for new deployments and prompt users to reload.
const BUILD_ID = crypto.randomBytes(8).toString('hex');

function versionJsonPlugin(): Plugin {
  return {
    name: 'version-json',
    apply: 'build',
    closeBundle() {
      const outDir = path.resolve(__dirname, 'dist');
      fs.writeFileSync(path.join(outDir, 'version.json'), JSON.stringify({ buildId: BUILD_ID }) + '\n');
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [
    react(),
    versionJsonPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'robots.txt', 'apple-touch-icon.png'],
      workbox: {
        // Web Push handlers. Kept as a separate plain-JS file so the build can
        // stay on generateSW — moving to injectManifest just to register two
        // event listeners would mean hand-maintaining everything below.
        // The build id in the URL also invalidates push-worker imports that an
        // existing installation cached before no-store headers were deployed.
        importScripts: [`/push-sw.js?v=${BUILD_ID}`],
        // Precache the app SHELL only, not all ~275 route chunks.
        //
        // Precaching everything made installing the PWA a ~6.1MB download, most
        // of it admin surfaces (finance, grants, elections, onboarding) that a
        // given member will never open — a slow first launch on the rural
        // cellular connections this app is used from. The shell here is the
        // entry chunk (which contains Login and Dashboard), the vendor chunks
        // and the stylesheet: ~1.8MB. Every other route chunk is cached on
        // first visit by the CacheFirst rule below, so a page works offline
        // once it has been opened online.
        //
        // Trade-off worth knowing: a member who installs and immediately goes
        // offline can no longer open a page they have never visited. Restore
        // the old behavior by deleting globPatterns/globIgnores.
        globPatterns: ['**/*.{css,html}', 'assets/index-*.js', 'assets/vendor-*.js'],
        // Drag-and-drop is only reachable from kanban/builder screens, which are
        // desk work — never needed offline in the field. vendor-scanner is
        // deliberately NOT ignored: barcode scanning is an offline field
        // activity, so it has to survive a cold, disconnected start.
        globIgnores: ['**/vendor-dnd-*.js'],
        // Prevent the service worker from caching API responses
        // containing sensitive/PII data (HIPAA §164.312).
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
          {
            urlPattern: /^.*\/api\/.*/,
            handler: 'NetworkOnly',
          },
          // version.json must always be fetched from the network so the
          // app can detect new deployments even when served by the SW.
          {
            urlPattern: /\/version\.json$/,
            handler: 'NetworkOnly',
          },
          // Route chunks not covered by the precache above. Their filenames are
          // content-hashed, so a given URL's bytes never change and CacheFirst
          // is safe — a new build produces new filenames rather than new
          // contents at the same URL. This is what gives a visited page offline
          // access. LRU-capped so superseded chunks don't accumulate forever.
          {
            urlPattern: /\/assets\/.*\.(?:js|css)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'app-chunks',
              expiration: {
                maxEntries: 300,
                maxAgeSeconds: 60 * 60 * 24 * 60, // 60 days
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        // `id` pins the app's identity across deploys. Without it the identity
        // is derived from start_url, so changing that URL later would register
        // as a *different* app and install a duplicate alongside the first.
        id: '/',
        name: 'The Logbook',
        short_name: 'Logbook',
        description: 'Volunteer Fire Department Intranet - Secure & Built with HIPAA Requirements in Mind',
        // Without an explicit start_url the spec defaults to the URL the app
        // was installed from — so a member who installed while viewing
        // /events/abc123 would get an app that always reopens that event.
        //
        // Deliberately NOT '/': that route is the onboarding Welcome splash,
        // which only reaches the dashboard by mounting, reading has_session and
        // redirecting. Launching there costs an extra hop through the
        // onboarding chunk, and a logged-out offline launch falls through
        // Welcome's branding-fetch catch to the "Get Started" screen, which
        // reads as though the department was never set up. /dashboard is behind
        // ProtectedRoute, so unauthenticated launches land on /login instead.
        start_url: '/dashboard',
        scope: '/',
        // The app is form-heavy and table-heavy; leaving orientation
        // unlocked lets members rotate to landscape to read wide tables.
        orientation: 'any',
        lang: 'en-US',
        dir: 'ltr',
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
        // Shown in Android's richer install dialog instead of the minimal
        // card. At least one `narrow` and one `wide` entry are required for
        // that richer treatment, and each declared size must match the file
        // exactly or the entry is dropped. Regenerate with
        // `npx playwright test --grep @screenshots`.
        screenshots: [
          {
            src: 'screenshots/narrow-dashboard.png',
            sizes: '390x844',
            type: 'image/png',
            form_factor: 'narrow',
            label: 'Your shifts, training and notifications at a glance',
          },
          {
            src: 'screenshots/narrow-training.png',
            sizes: '390x844',
            type: 'image/png',
            form_factor: 'narrow',
            label: 'Track certifications and log training from your phone',
          },
          {
            src: 'screenshots/wide-dashboard.png',
            sizes: '1280x800',
            type: 'image/png',
            form_factor: 'wide',
            label: 'The full department dashboard on a desktop',
          },
        ],
        shortcuts: [
          {
            name: 'My Schedule',
            short_name: 'Schedule',
            url: '/scheduling',
            description: 'View your upcoming shifts and schedule',
          },
          {
            name: 'Dashboard',
            short_name: 'Home',
            // '/' is the onboarding Welcome splash, not the dashboard.
            url: '/dashboard',
            description: 'Go to the main dashboard',
          },
          {
            name: 'Members',
            short_name: 'Members',
            url: '/members',
            description: 'View the member directory',
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
        ws: true,
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
            if (id.includes('react-router')) {
              return 'vendor-router';
            }
            if (id.includes('lucide-react')) {
              return 'vendor-ui';
            }
            // Scanner/barcode/QR libraries are large (html5-qrcode alone is
            // several hundred KB) and only used by lazy scanner/label/print
            // pages. Keep them out of the shared 'vendor' chunk — which is
            // reachable from the eager login graph via axios — so they are
            // downloaded only when a page that renders them actually loads.
            if (id.includes('html5-qrcode') || id.includes('jsbarcode') || id.includes('qrcode.react')) {
              return 'vendor-scanner';
            }
            // Drag-and-drop is only used by kanban/builder pages.
            if (id.includes('@dnd-kit')) {
              return 'vendor-dnd';
            }
            if (id.includes('zustand')) {
              return 'vendor-state';
            }
            // React core + react-dom + scheduler ONLY. Use path-segment
            // matching ('/react/') instead of substring matching ('react')
            // to avoid pulling in third-party packages whose names happen
            // to contain "react" (e.g. react-hot-toast, qrcode.react).
            // Those packages may depend on non-React vendor libs (goober,
            // csstype) which creates a circular chunk dependency:
            //   vendor-react → vendor → vendor-react
            // causing "Cannot read properties of undefined (reading
            // 'useLayoutEffect')" at runtime.
            if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('scheduler')) {
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
