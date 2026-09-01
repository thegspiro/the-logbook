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
 *
 * Deliberately pure, and deliberately not a lookup against the department's
 * scheduling settings: this runs inside every seat row on the board, and a
 * label is not worth a dependency on a service, an org id and a cache that a
 * roster can render without.
 */

import { POSITION_LABELS } from '../../../constants/enums';

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
 * A department's own custom seats are not in the map — their labels live in
 * the department's scheduling settings, and the screens that offer those
 * seats read them from there. Here an unknown token is returned readable
 * rather than blank, so a custom seat still names itself on a roster.
 */
export const positionLabel = (position: string | null | undefined): string => {
  const token = (position ?? '').trim();
  if (!token) return '';
  const folded = token.toLowerCase();
  const canonical = POSITION_ALIASES[folded] ?? folded;
  return POSITION_LABELS[canonical] ?? token.replace(/_/g, ' ');
};
