/**
 * Apparatus Module
 *
 * This module handles apparatus/vehicle management for the department.
 * It tracks fleet vehicles, maintenance, fuel logs, operators,
 * equipment, and supports NFPA compliance tracking.
 *
 * To enable/disable this module, simply include or exclude the
 * getApparatusRoutes function call in your main App.tsx routing.
 */

// Export routes
export { getApparatusRoutes } from './routes';

// NOTE: Pages/components are intentionally NOT re-exported here. App.tsx imports
// this barrel only for getApparatusRoutes (which lazy-loads pages via
// routes.tsx). Re-exporting them statically drags their code into the eager
// entry chunk, defeating the lazy routes. Import from the deep path if needed.

// Export types
export * from './types';
