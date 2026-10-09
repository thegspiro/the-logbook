/**
 * Time zones offered when uploading or re-reading a shift history file.
 *
 * The file's wall-clock times are read in this zone, so the choice matters
 * only when the department's old system ran on a different clock from the one
 * this department is configured with. An empty value means "the department's
 * own zone", which the backend resolves — the browser cannot know it.
 */

const COMMON_ZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'UTC',
];

export interface TimezoneOption {
  value: string;
  label: string;
}

export const zoneLabel = (zone: string): string => zone.replace(/_/g, ' ');

/** Common US zones plus any extra (the viewer's own, the import's current). */
export const timezoneOptions = (...extra: (string | null | undefined)[]): TimezoneOption[] => {
  const zones = [...COMMON_ZONES];
  for (const zone of extra) {
    if (zone && !zones.includes(zone)) zones.push(zone);
  }
  return zones.map((zone) => ({ value: zone, label: zoneLabel(zone) }));
};
