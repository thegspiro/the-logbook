import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import type { AdminHubSummary } from '../types/adminHub';

// Mock all lazy-loaded page imports before importing the component
// Hoisted because AdminMetricsSettings is imported eagerly, so its mock factory
// runs before this module's own top-level statements.
const { lazy } = vi.hoisted(() => ({
  lazy: (text: string) => ({ default: () => <div data-testid="lazy-component">{text}</div> }),
}));
vi.mock('./TrainingOfficerDashboard', () => lazy('Dashboard'));
vi.mock('./ComplianceMatrixTab', () => lazy('Compliance'));
vi.mock('./ExpiringCertsTab', () => lazy('Expiring Certs'));
vi.mock('./TrainingWaiversTab', () => lazy('Waivers'));
vi.mock('./ReviewSubmissionsPage', () => lazy('Review'));
vi.mock('./CreateTrainingSessionPage', () => lazy('Session'));
vi.mock('./ShiftReportPage', () => lazy('Shift Report'));
vi.mock('./training/CohortsPage', () => lazy('Cohorts'));
vi.mock('./MemberTrainingStatusPage', () => lazy('Member Status'));
vi.mock('./TrainingRequirementsPage', () => lazy('Requirements'));
vi.mock('./CourseLibraryPage', () => lazy('Courses'));
vi.mock('./CreatePipelinePage', () => lazy('Pipeline'));
vi.mock('./training/SkillEvaluationsTab', () => lazy('Skill Evaluations'));
vi.mock('./training/KnowledgeTestsTab', () => lazy('Knowledge Tests'));
vi.mock('./training/ManualEntrySettingsPanel', () => lazy('Manual Entry'));
vi.mock('./ExternalTrainingPage', () => lazy('External'));
vi.mock('./HistoricalImportPage', () => lazy('Historical'));
vi.mock('./SkillsTestingTemplatesTab', () => lazy('Templates'));
vi.mock('./SkillsTestingTestRecordsTab', () => lazy('Test Records'));
vi.mock('./TrainingEnhancementsTab', () => ({
  default: ({ activeTab }: { activeTab: string }) => <div data-testid="lazy-component">Enhancements {activeTab}</div>,
}));
vi.mock('./ComplianceOfficerDashboard', () => ({
  default: ({ activeTab }: { activeTab: string }) => (
    <div data-testid="lazy-component">Compliance Officer {activeTab}</div>
  ),
}));

vi.mock('../components/admin/AdminMetricsSettings', () => ({ AdminMetricsSettings: lazy('Metric Settings').default }));

vi.mock('../components/HelpLink', () => ({
  HelpLink: () => null,
}));

const mockGetSummary = vi.fn();
vi.mock('../services/adminHubService', () => ({
  adminHubService: {
    getSummary: (...args: unknown[]) => mockGetSummary(...args) as unknown,
  },
}));

import TrainingAdminPage from './TrainingAdminPage';

const summaryWithAttention: AdminHubSummary = {
  moduleKey: 'training',
  generatedAt: '2026-10-09T12:00:00Z',
  timezone: 'UTC',
  metrics: [],
  attention: [
    {
      key: 'pending_submissions',
      title: '3 training submissions awaiting approval',
      detail: 'oldest waiting 4 days',
      actionLabel: 'Review queue',
      href: '/training/admin?page=records&tab=submissions',
      severity: 'critical',
      count: 3,
      oldestAgeDays: 4,
    },
  ],
};

const areaTablist = () => screen.getByRole('tablist', { name: 'Training admin areas' });
const areaTab = (name: string) => within(areaTablist()).getByRole('tab', { name: new RegExp(`^${name}`) });

describe('TrainingAdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSummary.mockReset();
    mockGetSummary.mockResolvedValue({ ...summaryWithAttention, attention: [] });
    window.history.replaceState({}, '', '/training/admin');
  });

  it('shows every area at once, with what each holds', () => {
    renderWithRouter(<TrainingAdminPage />);

    const tabs = within(areaTablist()).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      expect.stringContaining('Overview'),
      expect.stringContaining('Records'),
      expect.stringContaining('Curriculum'),
      expect.stringContaining('Evaluations'),
      expect.stringContaining('Program Management'),
      expect.stringContaining('Compliance Reporting'),
      expect.stringContaining('Settings & Data'),
    ]);
    expect(areaTab('Curriculum')).toHaveTextContent('What members must complete, and the courses that count');
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
  });

  it('opens on the dashboard and names the open page and its purpose', async () => {
    renderWithRouter(<TrainingAdminPage />);

    expect(areaTab('Overview')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Dashboard' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Compliance, hours and what needs you')).toBeInTheDocument();
    expect(await screen.findByTestId('lazy-component')).toHaveTextContent('Dashboard');
  });

  it('moves to an area’s first destination and writes it to the URL', async () => {
    const user = userEvent.setup();
    renderWithRouter(<TrainingAdminPage />);

    await user.click(areaTab('Settings & Data'));

    expect(window.location.search).toBe('?page=settings&tab=manual-entry');
    expect(screen.getByRole('tablist', { name: 'Settings & Data pages' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('lazy-component')).toHaveTextContent('Manual Entry'));
  });

  // Links written against the retired sections are still all over the app.
  it.each([
    ['?page=setup&tab=requirements', 'Curriculum', 'Requirements', 'Requirements'],
    ['?page=setup&tab=integrations', 'Settings & Data', 'Integrations', 'External'],
    ['?page=skills-testing', 'Evaluations', 'Skill Evaluations', 'Skill Evaluations'],
    ['?tab=tests', 'Evaluations', 'Skills Test Records', 'Test Records'],
  ])('opens the older link %s in its new area', async (search, area, destination, content) => {
    window.history.replaceState({}, '', `/training/admin${search}`);
    renderWithRouter(<TrainingAdminPage />);

    expect(areaTab(area)).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: destination })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(screen.getByTestId('lazy-component')).toHaveTextContent(content));
  });

  // Every destination renders its own child — one missing from TabContent's
  // switch falls through to `return null` and shows an empty panel, which no
  // single-page test would catch.
  it.each([
    ['dashboard', 'compliance', 'Compliance'],
    ['dashboard', 'expiring-certs', 'Expiring Certs'],
    ['dashboard', 'waivers', 'Waivers'],
    ['records', 'submissions', 'Review'],
    ['records', 'sessions', 'Session'],
    ['records', 'cohorts', 'Cohorts'],
    ['records', 'shift-reports', 'Shift Report'],
    ['records', 'member-status', 'Member Status'],
    ['curriculum', 'courses', 'Courses'],
    ['curriculum', 'pipelines', 'Pipeline'],
    ['evaluations', 'knowledge-tests', 'Knowledge Tests'],
    ['evaluations', 'templates', 'Templates'],
    ['enhancements', 'instructors', 'Enhancements instructors'],
    ['compliance', 'forecast', 'Compliance Officer forecast'],
    ['settings', 'import', 'Historical'],
    ['settings', 'metrics', 'Metric Settings'],
  ])('renders %s / %s', async (area, tab, content) => {
    window.history.replaceState({}, '', `/training/admin?page=${area}&tab=${tab}`);
    renderWithRouter(<TrainingAdminPage />);

    await waitFor(() => expect(screen.getByTestId('lazy-component')).toHaveTextContent(content));
  });

  it('wires both navigation levels to their panels', () => {
    renderWithRouter(<TrainingAdminPage />);

    const overview = areaTab('Overview');
    expect(screen.getByRole('tabpanel', { name: /^Overview/ })).toHaveAttribute(
      'id',
      overview.getAttribute('aria-controls')
    );

    const dashboardTab = screen.getByRole('tab', { name: 'Dashboard' });
    expect(screen.getByRole('tabpanel', { name: 'Dashboard' })).toHaveAttribute(
      'id',
      dashboardTab.getAttribute('aria-controls')
    );
    // Inactive destinations keep a (hidden) panel so their aria-controls resolves.
    const waivers = screen.getByRole('tab', { name: 'Training Waivers' });
    const panelIds = screen.getAllByRole('tabpanel', { hidden: true }).map((panel) => panel.id);
    expect(panelIds).toContain(waivers.getAttribute('aria-controls'));
  });

  it('uses roving focus and arrow, Home and End keys between areas', async () => {
    const user = userEvent.setup();
    renderWithRouter(<TrainingAdminPage />);

    areaTab('Overview').focus();
    await user.keyboard('{ArrowRight}');
    expect(areaTab('Records')).toHaveFocus();
    expect(areaTab('Records')).toHaveAttribute('aria-selected', 'true');
    expect(areaTab('Overview')).toHaveAttribute('tabindex', '-1');
    expect(window.location.search).toBe('?page=records&tab=submissions');

    await user.keyboard('{End}');
    expect(areaTab('Settings & Data')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(areaTab('Overview')).toHaveFocus();
  });

  it('uses roving focus and arrow, Home and End keys between destinations', async () => {
    const user = userEvent.setup();
    renderWithRouter(<TrainingAdminPage />);

    screen.getByRole('tab', { name: 'Dashboard' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Compliance Matrix' })).toHaveFocus();
    expect(window.location.search).toBe('?page=dashboard&tab=compliance');

    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Training Waivers' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Dashboard' })).toHaveFocus();
  });

  it('follows the URL on browser back', async () => {
    const user = userEvent.setup();
    renderWithRouter(<TrainingAdminPage />);

    await user.click(areaTab('Records'));
    expect(areaTab('Records')).toHaveAttribute('aria-selected', 'true');

    window.history.back();
    await waitFor(() => expect(areaTab('Overview')).toHaveAttribute('aria-selected', 'true'));
  });

  it('sends Create Session to the sessions destination', async () => {
    const user = userEvent.setup();
    renderWithRouter(<TrainingAdminPage />);

    await user.click(screen.getByRole('button', { name: 'Create Session' }));

    expect(window.location.search).toBe('?page=records&tab=sessions');
    expect(screen.getByRole('tab', { name: 'Sessions' })).toHaveAttribute('aria-selected', 'true');
  });

  it('badges the area and destination the attention queue points at', async () => {
    mockGetSummary.mockResolvedValue(summaryWithAttention);
    window.history.replaceState({}, '', '/training/admin?page=records&tab=sessions');
    renderWithRouter(<TrainingAdminPage />);

    await waitFor(() => expect(areaTab('Records')).toHaveTextContent('3 need attention'));
    expect(screen.getByRole('tab', { name: /Submissions to Review/ })).toHaveTextContent('3 need attention');
    expect(areaTab('Overview')).not.toHaveTextContent('need attention');
  });

  it('shows no badges when the summary cannot be loaded', async () => {
    mockGetSummary.mockRejectedValue(new Error('boom'));
    renderWithRouter(<TrainingAdminPage />);

    await screen.findByRole('button', { name: 'Try again' });
    expect(areaTablist()).not.toHaveTextContent('need attention');
  });
});
