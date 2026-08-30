/**
 * `PUT /config` and `PUT /config/profiles/{id}` are partial updates — the
 * backend dumps them with `exclude_unset`, so an omitted key means "leave
 * this alone" and only an explicit `null` clears a nullable column
 * (CLAUDE.md Pitfall #1; CMP-1/CMP-2 fixed the backend half of this on the
 * compliance module in security-review pass 1, PR #1902).
 *
 * Pass 1 was backend-only and never looked at this page. It turned out the
 * frontend had the mirror-image bug: every "blank box" field in both save
 * handlers coerced an empty value to `undefined`, which axios/JSON.stringify
 * drops from the request body — the same omission the backend fix exists to
 * catch. A compliance officer who cleared "Email Recipients" (or a profile's
 * threshold override, or its membership-type/requirement selections) and hit
 * Save saw a success toast while the old value silently survived. See
 * CMP2-2 in docs/security-review/CMP-20-compliance.md.
 *
 * Asserted against the source, matching this file's sibling tests
 * (ComplianceRequirementsConfigPage.tab.test.tsx,
 * .adminHours.test.tsx): the payload-construction expressions are the
 * contract, and reaching them via a full render needs five mocked services.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'ComplianceRequirementsConfigPage.tsx'), 'utf8');

function block(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf(endMarker, start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('ComplianceRequirementsConfigPage — clearing a field on update', () => {
  describe('config payload (handleSaveConfig)', () => {
    const configPayload = block('const updateData: ComplianceConfigUpdate = {', '};');

    it('sends an explicit null for cleared email recipients, not undefined', () => {
      expect(configPayload).toContain('report_email_recipients: recipientsList.length > 0 ? recipientsList : null');
      expect(configPayload).not.toContain(
        'report_email_recipients: recipientsList.length > 0 ? recipientsList : undefined'
      );
    });

    it('sends an explicit null for cleared reminder days, not undefined', () => {
      expect(configPayload).toContain('notify_days_before_deadline: daysList.length > 0 ? daysList : null');
      expect(configPayload).not.toContain('notify_days_before_deadline: daysList.length > 0 ? daysList : undefined');
    });
  });

  describe('profile payload (handleSaveProfile)', () => {
    const profilePayload = block('const profileData: ComplianceProfileCreate = {', '};');

    it('sends an explicit null for a cleared description, not undefined', () => {
      expect(profilePayload).toContain('description: profileDescription.trim() || null');
      expect(profilePayload).not.toContain('description: profileDescription.trim() || undefined');
    });

    it('sends an explicit null for a cleared threshold override, not undefined', () => {
      expect(profilePayload).toContain(
        'compliant_threshold_override: profileCompliantOverride ? parseFloat(profileCompliantOverride) : null'
      );
      expect(profilePayload).toContain(
        'at_risk_threshold_override: profileAtRiskOverride ? parseFloat(profileAtRiskOverride) : null'
      );
      expect(profilePayload).not.toContain(': undefined');
    });

    it('always sends the current selection lists, so unchecking every entry actually clears them', () => {
      // Mirrors the already-correct admin_hours_requirements pattern: send
      // the real array (possibly empty) rather than hiding it behind
      // `.length > 0 ? list : undefined`, which can never express "now empty"
      // on a partial update.
      expect(profilePayload).toContain('membership_types: profileMembershipTypes,');
      expect(profilePayload).toContain('required_requirement_ids: profileRequiredReqs,');
      expect(profilePayload).toContain('optional_requirement_ids: profileOptionalReqs,');
      expect(profilePayload).toContain('admin_hours_requirements: profileHoursReqs,');
    });
  });
});

describe('ComplianceRequirementsConfigPage — unwired notification settings (CMP2-1)', () => {
  // `notify_non_compliant_members` / `notify_days_before_deadline` are stored
  // by this page but read by no scheduled task or sender anywhere in the
  // backend (verified: `grep -rn notify_days_before_deadline backend/app`
  // outside schemas/models returns nothing). CLAUDE.md Pitfall #19: a config
  // switch must have a reader before a UI, or the UI must say so. This test
  // pins the honest label so it cannot be quietly deleted; it does not
  // (and cannot) verify a reader exists — that is CMP2-1's open half.
  it('tells the officer these settings do not send anything yet', () => {
    expect(source).toContain('Not yet active');
    const notificationsSection = block(
      '<h3 className="text-theme-text-primary mb-3 text-sm font-semibold">Notifications</h3>',
      'Reminder Days Before Deadline'
    );
    expect(notificationsSection).toContain('Not yet active');
  });
});
