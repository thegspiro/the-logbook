/**
 * Grouping helpers for location kiosk QR codes.
 */

import type { Location } from '../services/api';

export interface LocationGroup {
  name: string;
  locations: Location[];
}

/**
 * Group kiosk codes by station/facility. A location is a "station" when it has
 * an address and no building/room reference; rooms point at their station via
 * `building` (set for both lightweight rooms and facility-synced rooms).
 * Locations without a display code are dropped — they have no kiosk URL.
 */
export function groupByStation(locations: Location[]): LocationGroup[] {
  const withCodes = locations.filter((l) => l.display_code);
  const stations = withCodes.filter((l) => l.address && !l.building && !l.room_number);
  const rooms = withCodes.filter((l) => !stations.includes(l));

  const groups = new Map<string, Location[]>();
  // Stations first so their own code leads the group
  for (const station of stations) {
    groups.set(station.name, [station]);
  }
  const other: Location[] = [];
  for (const room of rooms) {
    if (room.building) {
      const existing = groups.get(room.building);
      if (existing) existing.push(room);
      else groups.set(room.building, [room]);
    } else {
      other.push(room);
    }
  }
  if (other.length > 0) {
    groups.set('Other Locations', other);
  }

  return [...groups.entries()].map(([name, locs]) => ({ name, locations: locs }));
}
