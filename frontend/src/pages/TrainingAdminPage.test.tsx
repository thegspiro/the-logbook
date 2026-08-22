import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
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

vi.mock('../components/HelpLink', () => ({
  HelpLink: () => null,
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: vi.fn((selector) => {
    const state = {
      user: {
        id: 'user-1',
        first_name: 'Admin',
        last_name: 'User',
        role: { slug: 'admin' },
        permissions: ['training.manage'],
      },
    };
    if (typeof selector === 'function') {
      return (selector as (s: typeof state) => unknown)(state);
    }
    return state;
  }),
}));

import TrainingAdminPage from './TrainingAdminPage';

describe('TrainingAdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/training/admin');
  });

  it('exposes both navigation levels as labelled tab interfaces', async () => {
    renderWithRouter(<TrainingAdminPage />);
    const sectionTablist = screen.getByRole('tablist', { name: 'Training admin sections' });
    const sectionTabs = within(sectionTablist).getAllByRole('tab');
    const dashboardTab = screen.getByRole('tab', { name: 'Dashboard' });
    const overviewTab = screen.getByRole('tab', { name: 'Overview' });

    expect(sectionTablist).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Dashboard tabs' })).toBeInTheDocument();
    expect(sectionTabs).toHaveLength(6);
    expect(dashboardTab).toHaveAttribute('aria-selected', 'true');
    expect(dashboardTab).toHaveAttribute('tabindex', '0');
    expect(overviewTab).toHaveAttribute('aria-selected', 'true');
    expect(overviewTab).not.toHaveAttribute('aria-current');

    const sectionPanel = screen.getByRole('tabpanel', { name: 'Dashboard' });
    const contentPanel = screen.getByRole('tabpanel', { name: 'Overview' });
    expect(dashboardTab).toHaveAttribute('aria-controls', sectionPanel.id);
    expect(overviewTab).toHaveAttribute('aria-controls', contentPanel.id);
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

  it('routes contextual actions to their existing tab destinations', async () => {
    const user = userEvent.setup();
    renderWithRouter(<TrainingAdminPage />);

    await user.click(screen.getByRole('tab', { name: 'Records' }));
    await user.click(screen.getByRole('button', { name: 'Create session' }));

    expect(screen.getByRole('tab', { name: 'Sessions' })).toHaveAttribute('aria-selected', 'true');
  });
});
