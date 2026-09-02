import type { OrganizationType } from '../store';

/**
 * Which positions an agency has, and what it calls the ones it renames.
 *
 * This mirrors `DISCIPLINE_CODES_BY_ORG_TYPE` and `LABELS_BY_ORG_TYPE` in
 * `backend/app/core/permissions.py`, and has to. The position step carries its
 * own copy of the position list and never fetches one, while the save handler
 * (`save_session_roles`) *creates* a system position for any id it does not
 * already know. So a discipline template offered here that the backend declined
 * to seed is not merely shown in error — ticking it puts the row back, with
 * grants built from two checkboxes instead of from `DEFAULT_POSITIONS`.
 *
 * It lives in its own file rather than beside the templates so the contract test
 * that keeps the two languages honest — `test_onboarding_position_template_parity.py`,
 * which reads this as text — has a small, stable thing to read.
 */
export const DISCIPLINE_POSITION_IDS = ['engineer', 'firefighter', 'emt'] as const;

export const DISCIPLINE_POSITIONS_BY_ORG_TYPE: Record<OrganizationType, readonly string[]> = {
  fire_department: DISCIPLINE_POSITION_IDS,
  fire_ems_combined: DISCIPLINE_POSITION_IDS,
  // An EMS-only service has no fire line at all. Firefighter and EMT are
  // independent, so dropping one says nothing about the other.
  ems_only: ['engineer', 'emt'],
};

/** Anything absent keeps the template's own wording. */
export const POSITION_LABELS_BY_ORG_TYPE: Partial<Record<OrganizationType, Record<string, string>>> = {
  ems_only: {
    fire_chief: 'Chief',
    engineer: 'Driver / Operator',
  },
};

const disciplinesFor = (organizationType: OrganizationType): readonly string[] =>
  DISCIPLINE_POSITIONS_BY_ORG_TYPE[organizationType] ?? DISCIPLINE_POSITION_IDS;

const isDiscipline = (id: string): boolean =>
  DISCIPLINE_POSITION_IDS.includes(id as (typeof DISCIPLINE_POSITION_IDS)[number]);

/**
 * Whether this id is a discipline position that this agency does not have.
 *
 * Only discipline ids are ever excluded; a custom position an admin invented is
 * none of this function's business and always answers false.
 */
export const isAgencyFilteredOut = (id: string, organizationType: OrganizationType): boolean =>
  isDiscipline(id) && !disciplinesFor(organizationType).includes(id);

/** Drop the positions this agency does not have, and rename the ones it renames. */
export const applyAgencyVocabulary = <T extends { id: string; name: string }>(
  positions: T[],
  organizationType: OrganizationType
): T[] => {
  const labels = POSITION_LABELS_BY_ORG_TYPE[organizationType] ?? {};
  return positions
    .filter((position) => !isAgencyFilteredOut(position.id, organizationType))
    .map((position) => {
      const renamed = labels[position.id];
      return renamed ? { ...position, name: renamed } : position;
    });
};
