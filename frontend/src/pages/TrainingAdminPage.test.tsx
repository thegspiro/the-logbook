import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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
  });

  it('renders the admin page with navigation tabs', async () => {
    renderWithRouter(<TrainingAdminPage />);
    await waitFor(() => {
      // Should show main navigation sections
      expect(screen.getAllByText(/dashboard|training/i).length).toBeGreaterThan(0);
    });
  });

  it('renders without crashing', () => {
    const { container } = renderWithRouter(<TrainingAdminPage />);
    expect(container).toBeInTheDocument();
  });

  it('shows the default tab content', async () => {
    renderWithRouter(<TrainingAdminPage />);
    await waitFor(() => {
      expect(screen.getAllByTestId('lazy-component').length).toBeGreaterThan(0);
    });
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
    expect(screen.getByRole('button', { name: 'Add requirement' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create session' })).not.toBeInTheDocument();
  });

  it('routes contextual actions to their existing tab destinations', async () => {
    const user = userEvent.setup();
    renderWithRouter(<TrainingAdminPage />);

    await user.click(screen.getByRole('tab', { name: 'Records' }));
    await user.click(screen.getByRole('button', { name: 'Create session' }));

    expect(screen.getByRole('button', { name: 'Sessions' })).toHaveAttribute('aria-current', 'page');
  });
});
