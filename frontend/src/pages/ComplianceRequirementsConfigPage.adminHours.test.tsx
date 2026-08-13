/**
 * The compliance profile form must round-trip admin hours requirements.
 *
 * The backend has supported `admin_hours_requirements` on compliance profiles
 * since 2026-03 (grading, member-profile progress bars, the compliance API),
 * but the profile form silently dropped the field: it was never loaded into
 * the edit state and never sent on save, so no yearly hour requirement could
 * be configured through the UI at all.
 *
 * Asserted against the source (same approach as the tab deep-link test): the
 * contract is a field's presence in a payload, and a render test would need
 * the whole page with five mocked services to reach the same lines.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pageSource = readFileSync(join(__dirname, 'ComplianceRequirementsConfigPage.tsx'), 'utf8');
const routesSource = readFileSync(join(__dirname, '..', 'modules', 'training', 'routes.tsx'), 'utf8');

describe('ComplianceRequirementsConfigPage admin hours requirements', () => {
  it('sends the requirements on every profile save', () => {
    const payloadBlock = pageSource.match(/const profileData: ComplianceProfileCreate = \{[\s\S]*?\};/)?.[0] ?? '';
    expect(payloadBlock).toContain('admin_hours_requirements: profileHoursReqs');
  });

  it('hydrates the edit form from the stored requirements', () => {
    expect(pageSource).toContain('setProfileHoursReqs(profile.adminHoursRequirements ?? [])');
  });

  it('lets compliance.manage holders reach the config page', () => {
    // Elected officers (President, VP, Secretary) and compliance officers
    // hold compliance.manage but usually not settings.manage.
    const routeBlock = routesSource.match(/path="\/training\/compliance-config"[\s\S]*?\/>/)?.[0] ?? '';
    expect(routeBlock).toContain("requiredAnyPermission={['settings.manage', 'compliance.manage']}");
  });
});
