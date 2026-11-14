/**
 * Labelling helpers for locations.
 */

/**
 * The building to show beside a location's name, or `null` when the name
 * already carries it.
 *
 * A location synced from a facility room is named "Room — … — Facility" by
 * the backend (`FacilitiesService._room_location_name`) and its `building` is
 * that same facility, so a label that appends the building would print it
 * twice. A station-level location whose name *is* the building is treated the
 * same way. Every other location keeps its building.
 */
export function buildingNotInName(name: string, building: string | null | undefined): string | null {
  const trimmed = building?.trim();
  if (!trimmed) return null;
  if (name === trimmed || name.endsWith(` — ${trimmed}`)) return null;
  return trimmed;
}
