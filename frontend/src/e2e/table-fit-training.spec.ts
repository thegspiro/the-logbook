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
