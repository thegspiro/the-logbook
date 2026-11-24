/**
 * The CRR map's rules, kept apart from the component so it exports only a
 * component (react-refresh) and the rules can be tested alone. Nothing here
 * imports at runtime: the map's lazy chunk and the Outreach Impact tab both
 * read it, and a runtime import would change how the bundler groups the
 * modules every page loads first (scripts/check-initial-bundle.mjs).
 */

import type { CrrImpactZip } from '../../services/communicationsServices';

/** Circle radius in pixels: by area, so 4 activities read as twice the size of 1. */
export const markerRadius = (activities: number, most: number): number =>
  most <= 0 ? 6 : 6 + 14 * Math.sqrt(Math.max(activities, 0) / most);

export const placedZips = (zips: CrrImpactZip[]) =>
  zips.filter(
    (z): z is CrrImpactZip & { latitude: number; longitude: number } => z.latitude != null && z.longitude != null
  );
