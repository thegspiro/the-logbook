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
import type { PositionOption } from '../types/shiftSettings';
import { ensureShiftSettingsLoaded, getCachedShiftSettings } from '../services/shiftSettingsApi';

/**
 * The built-in seats a rank may confer eligibility for.
 *
 * Derived from `POSITION_LABELS` rather than typed out again, so a seat added
 * to the vocabulary appears here without a second edit — `CANONICAL_POSITIONS`
 * in `backend/app/utils/positions.py` is the authority and
 * `tests/test_position_slots.py` holds the two in step.
 *
 * `paramedic` is withheld; see `rankEligibleSeatOptions` below for why.
 */
export const RANK_ELIGIBLE_BUILTIN_SEATS: string[] = Object.keys(POSITION_LABELS).filter(
  (seat) => seat !== 'paramedic'
);

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

/**
 * Seats a rank may be made eligible for.
 *
 * Derived from the canonical vocabulary rather than typed out again: the rank
 * editor used to carry its own inline list of nine tokens, which could drift
 * from `CANONICAL_POSITIONS` without anything saying so.
 *
 * **A department's own `customPositions` are deliberately not offered.** They
 * belong to the seat vocabulary in every other sense — a template can carry
 * one, `canonical_position` round-trips it verbatim, and the board renders its
 * label — but nobody can be put in one. `ShiftSignupRequest`,
 * `ShiftAssignmentCreate` and `StandingShiftCreate` all type `position` as the
 * closed `ShiftPosition` enum, and `shift_assignments.position` is a MySQL
 * ENUM behind them, so a custom seat is refused at request validation and
 * again at the flush. Granting a rank eligibility for one would be a promise
 * the app cannot keep — the same reason a module checkbox with no permission
 * behind it is not rendered. See `docs/KNOWN_LIMITATIONS.md` (SCHED-CUSTOM-SEAT).
 *
 * `paramedic` is canonical, fillable and withheld for a different reason. Rank
 * says where a member sits in the chain of command; a medic seat is a
 * credential, and `ShiftEligibilityService.get_eligible_positions` grants it
 * from step 3b — the member's certifications as of the shift date — precisely
 * so a rank cannot confer it. Offering it here would let an officer rank hand
 * out a seat that lapses with a card nobody checked.
 */
export const rankEligibleSeatOptions = (): PositionOption[] =>
  RANK_ELIGIBLE_BUILTIN_SEATS.map((value) => ({
    value,
    label: positionLabel(value),
  }));
