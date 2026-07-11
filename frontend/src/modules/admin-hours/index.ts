/**
 * Admin Hours Module
 *
 * Enables members to log administrative hours via QR code
 * clock-in/clock-out or manual entry, with configurable categories
 * and optional approval workflows.
 */

export { getAdminHoursRoutes } from './routes';

// NOTE: Do not re-export './pages' here. App.tsx imports this barrel only for
// getAdminHoursRoutes (which lazy-loads pages via routes.tsx). Re-exporting the
// pages statically drags their heavy deps (qrcode.react) into the eager entry
// chunk, defeating the lazy routes. Import pages directly from './pages' if
// ever needed outside the module.
export * from './types';
