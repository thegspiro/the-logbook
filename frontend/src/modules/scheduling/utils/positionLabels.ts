/**
 * How a crew seat is named on screen.
 *
 * The seat *token* and the seat *label* are two different things and always
 * have been. Tokens are canonical, lowercase and settled by the backend
 * (`app/utils/positions.py`) because they are what the signup API grants
 * against: the EMT seat is stored as `ems` everywhere, and `EMT`/`EMS` are
 * aliases of it that nothing grants. The label is what a firefighter reads,
 * and for that seat the department's word is "EMT".
 *
 * Screens that printed the token instead disagreed with the screen that
 * created it: a template built with two EMT seats listed them as "EMS" on the
 * board, which reads as a different seat rather than as the same one spelled
 * two ways. So the mapping lives here, once, and every screen that shows a
 * seat name goes through it — there is no second copy to drift.
 */

import { POSITION_LABELS } from '../../../constants/enums';
import { ensureShiftSettingsLoaded, getCachedShiftSettings } from '../services/shiftSettingsApi';

/**
 * Spellings that mean a built-in seat but are not its token. Mirrors
 * `_POSITION_ALIASES` in `backend/app/utils/positions.py` — rows written
 * before the backend settled on one spelling still hold these.
 */
const POSITION_ALIASES: Record<string, string> = {
  emt: 'ems',
};

/**
 * The display name for one seat token.
 *
 * A seat the department defined itself carries an admin-chosen label, and the
 * position-configuration screen is the only place that knows it — so it is
 * resolved from the same `customPositions` the template form's dropdown is
 * built from, rather than from a second list here. An unknown token is
 * returned readable rather than blank: settings may not have landed yet, and
 * a nameless seat on a roster is worse than a slug.
 */
export const positionLabel = (position: string | null | undefined): string => {
  const token = (position ?? '').trim();
  if (!token) return '';

  // Sync read of a cache a background load fills, as getPositionOptions does
  // for the same list. The kick is single-flight per organization, so a board
  // full of seats makes one request at most and none once it has landed.
  void ensureShiftSettingsLoaded();
  const custom = getCachedShiftSettings().customPositions.find((p) => p.value === token);
  if (custom) return custom.label;

  const folded = token.toLowerCase();
  const canonical = POSITION_ALIASES[folded] ?? folded;
  return POSITION_LABELS[canonical] ?? token.replace(/_/g, ' ');
};
