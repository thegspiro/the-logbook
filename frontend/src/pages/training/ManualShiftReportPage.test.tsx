import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';

vi.mock('../../services/api', () => ({
  shiftCompletionService: {},
  trainingModuleConfigService: {
    getConfig: () => Promise.resolve({ manual_entry_require_apparatus: true }),
  },
  userService: {
    getUsers: () => Promise.resolve([{ id: 'u1', first_name: 'Jordan', last_name: 'Avery', status: 'active' }]),
  },
}));

vi.mock('../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getApparatusOptions: () =>
      Promise.resolve({
        options: [{ id: 'app-1', name: 'Engine 1', unit_number: 'E-1', apparatus_type: 'engine', source: 'basic' }],
      }),
    // The call-type chips come from the department's one list, not a
    // report-specific one.
    getFeatureSettings: () =>
      Promise.resolve({
        call_tracking: {
          mode: 'detailed',
          call_types: [
            { slug: 'structure_fire', label: 'Structure Fire', active: true },
            { slug: 'brush', label: 'Brush Fire', active: false },
          ],
        },
      }),
  },
}));

vi.mock('../../stores/authStore', () => {
  const state = { user: { id: 'officer-1', organization_id: 'org-1' } };
  return {
    // Selector-aware, as the real store is: the draft hook reads the user id through one.
    useAuthStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state),
  };
});

vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'America/Chicago' }));

import ManualShiftReportPage from './ManualShiftReportPage';

describe('ManualShiftReportPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  // Forms review F-6, owner decision 2026-11-06.
  it('restores a half-written report from its local draft, and says so', async () => {
    const user = userEvent.setup();
    const view = renderWithRouter(<ManualShiftReportPage />);
    await user.selectOptions(await screen.findByLabelText(/^Apparatus/), 'app-1');
    await user.type(screen.getByLabelText('Overall Shift Narrative'), 'Quiet night, two EMS assists.');
    view.unmount();

    renderWithRouter(<ManualShiftReportPage />);
    expect(await screen.findByText('Restored your unsaved draft.')).toBeInTheDocument();
    expect(screen.getByLabelText('Overall Shift Narrative')).toHaveValue('Quiet night, two EMS assists.');
    expect(await screen.findByLabelText(/^Apparatus/)).toHaveValue('app-1');
  });

  it('names its fields by their labels and exposes the chosen call types', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ManualShiftReportPage />);

    expect(await screen.findByLabelText(/^Apparatus/)).toBeInTheDocument();
    for (const label of [
      /^Start Date/,
      /^Start Time/,
      /^End Date/,
      /^End Time/,
      'Calls Responded',
      'Overall Shift Narrative',
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole('textbox', { name: 'Search members to add' })).toBeInTheDocument();

    const structure = await screen.findByRole('button', { name: 'Structure Fire' });
    // A retired type is not offered for a new report.
    expect(screen.queryByRole('button', { name: 'Brush Fire' })).not.toBeInTheDocument();
    expect(structure).toHaveAttribute('aria-pressed', 'false');
    await user.click(structure);
    expect(structure).toHaveAttribute('aria-pressed', 'true');
  });
});
