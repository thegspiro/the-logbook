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
