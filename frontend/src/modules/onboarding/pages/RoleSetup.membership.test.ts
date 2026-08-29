/**
 * Membership standing is not a position, and onboarding must not offer it as one.
 *
 * The role-setup screen used to list Probationary, Junior, Life,
 * Administrative, Social and Exempt beside Regular Member, and creating one
 * wrote a permission-bearing `positions` row. Those are a member's *class* and
 * *status* — what kind of member they are and where they sit on the ladder —
 * not a job they hold, and the User model's own taxonomy says so ("membership
 * types carry no permissions").
 *
 * The cost was not cosmetic. A department that used them recorded standing in
 * two unconnected places: `member_class` / `member_status` on the member, which
 * every backend gate reads, and a held position that none of them do. Changing
 * one left the other stale with nothing to reconcile them, and the position
 * carried real grants, so "reclassify this member" and "change what they can
 * see" were the same action with no indication they were.
 *
 * Standing is set on the member record now. Regular Member stays: it is the
 * genuine baseline position, it is in the backend's DEFAULT_POSITIONS, and it
 * carries the day-one grant set.
 *
 * This walks the source rather than rendering, because the offer is a static
 * table and the failure this guards against is a well-meant re-addition.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'RoleSetup.tsx'), 'utf8');

/** Slugs the screen used to create as positions. Each is a class or a status. */
const STANDING_SLUGS = [
  'probationary_member',
  'junior_member',
  'life_member',
  'administrative_member',
  'social_member',
  'exempt_member',
];

describe('RoleSetup does not offer membership standing as a position', () => {
  it.each(STANDING_SLUGS)('does not define a %s position', (slug) => {
    expect(SOURCE).not.toContain(`id: '${slug}'`);
  });

  it('still offers the baseline member position', () => {
    // The guard has to be able to fail in the other direction too: deleting
    // `member` would leave a new department with no baseline position at all,
    // and this test would otherwise pass.
    expect(SOURCE).toContain("id: 'member'");
  });
});

describe('a session started before the change does not re-create them', () => {
  // The screen no longer *offers* these, but an onboarding session in flight
  // persists its picks to localStorage, and the restore path submits whatever
  // it finds. Without a filter there, resuming such a session writes the
  // permission-bearing positions back — after the recovery migration has
  // already reclassified those members, so the two disagree again and nothing
  // reconciles them.

  it('filters the retired slugs out of restored state', () => {
    expect(SOURCE).toContain('RETIRED_STANDING_SLUGS.has(posId)');
  });

  it.each(STANDING_SLUGS)('lists %s as retired', (slug) => {
    const set = SOURCE.slice(
      SOURCE.indexOf('const RETIRED_STANDING_SLUGS'),
      SOURCE.indexOf('const BuildPositionTemplates')
    );
    expect(set).toContain(`'${slug}'`);
  });

  it('filters by slug rather than by "not in the current templates"', () => {
    // The tempting general fix is to drop anything the templates no longer
    // define. That would also discard every custom position a department built
    // in this same session, which the screen explicitly supports creating.
    const restoreBlock = SOURCE.slice(
      SOURCE.indexOf('Restore from persisted store if available'),
      SOURCE.indexOf('Build templates for initial state')
    );
    expect(restoreBlock).toContain('RETIRED_STANDING_SLUGS');
    expect(restoreBlock).not.toContain('positionTemplates');
  });
});
