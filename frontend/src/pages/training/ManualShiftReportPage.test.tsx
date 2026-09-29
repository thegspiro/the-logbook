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
  },
}));

vi.mock('../../stores/authStore', () => ({
  useAuthStore: () => ({ user: { id: 'officer-1', organization_id: 'org-1' } }),
}));

vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'America/Chicago' }));

import ManualShiftReportPage from './ManualShiftReportPage';

describe('ManualShiftReportPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    const structure = screen.getByRole('button', { name: 'Structure Fire' });
    expect(structure).toHaveAttribute('aria-pressed', 'false');
    await user.click(structure);
    expect(structure).toHaveAttribute('aria-pressed', 'true');
  });
});
