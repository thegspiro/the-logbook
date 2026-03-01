/**
 * Public Portal Module — Barrel Export
 *
 * Central entry point for the public portal feature module.
 */

// Routes
export { getPublicPortalRoutes } from './routes';

// Types
export type {
  PublicPortalConfig,
  PublicPortalAPIKey,
  PublicPortalAPIKeyCreated,
  PublicPortalAccessLog,
  PublicPortalUsageStats,
  PublicPortalDataWhitelist,
  CreateAPIKeyRequest,
  UpdateConfigRequest,
  AccessLogFilters,
} from './types';

// Hooks
export {
  usePortalConfig,
  useAPIKeys,
  useAccessLogs,
  useUsageStats,
  useDataWhitelist,
} from './hooks/usePublicPortal';
