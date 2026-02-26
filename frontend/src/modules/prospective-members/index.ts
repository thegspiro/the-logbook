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

// Export pages
export * from './pages';

// Export components
export * from './components';

// Export types
export * from './types';
