/**
 * The route gates repeat the section manifest, and this is what stops them
 * drifting from it.
 *
 * `routes.tsx` declares each Members settings gate as a literal array rather
 * than deriving it from `membersSettingsSections.ts`, because three checkers
 * read route gates straight out of that file and none of them evaluates
 * TypeScript or follows an import: `scripts/check_route_permissions.py`
 * (which raises rather than scoring an unresolvable gate as ungated),
 * `breadcrumbRoutes.test.ts` and `testingRegistry.test.ts`. A derived gate is a
 * gate none of the three can verify.
 *
 * So the duplication is deliberate and this pays for it. The manifest remains
 * the one place a section's permissions are decided — beside the endpoint they
 * mirror — and a change there that is not carried into the route fails here
 * rather than becoming a page whose gate and whose saves disagree.
 */

import { describe, it, expect } from 'vitest';
import {
  MEMBERS_SETTINGS_ANY_PERMISSION,
  MEMBERS_SETTINGS_EVOC_GATE,
  MEMBERS_SETTINGS_IDS_GATE,
  MEMBERS_SETTINGS_RANKS_GATE,
  MEMBERS_SETTINGS_VISIBILITY_GATE,
} from './routes';
import {
  MEMBERS_SETTINGS_SECTIONS,
  type MembersSettingsTab,
} from '../../pages/members/admin/settings/membersSettingsSections';

/** A section's own endpoint grants, plus the hub grant every route admits. */
const expectedGate = (tab: MembersSettingsTab): string[] => {
  const section = MEMBERS_SETTINGS_SECTIONS.find((entry) => entry.key === tab);
  if (!section) throw new Error(`no section declares ${tab}`);
  return [...new Set([...section.permissions, 'members.manage'])];
};

describe('Members settings route gates', () => {
  it.each([
    ['visibility', MEMBERS_SETTINGS_VISIBILITY_GATE],
    ['ids', MEMBERS_SETTINGS_IDS_GATE],
    ['ranks', MEMBERS_SETTINGS_RANKS_GATE],
    ['evoc', MEMBERS_SETTINGS_EVOC_GATE],
  ] as [MembersSettingsTab, string[]][])('the %s route admits exactly what its section declares', (tab, gate) => {
    expect([...gate].sort()).toEqual(expectedGate(tab).sort());
  });

  it('covers every section, so a new one cannot be added without a gate', () => {
    // The list above is hand-written. Without this, a fifth section would ship
    // with no route gate asserted at all and the suite would still be green.
    expect(MEMBERS_SETTINGS_SECTIONS.map((entry) => entry.key).sort()).toEqual(
      ['evoc', 'ids', 'ranks', 'visibility'].sort()
    );
  });

  it('admits anyone who can open at least one section on the bare path', () => {
    // The redirect route names no section, so it must not be narrower than the
    // union — refusing someone there would strand a legacy `?tab=` link for an
    // officer who can open the section it points at.
    const union = [...new Set(MEMBERS_SETTINGS_SECTIONS.flatMap((entry) => [...entry.permissions, 'members.manage']))];
    expect([...MEMBERS_SETTINGS_ANY_PERMISSION].sort()).toEqual(union.sort());
  });

  it('keeps members.manage in every gate so the hub always reaches the screen', () => {
    for (const gate of [
      MEMBERS_SETTINGS_VISIBILITY_GATE,
      MEMBERS_SETTINGS_IDS_GATE,
      MEMBERS_SETTINGS_RANKS_GATE,
      MEMBERS_SETTINGS_EVOC_GATE,
      MEMBERS_SETTINGS_ANY_PERMISSION,
    ]) {
      expect(gate).toContain('members.manage');
    }
  });
});
