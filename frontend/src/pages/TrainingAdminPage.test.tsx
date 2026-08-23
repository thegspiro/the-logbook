import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

// Mock all lazy-loaded page imports before importing the component: these tests
// exercise navigation, not the child pages.
vi.mock('./TrainingOfficerDashboard', () => ({ default: () => <div data-testid="lazy-component">Dashboard</div> }));
vi.mock('./ComplianceMatrixTab', () => ({ default: () => <div data-testid="lazy-component">Compliance</div> }));
vi.mock('./ExpiringCertsTab', () => ({ default: () => <div data-testid="lazy-component">Expiring Certs</div> }));
vi.mock('./TrainingWaiversTab', () => ({ default: () => <div data-testid="lazy-component">Waivers</div> }));
vi.mock('./ReviewSubmissionsPage', () => ({ default: () => <div data-testid="lazy-component">Review</div> }));
vi.mock('./CreateTrainingSessionPage', () => ({ default: () => <div data-testid="lazy-component">Session</div> }));
vi.mock('./training/CohortsPage', () => ({ default: () => <div data-testid="lazy-component">Cohorts</div> }));
vi.mock('./ShiftReportPage', () => ({ default: () => <div data-testid="lazy-component">Shift Report</div> }));
vi.mock('./MemberTrainingStatusPage', () => ({ default: () => <div data-testid="lazy-component">Member Status</div> }));
vi.mock('./TrainingRequirementsPage', () => ({ default: () => <div data-testid="lazy-component">Requirements</div> }));
vi.mock('./CourseLibraryPage', () => ({ default: () => <div data-testid="lazy-component">Course Library</div> }));
vi.mock('./CreatePipelinePage', () => ({ default: () => <div data-testid="lazy-component">Pipeline</div> }));
vi.mock('./training/ManualEntrySettingsPanel', () => ({
  default: () => <div data-testid="lazy-component">Manual Entry</div>,
}));
vi.mock('./ExternalTrainingPage', () => ({ default: () => <div data-testid="lazy-component">External</div> }));
vi.mock('./HistoricalImportPage', () => ({ default: () => <div data-testid="lazy-component">Historical</div> }));
vi.mock('./SkillsTestingTemplatesTab', () => ({ default: () => <div data-testid="lazy-component">Templates</div> }));
vi.mock('./SkillsTestingTestRecordsTab', () => ({ default: () => <div data-testid="lazy-component">Records</div> }));
vi.mock('./TrainingEnhancementsTab', () => ({
  default: ({ activeTab }: { activeTab: string }) => (
    <div data-testid="lazy-component">{`Enhancements ${activeTab}`}</div>
  ),
}));
vi.mock('./ComplianceOfficerDashboard', () => ({
  default: ({ activeTab }: { activeTab: string }) => (
    <div data-testid="lazy-component">{`Compliance ${activeTab}`}</div>
  ),
}));

vi.mock('../components/HelpLink', () => ({ HelpLink: () => null }));

import TrainingAdminPage from './TrainingAdminPage';

describe('TrainingAdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/training/admin');
  });

  it('keeps Dashboard, Records, and Setup in the primary navigation', async () => {
    renderWithRouter(<TrainingAdminPage />);
    const navigation = screen.getByRole('tablist', { name: 'Training admin sections' });

    expect(navigation).toHaveTextContent('Dashboard');
    expect(navigation).toHaveTextContent('Records');
    expect(navigation).toHaveTextContent('Setup');
    expect(screen.getByRole('tab', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'More' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('exposes lower-frequency destinations in the More menu', async () => {
    const user = userEvent.setup();
    renderWithRouter(<TrainingAdminPage />);

    await user.click(screen.getByRole('button', { name: 'More' }));
    const menu = screen.getByRole('menu', { name: 'More training admin sections' });
    expect(menu).toHaveTextContent('Skills Testing');
    expect(menu).toHaveTextContent('Compliance');
    expect(menu).toHaveTextContent('Program Management');
    expect(menu).not.toHaveTextContent('Advanced');

    await user.click(screen.getByRole('menuitem', { name: /Program Management/ }));
    expect(screen.getByRole('button', { name: 'More' })).toHaveClass('bg-red-600');
    expect(window.location.search).toBe('?page=enhancements&tab=recertification');
  });

  it('presents the active primary section and destination', async () => {
    window.history.replaceState({}, '', '/training/admin?page=records&tab=sessions');
    renderWithRouter(<TrainingAdminPage />);

    expect(screen.getByRole('tab', { name: 'Records' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('tab', { name: 'Sessions' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Session')).toBeInTheDocument();
  });

  it('provides labeled section and destination selects for narrow screens', async () => {
    const user = userEvent.setup();
    renderWithRouter(<TrainingAdminPage />);

    const sectionSelect = screen.getByRole('combobox', { name: 'Training admin section' });
    expect(sectionSelect).toHaveClass('min-h-11');
    expect(screen.getByRole('option', { name: 'Program Management' })).toBeInTheDocument();

    await user.selectOptions(sectionSelect, 'skills-testing');
    const destinationSelect = screen.getByRole('combobox', { name: 'Skills Testing destination' });
    expect(destinationSelect).toHaveValue('templates');
    expect(screen.getByRole('option', { name: 'Test Records' })).toBeInTheDocument();
    expect(window.location.search).toBe('?page=skills-testing&tab=templates');
  });

  it('continues to resolve legacy flat tab parameters', async () => {
    window.history.replaceState({}, '', '/training/admin?tab=tests');
    renderWithRouter(<TrainingAdminPage />);

    expect(screen.getByRole('combobox', { name: 'Training admin section' })).toHaveValue('skills-testing');
    expect(screen.getByRole('combobox', { name: 'Skills Testing destination' })).toHaveValue('tests');
    expect(await screen.findByTestId('lazy-component')).toHaveTextContent('Records');
  });

  it('wires both navigation levels to their tab panels', async () => {
    renderWithRouter(<TrainingAdminPage />);
    const sectionTablist = screen.getByRole('tablist', { name: 'Training admin sections' });
    const dashboardTab = screen.getByRole('tab', { name: 'Dashboard' });
    const overviewTab = screen.getByRole('tab', { name: 'Overview' });

    expect(within(sectionTablist).getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByRole('tablist', { name: 'Dashboard tabs' })).toBeInTheDocument();
    expect(dashboardTab).toHaveAttribute('aria-selected', 'true');
    expect(overviewTab).toHaveAttribute('aria-selected', 'true');

    const sectionPanel = screen.getByRole('tabpanel', { name: 'Dashboard' });
    const contentPanel = screen.getByRole('tabpanel', { name: 'Overview' });
    expect(overviewTab).toHaveAttribute('aria-controls', contentPanel.id);
    expect(sectionPanel).toBeInTheDocument();
    expect(await screen.findByTestId('lazy-component')).toHaveTextContent('Dashboard');
  });

  it('uses roving focus and arrow, Home, and End keys for inner tabs', async () => {
    const user = userEvent.setup();
    renderWithRouter(<TrainingAdminPage />);
    const overviewTab = screen.getByRole('tab', { name: 'Overview' });

    overviewTab.focus();
    await user.keyboard('{ArrowRight}');
    const complianceTab = screen.getByRole('tab', { name: 'Compliance Matrix' });
    expect(complianceTab).toHaveFocus();
    expect(complianceTab).toHaveAttribute('aria-selected', 'true');
    expect(overviewTab).toHaveAttribute('tabindex', '-1');
    expect(window.location.search).toBe('?page=dashboard&tab=compliance');

    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Training Waivers' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveFocus();
  });

  it('activates top-level tabs from the keyboard and restores URL state on browser back', async () => {
    const user = userEvent.setup();
    renderWithRouter(<TrainingAdminPage />);
    const dashboardTab = screen.getByRole('tab', { name: 'Dashboard' });

    dashboardTab.focus();
    await user.keyboard('{ArrowRight}');
    const recordsTab = screen.getByRole('tab', { name: 'Records' });
    expect(recordsTab).toHaveFocus();
    expect(recordsTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tablist', { name: 'Records tabs' })).toBeInTheDocument();
    expect(window.location.search).toBe('?page=records&tab=submissions');

    window.history.back();
    await waitFor(() => expect(dashboardTab).toHaveAttribute('aria-selected', 'true'));
    expect(screen.getByRole('tablist', { name: 'Dashboard tabs' })).toBeInTheDocument();
  });

  it('updates the section description and actions after navigation', async () => {
    const user = userEvent.setup();
    renderWithRouter(<TrainingAdminPage />);

    expect(screen.getByText('Training overview, compliance tracking, and certificate monitoring')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review submissions' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Records' }));

    expect(screen.getByText('Review submissions, manage sessions, and generate shift reports')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review submissions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create session' })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Setup' }));

    expect(screen.getByText('Configure requirements, pipelines, integrations, and data imports')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage requirements' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create session' })).not.toBeInTheDocument();
  });

  // Every section reachable, and every section's default destination actually
  // renders its own child — a page whose entry is missing from TabContent's
  // if-chain falls through to `return null` and shows an empty panel, which no
  // single-page test would catch.
  const sectionCases = [
    ['dashboard', 'Dashboard', 'overview', 'Dashboard'],
    ['records', 'Records', 'submissions', 'Review'],
    ['setup', 'Setup', 'requirements', 'Requirements'],
    ['skills-testing', 'Skills Testing', 'templates', 'Templates'],
    ['enhancements', 'Program Management', 'recertification', 'Enhancements recertification'],
    ['compliance', 'Compliance', 'annual-report', 'Compliance annual-report'],
  ] as const;

  it.each(sectionCases)(
    'opens %s on its default destination and renders that child',
    async (pageId, pageLabel, defaultTab, content) => {
      const user = userEvent.setup();
      renderWithRouter(<TrainingAdminPage />);

      await user.selectOptions(screen.getByRole('combobox', { name: 'Training admin section' }), pageId);

      await waitFor(() => expect(screen.getByTestId('lazy-component')).toHaveTextContent(content));
      expect(window.location.search).toBe(`?page=${pageId}&tab=${defaultTab}`);
      expect(screen.getByRole('combobox', { name: `${pageLabel} destination` })).toHaveValue(defaultTab);
    }
  );

  // Switching destination within a section: the URL, the selected tab and the
  // rendered child all have to move together.
  const destinationCases = [
    ['dashboard', 'Dashboard', 'Compliance Matrix', 'compliance', 'Compliance'],
    ['records', 'Records', 'Course Cohorts', 'cohorts', 'Cohorts'],
    ['setup', 'Setup', 'Course Library', 'courses', 'Course Library'],
    ['skills-testing', 'Skills Testing', 'Test Records', 'tests', 'Records'],
    ['enhancements', 'Program Management', 'Effectiveness', 'effectiveness', 'Enhancements effectiveness'],
    ['compliance', 'Compliance', 'ISO Readiness', 'iso-readiness', 'Compliance iso-readiness'],
  ] as const;

  it.each(destinationCases)('moves %s to its %s destination', async (pageId, pageLabel, tabLabel, tabId, content) => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', `/training/admin?page=${pageId}`);
    renderWithRouter(<TrainingAdminPage />);

    await user.click(screen.getByRole('tab', { name: tabLabel }));

    await waitFor(() => expect(screen.getByTestId('lazy-component')).toHaveTextContent(content));
    expect(window.location.search).toBe(`?page=${pageId}&tab=${tabId}`);
    expect(screen.getByRole('tab', { name: tabLabel })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('combobox', { name: `${pageLabel} destination` })).toHaveValue(tabId);
  });

  it('routes contextual actions to their existing tab destinations', async () => {
    const user = userEvent.setup();
    renderWithRouter(<TrainingAdminPage />);

    await user.click(screen.getByRole('tab', { name: 'Records' }));
    await user.click(screen.getByRole('button', { name: 'Create session' }));

    expect(screen.getByRole('tab', { name: 'Sessions' })).toHaveAttribute('aria-selected', 'true');
  });
});
