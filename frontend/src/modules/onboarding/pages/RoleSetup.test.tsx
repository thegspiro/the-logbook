import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPositionTemplates } from './positionTemplates';
import { MODULE_REGISTRY } from '../config/moduleRegistry';
import type { OrganizationType } from '../store';

const idsFor = (organizationType?: OrganizationType): string[] =>
  Object.values(buildPositionTemplates(MODULE_REGISTRY, organizationType))
    .flatMap((category) => category.positions)
    .map((position) => position.id);

const named = (organizationType: OrganizationType, id: string): string | undefined =>
  Object.values(buildPositionTemplates(MODULE_REGISTRY, organizationType))
    .flatMap((category) => category.positions)
    .find((position) => position.id === id)?.name;

describe('buildPositionTemplates — the wizard follows the agency', () => {
  it('offers an EMS-only service no firefighter', () => {
    // Not cosmetic: the save handler creates a system position for any id it
    // does not already know, so an offered-and-ticked Firefighter puts back the
    // exact row the backend declined to seed.
    expect(idsFor('ems_only')).not.toContain('firefighter');
  });

  it('keeps EMT and the whole officer ladder for an EMS-only service', () => {
    const ids = idsFor('ems_only');
    expect(ids).toContain('emt');
    for (const officer of ['fire_chief', 'deputy_chief', 'assistant_chief', 'captain', 'lieutenant']) {
      expect(ids).toContain(officer);
    }
  });

  it('calls the chief a Chief and the engineer a Driver / Operator', () => {
    expect(named('ems_only', 'fire_chief')).toBe('Chief');
    expect(named('ems_only', 'engineer')).toBe('Driver / Operator');
  });

  it('leaves a fire department exactly as it was', () => {
    const ids = idsFor('fire_department');
    expect(ids).toContain('firefighter');
    expect(ids).toContain('emt');
    expect(named('fire_department', 'fire_chief')).toBe('Fire Chief');
    expect(named('fire_department', 'engineer')).toBe('Engineer / Driver Operator');
  });

  it('treats a combined agency as a fire department', () => {
    expect(idsFor('fire_ems_combined')).toEqual(idsFor('fire_department'));
  });

  it('falls back to the full set when the agency is unknown', () => {
    // Matches the backend fallback. A department shown one position too many
    // can untick it; one shown too few has no indication anything is absent —
    // and this is the path a wizard resumed with a cleared store takes.
    expect(idsFor(undefined)).toEqual(idsFor('fire_department'));
  });

  it('renames without dropping, so nothing goes missing on the way', () => {
    // fire_chief is renamed for ems_only and must still be offered; a filter
    // that ran on the renamed entry would lose it.
    expect(idsFor('ems_only')).toContain('fire_chief');
    expect(idsFor('ems_only').length).toBe(idsFor('fire_department').length - 1);
  });
});

describe('buildPositionTemplates — seeded positions start from what is seeded', () => {
  const permissionsFor = (id: string) =>
    Object.values(buildPositionTemplates(MODULE_REGISTRY, 'fire_department'))
      .flatMap((category) => category.positions)
      .find((position) => position.id === id)?.permissions;

  it('does not tick Facilities or Notifications for a regular member', () => {
    // "Regular Member" is preselected and its matrix is collapsed, so these
    // boxes are saved without anyone seeing them. The role-type heuristic
    // ticked View for every non-System module, which put `facilities.view`
    // and `notifications.view` back on the member row of every fresh install
    // — the state two migrations exist to end, and, for notifications, a
    // department-wide read of every message ever sent.
    const member = permissionsFor('member');

    expect(member?.facilities).toEqual({ view: false, manage: false });
    expect(member?.notifications).toEqual({ view: false, manage: false });
    expect(member?.scheduling).toEqual({ view: true, manage: false });
  });

  it('does not tick Manage across the board for the board of directors', () => {
    const board = permissionsFor('board_of_directors');
    const managed = Object.entries(board ?? {})
      .filter(([, boxes]) => boxes.manage)
      .map(([moduleId]) => moduleId);

    expect(managed).toEqual(['reports']);
  });

  it('does not tick Reports for an EMT', () => {
    // This assertion used to read the other way round: `emt` had no
    // DEFAULT_POSITIONS row, so the heuristic supplied its boxes and there was
    // "nothing to disagree with". That was the bug. The wizard offers EMT to
    // every agency type, and with nothing seeded behind the slug
    // `save_session_roles` created the row from these very checkboxes — so a
    // ticked Reports box became a department-wide reporting grant on every EMT
    // in a newly onboarded department. EMT is registered now and starts from
    // the same grants its rank carries.
    const emt = permissionsFor('emt');

    expect(emt?.reports).toEqual({ view: false, manage: false });
    expect(emt?.events).toEqual({ view: true, manage: false });
    expect(emt?.scheduling).toEqual({ view: true, manage: false });
  });

  it('gives an EMT the same boxes as a firefighter', () => {
    // Their intended grants are the same list object in the rank registry —
    // same standing, different discipline — so the two templates must agree.
    expect(permissionsFor('emt')).toEqual(permissionsFor('firefighter'));
  });
});

describe('RoleSetup restore — a resumed session does not carry stale grants', () => {
  // The restore reads a config out of localStorage, so it can predate the
  // grants this build presents. It already drops a retired standing and a
  // discipline the agency does not have, for the same reason: handleContinue
  // submits whatever is in there. Permissions needed the same treatment — an
  // EMT saved on an earlier build carries the heuristic's ticks, Reports
  // included, and would be written after every migration had already run.
  //
  // Walked as source rather than rendered, in the manner of
  // RoleSetup.membership.test.ts: the guard is one clause in a useState
  // initializer, and the failure to catch is a well-meant simplification of it.
  const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'RoleSetup.tsx'), 'utf8');

  it('refreshes permissions and priority from the template', () => {
    // Priority as well as permissions: save_session_roles writes the submitted
    // value over the seeded one, so a stale 10 would put EMT back on the
    // baseline Member position's rung.
    expect(source).toMatch(/permissions: template\.permissions/);
    expect(source).toMatch(/priority: template\.priority/);
  });

  it('does it only for a slug whose seeded grants actually moved', () => {
    // Not every seeded position. This reconciliation overwrites what was
    // saved, and an administrator's own edits to a built-in position are saved
    // the same way — resetting all of them would discard the customization
    // they made before stepping away to the modules page.
    //
    // Asserted as membership rather than as the literal source text: the set
    // grows by design each time a seeded grant moves, and pinning the exact
    // string made that ordinary edit look like a regression.
    const declared = source.match(/const STALE_SEEDED_MARKERS: Readonly<Record<string, string>> = \{([\s\S]*?)\n\};/);
    expect(declared, 'STALE_SEEDED_MARKERS is not a literal map').not.toBeNull();
    const slugs = [...(declared?.[1] ?? '').matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]);

    // emt lost the heuristic's ticks; member/firefighter/emt lost apparatus.
    expect(new Set(slugs)).toEqual(new Set(['emt', 'member', 'firefighter']));
    // engineer keeps apparatus.view — it is the driver/operator rank.
    expect(slugs).not.toContain('engineer');
  });

  it('credits the markers the previous build wrote for the same change', () => {
    // #2248 reconciled emt/member/firefighter for apparatus but recorded them
    // as bare slugs. Read literally, none satisfies a `@apparatus-view` marker,
    // so a draft from that build would be reconciled a second time and lose any
    // permissions or priority an administrator edited since — the exact harm
    // the once-only design exists to prevent.
    //
    // A bare `member`/`firefighter` can only have come from that build. A bare
    // `emt` is ambiguous: the build before it recorded `emt` alone for the
    // heuristic-grants change, so it carries the apparatus work only alongside
    // one of the other two.
    expect(source).toMatch(/const satisfiedMarkers = \(recorded: readonly string\[\]\)/);
    expect(source).toMatch(/satisfied\.add\(`\$\{slug\}@apparatus-view`\)/);
    expect(source).toMatch(
      /satisfied\.has\('emt'\) && \(satisfied\.has\('member'\) \|\| satisfied\.has\('firefighter'\)\)/
    );
    // The filter consults the translated set, not the raw recorded list.
    expect(source).toMatch(/const done = satisfiedMarkers\(reconciledSeededSlugs\)/);
    expect(source).toMatch(/!done\.has\(marker\)/);
  });

  it('gives each grant change its own marker rather than reusing a slug', () => {
    // `reconciledSeededSlugs` records what a draft has been through. A draft
    // that reconciled under the EMT repair recorded the bare `emt`; listing
    // `emt` again for the apparatus change would be filtered out as done, and
    // that draft would write `apparatus.view` back after the migration revoked
    // it. One marker per (slug, change), and the original bare marker is kept
    // so an already-reconciled draft is not reset a second time.
    const declared = source.match(/const STALE_SEEDED_MARKERS: Readonly<Record<string, string>> = \{([\s\S]*?)\n\};/);
    const markers = [...(declared?.[1] ?? '').matchAll(/(?:^|\n)\s*'?([\w@-]+)'?\s*:/g)].map((m) => m[1]);

    expect(markers).toContain('emt');
    expect(markers).toContain('emt@apparatus-view');
    expect(new Set(markers).size).toBe(markers.length);
    // The filter and the recorded value must both be the marker, not the slug.
    expect(source).toMatch(/!done\.has\(marker\)/);
    expect(source).toMatch(/markSeededSlugsReconciled\(Object\.keys\(STALE_SEEDED_MARKERS\)\)/);
  });

  it('does it once, not on every mount', () => {
    // Narrowing to one slug is not enough on its own: repeating it for that
    // slug discards the same edits, just only for EMT. The mount consults
    // `reconciledSeededSlugs` before deciding — by marker now, so a slug can
    // appear again for a later grant change without being filtered out as
    // already done.
    expect(source).toMatch(/!done\.has\(marker\)/);
    expect(source).toMatch(/const stale = template && slugsToReconcile\.includes\(posId\)/);
  });

  it('records every stale slug, not only the ones it reconciled', () => {
    // A session started on this build has no EMT in its config yet, so a mount
    // that recorded only what it reconciled would record nothing — and the
    // administrator selecting EMT, customizing it and stepping away would come
    // back to find those current-build edits treated as legacy and reset.
    // A slug selected after this screen is reached came from the current
    // template by definition, so recording the whole set is what says so.
    expect(source).toMatch(/markSeededSlugsReconciled\(Object\.keys\(STALE_SEEDED_MARKERS\)\)/);
  });

  it('latches the decision instead of recomputing it', () => {
    // The effect adds to `reconciledSeededSlugs`; recomputing off that would
    // decide mid-mount that a slug was already handled.
    expect(source).toMatch(/slugsToReconcileRef\.current === null/);
  });
});
