/**
 * Prospective Members Module
 *
 * This module manages the prospective member pipeline — the process
 * through which applicants become full members. It supports configurable
 * pipeline stages (form submission, document upload, election/vote,
 * manual approval), kanban and table views, and integrates with the
 * Forms, Elections, and Notifications modules.
 *
 * To enable/disable this module, simply include or exclude the
 * getProspectiveMembersRoutes function call in your main App.tsx routing.
 */

// Export routes
export { getProspectiveMembersRoutes, getProspectiveMembersPublicRoutes } from './routes';

// NOTE: Pages/components are intentionally NOT re-exported here. App.tsx imports
// this barrel only for the route functions (which lazy-load pages via
// routes.tsx). Re-exporting pages/components statically pulls their heavy deps
// (e.g. @dnd-kit in AutomatedEmailConfig) into the eager entry chunk, defeating
// the lazy routes. Import from the deep path (./pages, ./components) if needed.

// Export types
export * from './types';

// Export utilities
export * from './utils';
