import { expect, test } from '@playwright/test';
import { json, signIn, TEST_USER } from './helpers';
import { TABLE_FIT_VIEWPORTS, expectTableFitsItsCard } from './tableFit';

const PERMISSIONS = [...TEST_USER.permissions, 'training.view', 'training.manage'];

const MEMBER_NAMES = [
  'Alexandra Ayala-Montgomery',
  'Christopher Vanderbilt-Okonkwo',
  'Maximilian Hargreaves-Delacroix',
  'Jacqueline Fitzwilliam-Nakamura',
  'Bartholomew Castellanos-Whitfield',
  'Evangeline Rutherford-Abernathy',
];

const SKILL_NAMES = [
  'Self-Contained Breathing Apparatus Donning',
  'Ground Ladder Two-Person Flat Raise',
  'Hose Advancement Up Stairwells',
  'Patient Assessment and Management',
  'Vehicle Extrication Stabilization',
  'Forcible Entry Through-the-Lock',
  'Ventilation: Positive Pressure Fan Placement',
  'Search and Rescue: Oriented Search',
  'Hazardous Materials Decontamination Corridor',
  'Rapid Intervention Crew Firefighter Rescue',
  'Water Supply: Hydrant Connection',
  'Pump Operations: Relay Pumping',
  'Rope Rescue: Mechanical Advantage Systems',
  'Confined Space Entry Monitoring',
  'Cardiopulmonary Resuscitation with AED',
  'Wildland Fire Shelter Deployment',
];

const LEVELS = ['novice', 'advanced_beginner', 'competent', 'proficient', 'expert'];

// Thirty members, so the grid is taller than its bounded box on every screen.
const heatmapMembers = Array.from({ length: 30 }, (_, i) => ({
  user_id: `member-${i}`,
  name: `${MEMBER_NAMES[i % MEMBER_NAMES.length] ?? 'Member'} ${i + 1}`,
  station: `Station ${(i % 3) + 11} - Northwest Headquarters Annex`,
  rank: i % 2 ? 'Captain' : 'Firefighter/Paramedic',
}));

const heatmapSkills = SKILL_NAMES.map((name, i) => ({
  id: `skill-${i}`,
  name,
  category: i % 2 ? 'Fire Suppression Operations' : 'Emergency Medical Services',
}));

const heatmap = {
  members: heatmapMembers,
  skills: heatmapSkills,
  competencies: heatmapMembers.flatMap((member, m) =>
    heatmapSkills
      .filter((_, s) => (m + s) % 4 !== 0)
      .map((skill, s) => ({
        id: `competency-${m}-${s}`,
        organization_id: 'org-1',
        user_id: member.user_id,
        skill_evaluation_id: skill.id,
        current_level: LEVELS[(m + s) % LEVELS.length] ?? 'novice',
        last_evaluated_at: '2026-09-01T10:00:00Z',
        next_evaluation_due: '2027-03-01',
        created_at: '2026-09-01T10:00:00Z',
        updated_at: '2026-09-01T10:00:00Z',
      }))
  ),
};

/** The sticky member column: 7rem of name, its 8px gutter and 2px padding either side. */
const MAX_NAME_COLUMN_PX = 128;

// The department competency heat-map: members down the side, sixteen skills
// across. It stays a grid on a phone, scrolling both ways in a bounded box with
// the member column pinned left and the skill names pinned to the top.
test.describe('Competency heat-map stays readable as it scrolls', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/training/admin?page=enhancements&tab=competency — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: PERMISSIONS });
      await page.route('**/api/v1/training/competency/department**', (route) => void route.fulfill(json(heatmap)));
      await page.route('**/api/v1/training/competency/matrices**', (route) => void route.fulfill(json([])));
      await page.goto('/training/admin?page=enhancements&tab=competency');

      const table = page.getByRole('table', { name: 'Competency level by member and skill' });
      await table.getByRole('rowheader').first().waitFor();

      if (viewport.width === 390) {
        // The cue is drawn beside the scrolling box, inside the row's own wrapper.
        const grid = page.getByRole('group', { name: 'Competency levels by member and skill' });
        await expect(
          grid.locator('..').getByTestId('scroll-cue-right'),
          'nothing says the grid continues sideways'
        ).toBeVisible();
      }

      const nameColumn = await table
        .getByRole('rowheader')
        .first()
        .evaluate((el) => ({
          width: Math.ceil(el.getBoundingClientRect().width),
          position: getComputedStyle(el).position,
        }));
      expect(nameColumn.position, 'the member column is not pinned').toBe('sticky');
      expect(nameColumn.width, 'the member column crowds out the skills').toBeLessThanOrEqual(MAX_NAME_COLUMN_PX);

      const header = await table.evaluate((el) => {
        const box = el.parentElement;
        if (!box) return { scrolled: 0, headerTop: -1, boxTop: 0 };
        box.scrollTop = box.scrollHeight;
        const firstSkill = el.querySelectorAll('thead th')[1];
        return {
          scrolled: box.scrollTop,
          headerTop: Math.round(firstSkill ? firstSkill.getBoundingClientRect().top : -1),
          boxTop: Math.round(box.getBoundingClientRect().top),
        };
      });
      expect(header.scrolled, 'the grid does not scroll inside a bounded box').toBeGreaterThan(0);
      expect(
        Math.abs(header.headerTop - header.boxTop),
        'the skill names scrolled away with the rows'
      ).toBeLessThanOrEqual(1);
    });
  }
});

const parsedRows = MEMBER_NAMES.slice(0, 4).map((name, i) => ({
  row_number: i + 2,
  email: `${name.toLowerCase().replace(/[^a-z]/g, '.')}@northwestfirerescuedistrict.example.org`,
  member_name: name,
  member_matched: i !== 2,
  matched_member_name: i !== 2 ? name : undefined,
  user_id: i !== 2 ? `member-${i}` : undefined,
  course_name: 'Hazardous Materials Operations Level Refresher and Decontamination Procedures',
  course_matched: true,
  matched_course_id: 'course-1',
  completion_date: '2019-03-14',
  hours_completed: 124.5,
  errors: i === 3 ? ['Completion date is after the expiration date recorded for this certification'] : [],
}));

const parseResult = {
  total_rows: parsedRows.length,
  valid_rows: 3,
  members_matched: 3,
  members_unmatched: 1,
  courses_matched: 1,
  unmatched_courses: [],
  column_headers: ['email', 'course_name', 'completion_date', 'hours_completed'],
  rows: parsedRows,
  parse_errors: [],
};

// The parsed historical-training rows, shown after a CSV upload: row number,
// matched member with the email it was matched by, a long course name, date,
// hours and a status that can carry a whole validation message.
test.describe('Historical import preview table fits its card', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/training/admin?page=settings&tab=import — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: PERMISSIONS });
      await page.route('**/api/v1/training/import/parse**', (route) => void route.fulfill(json(parseResult)));
      await page.goto('/training/admin?page=settings&tab=import');

      await page.locator('input[type="file"]').setInputFiles({
        name: 'history.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('email,course_name,completion_date,hours_completed\n'),
      });

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Course', exact: true }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Historical import preview table');
    });
  }
});

const COURSE_NAME = 'Hazardous Materials Operations Level Refresher and Decontamination Procedures';
const VOID_REASON = 'Duplicate of the record entered by the training officer after the county academy sent its roster';

const memberVisibility = {
  show_training_history: true,
  show_training_hours: true,
  show_certification_status: true,
  show_pipeline_progress: true,
  show_requirement_details: true,
  show_shift_reports: true,
  show_shift_stats: true,
  show_officer_narrative: true,
  show_performance_rating: true,
  show_areas_of_strength: true,
  show_areas_for_improvement: true,
  show_skills_observed: true,
  show_submission_history: true,
  allow_member_report_export: true,
  report_review_required: false,
  report_review_role: 'training_officer',
  rating_label: 'Rating',
  rating_scale_type: 'numeric',
};

const myRecords = [0, 1, 2].map((i) => ({
  id: `record-${i}`,
  course_name: COURSE_NAME,
  course_code: 'HAZMAT-OPS-REFRESH-2026',
  training_type: 'continuing_education',
  status: i === 1 ? 'cancelled' : 'completed',
  completion_date: '2026-09-14',
  expiration_date: null,
  hours_completed: 124.5,
  voided_at: i === 2 ? '2026-10-01T10:00:00Z' : null,
  void_reason: i > 0 ? VOID_REASON : null,
  source: 'external',
  source_label: 'Target Solutions External Provider Import',
}));

const myTraining = {
  visibility: memberVisibility,
  training_records: myRecords,
  hours_summary: { total_records: 3, total_hours: 373.5, completed_courses: 3 },
  submissions: [0, 1].map((i) => ({
    id: `submission-${i}`,
    course_name: COURSE_NAME,
    training_type: 'certification',
    completion_date: '2026-09-14',
    hours_completed: 124.5,
    status: 'pending_review',
    submitted_at: '2026-09-15T10:00:00Z',
    reviewed_at: null,
  })),
};

const myHistory = {
  items: myRecords,
  total: myRecords.length,
  page: 1,
  page_size: 25,
  years: [{ year: '2026', records: 3, hours: 373.5, months: [{ month: '2026-09', records: 3, hours: 373.5 }] }],
};

const MY_TRAINING_TABLES = [
  // The newest few records: a long course name, type, date, hours and a status
  // that can carry the reason an event withdrew its credit.
  { name: 'Recent training', header: 'Type', open: null, history: false },
  // Self-reported training, collapsed until opened: course, date, hours,
  // review status and when it was submitted.
  { name: 'Self-reported training', header: 'Submitted', open: 'Self-Reported Training', history: false },
  // The History tab: the same records grouped by month, with their source.
  { name: 'Training history', header: 'Source', open: null, history: true },
];

for (const table of MY_TRAINING_TABLES) {
  test.describe(`${table.name} table fits its card`, () => {
    for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
      test(`/training/my-training — ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await signIn(page, { permissions: PERMISSIONS });
        await page.route(
          '**/api/v1/training/module-config/my-training/records**',
          (route) => void route.fulfill(json(myHistory))
        );
        await page.route(
          '**/api/v1/training/module-config/my-training',
          (route) => void route.fulfill(json(myTraining))
        );
        await page.goto('/training/my-training');

        if (table.open) await page.getByRole('button', { name: table.open }).click();
        // The page's own tab, not the side navigation's History section.
        if (table.history)
          await page
            .locator('button[aria-pressed]')
            .filter({ hasText: /^History$/ })
            .click();

        const found = page
          .getByRole('table')
          .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: table.header, exact: true }) });
        await found.waitFor();
        await expectTableFitsItsCard(found, `${table.name} table`);
      });
    }
  });
}

const STATUS_MEMBER_NAMES = MEMBER_NAMES.slice(0, 3);

const requirementAnalysisReport = {
  report_type: 'annual_compliance',
  organization_id: 'org-1',
  year: 2026,
  generated_at: '2026-11-08T10:00:00Z',
  executive_summary: {
    overall_compliance_pct: 78.5,
    total_members: 456,
    graded_members: 456,
    not_applicable_members: 0,
    fully_compliant_members: 123,
    total_training_hours: 123456.5,
    total_admin_hours: 23456.25,
    total_contributed_hours: 146912.75,
    total_certifications_active: 120,
    total_certifications_expired: 7,
    iso_readiness_pct: 82,
  },
  admin_hours_summary: { total_approved_hours: 1000, total_pending_hours: 20, total_entries: 50, by_category: [] },
  member_compliance: [],
  requirement_analysis: [0, 1, 2].map((i) => ({
    requirement_id: `requirement-${i}`,
    name: 'Annual Hazardous Materials Operations Level Refresher Continuing Education',
    type: 'continuing_education',
    members_compliant: 123,
    members_total: i === 2 ? 0 : 456,
    compliance_pct: 87.5,
  })),
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

// The annual report's per-requirement analysis: a long requirement name, its
// type, members compliant out of those held to it, and the percentage.
test.describe('Requirement compliance analysis table fits its card', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/training/admin?page=compliance&tab=annual-report — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: [...PERMISSIONS, 'compliance.manage'] });
      await page.route(
        '**/api/v1/compliance/annual-report**',
        (route) => void route.fulfill(json(requirementAnalysisReport))
      );
      await page.goto('/training/admin?page=compliance&tab=annual-report');

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Compliance %', exact: true }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Requirement compliance analysis table');
    });
  }
});

const expiringCertifications = STATUS_MEMBER_NAMES.map((name, i) => ({
  user_id: `member-${i}`,
  member_name: name,
  requirement_id: `requirement-${i}`,
  requirement_name: 'National Registry Emergency Medical Technician Recertification',
  expiry_date: '2026-12-14',
  days_until_expiry: [-123, 0, 145][i] ?? 1,
  status: 'expiring',
}));

// Certifications coming due: member, a long certification name, the expiry
// date and an urgency badge.
test.describe('Expiring certifications table fits its card', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/training/admin?page=dashboard&tab=expiring-certs — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: PERMISSIONS });
      await page.route(
        '**/api/v1/training/expiring-certifications**',
        (route) => void route.fulfill(json(expiringCertifications))
      );
      await page.goto('/training/admin?page=dashboard&tab=expiring-certs');

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Expiry Date', exact: true }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Expiring certifications table');
    });
  }
});

const memberStatus = {
  start_date: '2026-01-01',
  end_date: '2026-12-31',
  generated_at: '2026-11-01T10:00:00Z',
  members: STATUS_MEMBER_NAMES.map((name, i) => ({
    user_id: `member-${i}`,
    member_name: name,
    trainings_completed: 123,
    hours_completed: 1234.75,
    last_activity: '2026-09-14',
    compliance_status: ['green', 'yellow', 'red'][i] ?? 'green',
    requirements_met: 12,
    requirements_total: 14,
  })),
};

// Each member's activity for a period: trainings, hours, last activity and a
// standing badge beside requirements met. The headers are sort buttons.
test.describe('Member training status table fits its card', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/training/admin?page=records&tab=member-status — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: PERMISSIONS });
      await page.route('**/api/v1/training/records/member-status**', (route) => void route.fulfill(json(memberStatus)));
      await page.goto('/training/admin?page=records&tab=member-status');

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: /^Last activity/ }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Member training status table');
    });
  }
});
