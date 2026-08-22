import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const lazyPage = (name: string) => () => <h2 data-testid={`page-${name}`}>{name}</h2>;

// Keep every import used by TabContent isolated: these tests exercise routing, not the child pages.
vi.mock('./TrainingOfficerDashboard', () => ({ default: lazyPage('dashboard-overview') }));
vi.mock('./ComplianceMatrixTab', () => ({ default: lazyPage('dashboard-compliance') }));
vi.mock('./ExpiringCertsTab', () => ({ default: lazyPage('dashboard-expiring-certs') }));
vi.mock('./TrainingWaiversTab', () => ({ default: lazyPage('dashboard-waivers') }));
vi.mock('./ReviewSubmissionsPage', () => ({ default: lazyPage('records-submissions') }));
vi.mock('./CreateTrainingSessionPage', () => ({ default: lazyPage('records-sessions') }));
vi.mock('./training/CohortsPage', () => ({ default: lazyPage('records-cohorts') }));
vi.mock('./ShiftReportPage', () => ({ default: lazyPage('records-shift-reports') }));
vi.mock('./MemberTrainingStatusPage', () => ({ default: lazyPage('records-member-status') }));
vi.mock('./TrainingRequirementsPage', () => ({ default: lazyPage('setup-requirements') }));
vi.mock('./CourseLibraryPage', () => ({ default: lazyPage('setup-courses') }));
vi.mock('./CreatePipelinePage', () => ({ default: lazyPage('setup-pipelines') }));
vi.mock('./training/ManualEntrySettingsPanel', () => ({ default: lazyPage('setup-manual-entry') }));
vi.mock('./ExternalTrainingPage', () => ({ default: lazyPage('setup-integrations') }));
vi.mock('./HistoricalImportPage', () => ({ default: lazyPage('setup-import') }));
vi.mock('./SkillsTestingTemplatesTab', () => ({ default: lazyPage('skills-testing-templates') }));
vi.mock('./SkillsTestingTestRecordsTab', () => ({ default: lazyPage('skills-testing-tests') }));
vi.mock('./TrainingEnhancementsTab', () => ({
  default: ({ activeTab }: { activeTab: string }) => lazyPage(`enhancements-${activeTab}`)(),
}));
vi.mock('./ComplianceOfficerDashboard', () => ({
  default: ({ activeTab }: { activeTab: string }) => lazyPage(`compliance-${activeTab}`)(),
}));

vi.mock('../components/HelpLink', () => ({ HelpLink: () => null }));

import TrainingAdminPage from './TrainingAdminPage';

const pageCases = [
  ['Dashboard', 'dashboard', 'Overview', 'overview', 'dashboard-overview'],
  ['Records', 'records', 'Submissions', 'submissions', 'records-submissions'],
  ['Setup', 'setup', 'Requirements', 'requirements', 'setup-requirements'],
  ['Skills Testing', 'skills-testing', 'Templates', 'templates', 'skills-testing-templates'],
  ['Advanced', 'enhancements', 'Recertification', 'recertification', 'enhancements-recertification'],
  ['Compliance', 'compliance', 'Annual Report', 'annual-report', 'compliance-annual-report'],
] as const;

const transitionCases = [
  ['dashboard', 'Dashboard', 'Compliance Matrix', 'compliance', 'dashboard-compliance'],
  ['records', 'Records', 'Sessions', 'sessions', 'records-sessions'],
  ['setup', 'Setup', 'Course Library', 'courses', 'setup-courses'],
  ['skills-testing', 'Skills Testing', 'Test Records', 'tests', 'skills-testing-tests'],
  ['enhancements', 'Advanced', 'Effectiveness', 'effectiveness', 'enhancements-effectiveness'],
  ['compliance', 'Compliance', 'ISO Readiness', 'iso-readiness', 'compliance-iso-readiness'],
] as const;

function startAt(search = '') {
  window.history.replaceState({}, '', `/training/admin${search}`);
  return renderWithRouter(<TrainingAdminPage />);
}

function expectLocation(page: string, tab: string) {
  expect(window.location.pathname).toBe('/training/admin');
  expect(window.location.search).toBe(`?page=${page}&tab=${tab}`);
}

async function expectSelection(pageLabel: string, tabLabel: string, content: string) {
  const pageNav = screen.getByRole('tablist', { name: 'Training admin sections' });
  expect(within(pageNav).getByRole('tab', { name: pageLabel, selected: true })).toBeVisible();
  const tabNav = screen.getByRole('navigation', { name: `${pageLabel} tabs` });
  expect(within(tabNav).getByRole('button', { name: tabLabel })).toHaveAttribute('aria-current', 'page');
  expect(await screen.findByRole('heading', { name: content })).toBeVisible();
}

describe('TrainingAdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/training/admin');
  });

  it.each(pageCases)('selecting %s uses its default tab', async (pageLabel, page, tabLabel, tab, content) => {
    expect.hasAssertions();
    const user = userEvent.setup();
    startAt();

    await user.click(screen.getByRole('tab', { name: pageLabel }));

    expectLocation(page, tab);
    await expectSelection(pageLabel, tabLabel, content);
  });

  it.each(transitionCases)(
    'supports an inner-tab transition on %s',
    async (page, pageLabel, tabLabel, tab, content) => {
      expect.hasAssertions();
      const user = userEvent.setup();
      startAt(`?page=${page}`);

      await user.click(screen.getByRole('button', { name: tabLabel }));

      expectLocation(page, tab);
      await expectSelection(pageLabel, tabLabel, content);
    }
  );

  it.each([
    ['?tab=sessions', 'Records', 'Sessions', 'records-sessions'],
    ['?tab=import', 'Setup', 'Import History', 'setup-import'],
    ['?tab=forecast', 'Compliance', 'Forecast', 'compliance-forecast'],
  ])('resolves the legacy URL %s', async (search, pageLabel, tabLabel, content) => {
    startAt(search);

    await expectSelection(pageLabel, tabLabel, content);
    expect(window.location.search).toBe(search);
  });

  it.each([
    ['?page=unknown&tab=also-unknown', 'Dashboard', 'Overview', 'dashboard-overview'],
    ['?page=records&tab=also-unknown', 'Records', 'Submissions', 'records-submissions'],
  ])('falls back safely for %s', async (search, pageLabel, tabLabel, content) => {
    startAt(search);

    await expectSelection(pageLabel, tabLabel, content);
    expect(window.location.search).toBe(search);
  });

  it('renders a direct deep link with matching navigation state', async () => {
    expect.hasAssertions();
    startAt('?page=setup&tab=manual-entry');

    expectLocation('setup', 'manual-entry');
    await expectSelection('Setup', 'Manual Entry', 'setup-manual-entry');
  });

  it('synchronizes selection and content with browser back and forward navigation', async () => {
    expect.hasAssertions();
    const user = userEvent.setup();
    startAt('?page=dashboard&tab=overview');
    await user.click(screen.getByRole('tab', { name: 'Records' }));
    await user.click(screen.getByRole('button', { name: 'Sessions' }));
    expectLocation('records', 'sessions');

    window.history.back();
    await waitFor(() => expectLocation('records', 'submissions'));
    await expectSelection('Records', 'Submissions', 'records-submissions');

    window.history.back();
    await waitFor(() => expectLocation('dashboard', 'overview'));
    await expectSelection('Dashboard', 'Overview', 'dashboard-overview');

    window.history.forward();
    await waitFor(() => expectLocation('records', 'submissions'));
    await expectSelection('Records', 'Submissions', 'records-submissions');
  });

  it('keeps both navigation rows horizontally scrollable without wrapping', () => {
    startAt('?page=setup&tab=requirements');

    expect(screen.getByRole('tablist', { name: 'Training admin sections' })).toHaveClass('hscroll');
    const innerNav = screen.getByRole('navigation', { name: 'Setup tabs' });
    expect(innerNav).toHaveClass('hscroll');
    expect(within(innerNav).getByRole('button', { name: 'Manual Entry' })).toHaveClass('whitespace-nowrap');
  });

  it('supports keyboard activation for page and inner-tab controls', async () => {
    expect.hasAssertions();
    const user = userEvent.setup();
    startAt();
    const records = screen.getByRole('tab', { name: 'Records' });
    records.focus();
    await user.keyboard('{Enter}');
    await expectSelection('Records', 'Submissions', 'records-submissions');

    const sessions = screen.getByRole('button', { name: 'Sessions' });
    sessions.focus();
    await user.keyboard(' ');
    expectLocation('records', 'sessions');
    await expectSelection('Records', 'Sessions', 'records-sessions');
  });
});
