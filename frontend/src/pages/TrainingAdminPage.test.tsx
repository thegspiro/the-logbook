import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

// Mock all lazy-loaded page imports before importing the component
vi.mock('./TrainingOfficerDashboard', () => ({ default: () => <div data-testid="lazy-component">Dashboard</div> }));
vi.mock('./ComplianceMatrixTab', () => ({ default: () => <div data-testid="lazy-component">Compliance</div> }));
vi.mock('./ExpiringCertsTab', () => ({ default: () => <div data-testid="lazy-component">Expiring Certs</div> }));
vi.mock('./TrainingWaiversTab', () => ({ default: () => <div data-testid="lazy-component">Waivers</div> }));
vi.mock('./ReviewSubmissionsPage', () => ({ default: () => <div data-testid="lazy-component">Review</div> }));
vi.mock('./CreateTrainingSessionPage', () => ({ default: () => <div data-testid="lazy-component">Session</div> }));
vi.mock('./ShiftReportPage', () => ({ default: () => <div data-testid="lazy-component">Shift Report</div> }));
vi.mock('./TrainingRequirementsPage', () => ({ default: () => <div data-testid="lazy-component">Requirements</div> }));
vi.mock('./CreatePipelinePage', () => ({ default: () => <div data-testid="lazy-component">Pipeline</div> }));
vi.mock('./ExternalTrainingPage', () => ({ default: () => <div data-testid="lazy-component">External</div> }));
vi.mock('./HistoricalImportPage', () => ({ default: () => <div data-testid="lazy-component">Historical</div> }));
vi.mock('./SkillsTestingTemplatesTab', () => ({ default: () => <div data-testid="lazy-component">Templates</div> }));
vi.mock('./SkillsTestingTestRecordsTab', () => ({ default: () => <div data-testid="lazy-component">Records</div> }));
vi.mock('./TrainingEnhancementsTab', () => ({ default: () => <div data-testid="lazy-component">Enhancements</div> }));
vi.mock('./ComplianceOfficerDashboard', () => ({
  default: () => <div data-testid="lazy-component">Compliance Officer</div>,
}));

vi.mock('../components/HelpLink', () => ({
  HelpLink: () => null,
}));

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
    expect(screen.getByRole('button', { name: 'Sessions' })).toHaveAttribute('aria-current', 'page');
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

  it('routes contextual actions to their existing tab destinations', async () => {
    const user = userEvent.setup();
    renderWithRouter(<TrainingAdminPage />);

    await user.click(screen.getByRole('tab', { name: 'Records' }));
    await user.click(screen.getByRole('button', { name: 'Create session' }));

    expect(screen.getByRole('tab', { name: 'Sessions' })).toHaveAttribute('aria-selected', 'true');
  });
});
