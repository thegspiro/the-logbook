import { expect, test } from '@playwright/test';
import { json, signIn, TEST_USER } from './helpers';
import { TABLE_FIT_VIEWPORTS, expectTableFitsItsCard } from './tableFit';

const MEMBER_ID = 'member-table-fit';

const COURSE_NAMES = [
  'Hazardous Materials Operations Level Refresher and Decontamination',
  'Advanced Cardiac Life Support Provider Recertification',
  'Vehicle Extrication and Heavy Rescue Stabilization Techniques',
  'Incident Command System ICS-300 Intermediate Expanding Incidents',
];

const TRAINING_TYPES = ['certification', 'continuing_education', 'skills_practice', 'refresher'];

const trainingRecords = COURSE_NAMES.map((courseName, i) => ({
  id: `record-${i}`,
  organization_id: 'org-1',
  user_id: MEMBER_ID,
  course_name: courseName,
  course_code: `HAZMAT-OPS-REFRESH-202${i}`,
  training_type: TRAINING_TYPES[i] ?? 'certification',
  completion_date: '2026-03-14',
  expiration_date: i === 0 ? '2026-11-20' : i === 1 ? '2025-01-01' : '2028-06-30',
  hours_completed: 124.5,
  certification_number: `NREMT-CERT-00${i}84736291`,
  status: 'completed',
  voided_at: i === 3 ? '2026-04-01T10:00:00Z' : null,
  void_reason:
    i === 3 ? 'Duplicate of the record entered by the training officer after the county academy sent its roster' : null,
  created_at: '2026-03-14T10:00:00Z',
  updated_at: '2026-03-14T10:00:00Z',
}));

const TEMPLATE_NAMES = [
  'Self-Contained Breathing Apparatus Donning and Emergency Procedures',
  'Ground Ladder Raises: Two-Person Flat and Beam Raise',
  'Hose Advancement Up Stairwells with Standpipe Connection',
  'Patient Assessment and Management for Medical Emergencies',
];

const TEMPLATE_STATUSES = ['draft', 'published', 'published', 'archived'];
const TEMPLATE_VISIBILITIES = ['officers_only', 'assigned', 'all_members', 'officers_only'];

const skillTemplates = TEMPLATE_NAMES.map((name, i) => ({
  id: `template-${i}`,
  name,
  description:
    'Evaluates the candidate against the state certification board skill sheet, including all critical criteria that result in automatic failure.',
  category: 'Firefighter I Practical Skills Certification Examination',
  status: TEMPLATE_STATUSES[i] ?? 'draft',
  visibility: TEMPLATE_VISIBILITIES[i] ?? 'all_members',
  version: 3,
  section_count: 12,
  criteria_count: 148,
  created_at: '2026-03-14T10:00:00Z',
  updated_at: '2026-03-14T10:00:00Z',
}));

const TRAINING_PERMISSIONS = [...TEST_USER.permissions, 'training.view', 'training.manage'];

// A member's training history: one list item per record, carrying a long
// course name and code, certificate number, a void reason, status badges and
// up to three action buttons that grow to 44px on a touch screen. It sits in
// an overflow-hidden card, so anything wider than the card is clipped rather
// than scrolled. It was an eight-column table until 2026-11; the list has to
// fit at every width the table had to.
test.describe('Member training history list fits its card', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/members/:userId/training — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: TRAINING_PERMISSIONS });
      await page.route('**/api/v1/training/records**', (route) => void route.fulfill(json(trainingRecords)));
      await page.goto(`/members/${MEMBER_ID}/training`);

      // All Time, because the fixtures are dated 2026-03-14 and the default
      // period would hide them once the calendar year turns.
      await page.getByRole('combobox', { name: 'Training period' }).selectOption('lifetime');
      const list = page.getByRole('list', { name: 'Training records' });
      await expect(list.getByRole('listitem').first()).toBeVisible();
      const overflow = await list.evaluate((el) => {
        const card = el.parentElement;
        const room = card ? card.clientWidth : 0;
        const widest = Math.max(
          Math.ceil(el.getBoundingClientRect().width),
          ...Array.from(el.children).map((li) => li.scrollWidth)
        );
        return widest - room;
      });
      expect(overflow, `Member training history list is ${overflow}px wider than its card`).toBeLessThanOrEqual(0);
    });
  }
});

// The skills-testing templates list: name with description, category, status
// badges, section and criteria counts, and up to six action buttons that grow
// to 44px on a touch screen. Wide enough to overflow its card on a tablet.
test.describe('Skills testing templates table fits its card', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/training/admin?page=skills-testing&tab=templates — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: TRAINING_PERMISSIONS });
      await page.route(
        '**/api/v1/training/skills-testing/templates**',
        (route) => void route.fulfill(json(skillTemplates))
      );
      await page.goto('/training/admin?page=skills-testing&tab=templates');

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Template', exact: true }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Skills testing templates table');
    });
  }
});

const COMPLIANCE_MEMBER_NAMES = [
  'Alexandra Ayala-Montgomery',
  'Christopher Vanderbilt-Okonkwo',
  'Maximilian Hargreaves-Delacroix',
  'Jacqueline Fitzwilliam-Nakamura',
];

const COMPLIANCE_STATUSES = ['compliant', 'at_risk', 'non_compliant', 'not_applicable'];

const COMPLIANCE_PERMISSIONS = [...TRAINING_PERMISSIONS, 'compliance.manage'];

const complianceForecasts = COMPLIANCE_MEMBER_NAMES.map((userName, i) => ({
  user_id: `member-${i}`,
  user_name: userName,
  current_compliance_percentage: 87.5 - i * 20,
  forecast_30_days: 75,
  forecast_60_days: 62.5,
  forecast_90_days: 50,
  at_risk_requirements: [{ id: 'req-1' }, { id: 'req-2' }],
  expiring_certifications: [{ id: 'cert-1' }, { id: 'cert-2' }, { id: 'cert-3' }],
}));

const annualReport = {
  report_type: 'annual_compliance',
  organization_id: 'org-1',
  year: 2026,
  generated_at: '2026-11-08T10:00:00Z',
  executive_summary: {
    overall_compliance_pct: 78.5,
    total_members: 4,
    graded_members: 4,
    not_applicable_members: 0,
    fully_compliant_members: 2,
    total_training_hours: 123456.5,
    total_admin_hours: 23456.25,
    total_contributed_hours: 146912.75,
    total_certifications_active: 120,
    total_certifications_expired: 7,
    iso_readiness_pct: 82,
  },
  admin_hours_summary: { total_approved_hours: 1000, total_pending_hours: 20, total_entries: 50, by_category: [] },
  member_compliance: COMPLIANCE_MEMBER_NAMES.map((name, i) => ({
    user_id: `member-${i}`,
    name,
    compliance_pct: 80,
    hours_completed: 123456.75,
    admin_hours_approved: 23456.5,
    admin_hours_pending: 12,
    total_contributed_hours: 146913.25,
    requirements_met: 12,
    requirements_total: 14,
    expired_certifications: i,
    status: COMPLIANCE_STATUSES[i] ?? 'compliant',
  })),
  requirement_analysis: [],
  recertification_summary: { active_pathways: 1, tasks_completed: 1, tasks_pending: 1, tasks_expired: 1 },
  instructor_summary: {
    total_qualified: 1,
    active_instructors: 1,
    active_qualifications: 1,
    expiring_qualifications: 1,
  },
  multi_agency_summary: { total_exercises: 1, nims_compliant_exercises: 1, total_participants: 1 },
  effectiveness_summary: { total_evaluations: 1, avg_reaction_rating: 4.5, avg_knowledge_gain: 12 },
  record_completeness: { total_records: 100, completeness_pct: 92, nfpa_1401_compliant: true, field_details: [] },
};

const QUALIFICATION_TYPES = ['lead_instructor', 'evaluator', 'instructor', 'lead_instructor'];

const instructorQualifications = COMPLIANCE_MEMBER_NAMES.map((userName, i) => ({
  id: `qualification-${i}`,
  organization_id: 'org-1',
  user_id: `member-${i}`,
  qualification_type: QUALIFICATION_TYPES[i] ?? 'instructor',
  course_name: 'Hazardous Materials Operations Level Refresher and Decontamination',
  certification_number: `NFPA1041-IL2-00${i}84736291`,
  certification_level: 'Fire Instructor II (NFPA 1041)',
  issuing_agency: 'State Fire Marshal Training Division',
  issued_date: '2024-03-14',
  expiration_date: i === 0 ? '2026-11-20' : '2028-06-30',
  active: true,
  verified: true,
  created_at: '2026-03-14T10:00:00Z',
  updated_at: '2026-03-14T10:00:00Z',
  user_name: userName,
}));

// The annual report's member compliance table: name, three hour totals,
// requirements met, expired certificates and a status badge. Overflows its
// card on a tablet with the side navigation open.
test.describe('Annual report member compliance table fits its card', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/training/admin?page=compliance&tab=annual-report — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: COMPLIANCE_PERMISSIONS });
      await page.route('**/api/v1/compliance/annual-report**', (route) => void route.fulfill(json(annualReport)));
      await page.goto('/training/admin?page=compliance&tab=annual-report');

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Training Hrs', exact: true }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Annual report member compliance table');
    });
  }
});

// The compliance officer's per-member projections: current, 30/60/90-day
// percentages and expiring certificates.
test.describe('Compliance forecast projections table fits its card', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/training/admin?page=compliance&tab=forecast — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: COMPLIANCE_PERMISSIONS });
      await page.route(
        '**/api/v1/training/reports/compliance-forecast**',
        (route) => void route.fulfill(json(complianceForecasts))
      );
      await page.goto('/training/admin?page=compliance&tab=forecast');

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Expiring Certs', exact: true }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Compliance forecast projections table');
    });
  }
});

// Instructor qualifications: instructor, type, a long course name, level,
// certificate number, expiry and a standing badge.
test.describe('Instructor qualifications table fits its card', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/training/admin?page=enhancements&tab=instructors — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: TRAINING_PERMISSIONS });
      await page.route(
        '**/api/v1/training/instructors/qualifications**',
        (route) => void route.fulfill(json(instructorQualifications))
      );
      await page.goto('/training/admin?page=enhancements&tab=instructors');

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Qualifies for', exact: true }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Instructor qualifications table');
    });
  }
});

// The reports tab's compliance forecast, loaded on demand: about 414px wide,
// so only a phone needs the reflow.
test.describe('Reports compliance forecast table fits its card', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/training/admin?page=enhancements&tab=reports — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: TRAINING_PERMISSIONS });
      await page.route(
        '**/api/v1/training/reports/compliance-forecast**',
        (route) => void route.fulfill(json(complianceForecasts))
      );
      await page.goto('/training/admin?page=enhancements&tab=reports');
      await page.getByRole('button', { name: 'Load Forecast' }).click();

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'At Risk', exact: true }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Reports compliance forecast table');
    });
  }
});
