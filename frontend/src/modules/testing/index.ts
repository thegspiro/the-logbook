/**
 * Testing Module
 *
 * The in-app companion to TESTING_CHECKLIST.md: every route the application
 * declares, as boxes a tester opens and marks, with each route's permission
 * gate evaluated against the signed-in account.
 *
 * To enable/disable this module, include or exclude the getTestingRoutes call
 * in App.tsx — and switch `testing` off in Settings → Modules, which is what a
 * department actually uses.
 */

export { getTestingRoutes } from './routes';
