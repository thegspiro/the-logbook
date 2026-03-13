/**
 * Minutes Module — Barrel Export
 */

export { getMinutesRoutes } from './routes';
export { minutesService } from './services/api';
export { useMinutesStore } from './store/minutesStore';
export type { MeetingMinutes, MinutesStats, MinutesSearchResult } from './types/minutes';
