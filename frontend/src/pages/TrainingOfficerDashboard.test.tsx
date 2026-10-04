import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const getDashboardSummary = vi.fn();
vi.mock('../services/api', () => ({
  trainingService: {
    getDashboardSummary: (...args: unknown[]) => getDashboardSummary(...args) as unknown,
  },
}));

import { renderWithRouter } from '../test/utils';
import TrainingOfficerDashboard from './TrainingOfficerDashboard';

const summary = {
  widget_metadata: {},
  stats: {
    total_members: 2,
    tracked_members: 2,
    active_requirements: 1,
    active_courses: 1,
    training_sessions: 1,
    active_programs: 0,
    compliant_members: 1,
    compliance_percentage: 50,
    expiring_count: 0,
    completions_last_30_days: 0,
    total_hours_this_year: 0,
    average_hours_per_member: 0,
  },
  expirations: [],
  recent_completions: [],
  requirements: [],
  members_needing_intervention: [],
  upcoming_session_capacity: [],
  pending_validation: { count: 0 },
  requirements_at_risk: [],
};

const LOAD_ERROR = 'Failed to load the dashboard. Check your connection and refresh the page.';

describe('TrainingOfficerDashboard', () => {
  beforeEach(() => {
    getDashboardSummary.mockReset();
    getDashboardSummary.mockResolvedValue(structuredClone(summary));
  });

  it('renders the widgets from a well-formed summary', async () => {
    renderWithRouter(<TrainingOfficerDashboard />);

    expect(await screen.findByText('50%')).toBeInTheDocument();
    expect(screen.queryByText(LOAD_ERROR)).not.toBeInTheDocument();
  });

  // A 200 that is not a summary — a captive portal's HTML page — used to read
  // `stats.active_courses` off undefined and take the whole Training hub down
  // through the ErrorBoundary. Empty stand-ins would be worse: "0% compliant"
  // is a claim an officer acts on. It lands on the page's own load error.
  it.each([
    ['an HTML page', '<html>Sign in to Wi-Fi</html>'],
    ['an empty object', {}],
    ['a summary missing one list', { ...summary, requirements_at_risk: undefined }],
    ['a summary whose stats are null', { ...summary, stats: null }],
  ])('shows its load error for %s', async (_label, body) => {
    getDashboardSummary.mockResolvedValue(body);
    renderWithRouter(<TrainingOfficerDashboard />);

    expect(await screen.findByText(LOAD_ERROR)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Training Officer Dashboard/ })).toBeInTheDocument();
  });
});

describe('TrainingOfficerDashboard header controls', () => {
  beforeEach(() => {
    getDashboardSummary.mockReset();
    getDashboardSummary.mockResolvedValue(structuredClone(summary));
  });

  // Icon-only buttons: `title` alone is a tooltip a phone never shows, and the
  // settings toggle has to say whether the panel it controls is open.
  it('names the icon buttons and reports the settings panel state', async () => {
    const user = userEvent.setup();
    renderWithRouter(<TrainingOfficerDashboard />);
    await screen.findByText('50%');

    expect(screen.getByRole('button', { name: 'Refresh data' })).toBeInTheDocument();
    const settings = screen.getByRole('button', { name: 'Dashboard settings' });
    expect(settings).toHaveAttribute('aria-expanded', 'false');

    await user.click(settings);
    expect(settings).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('heading', { name: 'Customize this training dashboard' })).toBeInTheDocument();
  });
});
