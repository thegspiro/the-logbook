/**
 * Facilities Module — Barrel Export
 *
 * Routes:
 *   getFacilitiesRoutes()       — protected routes (/facilities, /facilities/:id, /locations, etc.)
 *   getFacilitiesPublicRoutes() — public kiosk route (/display/:code)
 *
 * Reusable component:
 *   FacilityRoomPicker — drop-in room selector for cross-module use
 *
 * Store:
 *   useFacilitiesStore — Zustand store for facilities state
 *
 * Types:
 *   Re-exports all facility-related interfaces for external consumption
 */

export { getFacilitiesRoutes, getFacilitiesPublicRoutes } from './routes';

// Reusable room picker for other modules (events, training, scheduling)
export { default as FacilityRoomPicker } from '../../components/FacilityRoomPicker';

// Zustand store
export { useFacilitiesStore } from './store/facilitiesStore';

// Types for cross-module consumption
export type {
  Facility,
  FacilityType,
  FacilityStatus,
  Room,
  FacilitySystem,
  MaintenanceRecord,
  MaintenanceType,
  Inspection,
} from '../../pages/facilities/types';

export { enumLabel, ROOM_TYPES, SYSTEM_TYPES, ZONE_CLASSIFICATIONS, ZONE_CLASSIFICATION_COLORS } from '../../pages/facilities/types';
