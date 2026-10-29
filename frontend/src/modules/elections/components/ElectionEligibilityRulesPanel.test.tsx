/**
 * An election's own voter rules: editable until voting opens, saved with the
 * election, and shown as fixed once it is open.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { Election } from '../../../types/election';

const updateElection = vi.fn();

vi.mock('../../../services/api', () => ({
  electionService: {
    updateElection: (...args: unknown[]) => updateElection(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import { ElectionEligibilityRulesPanel } from './ElectionEligibilityRulesPanel';

const baseElection = {
  id: 'elec-1',
  status: 'draft',
  eligibility_rules: {
    attendance: { mode: 'count', min_meetings: 6, of_last_meetings: 12, meeting_types: ['business'] },
    waiting_periods: {},
  },
} as unknown as Election;

describe('ElectionEligibilityRulesPanel', () => {
  beforeEach(() => {
    updateElection.mockReset();
    updateElection.mockImplementation((_id: string, data: Partial<Election>) =>
      Promise.resolve({ ...baseElection, ...data })
    );
  });

  it('saves a changed rule onto the election', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    renderWithRouter(<ElectionEligibilityRulesPanel election={baseElection} onUpdate={onUpdate} />);

    const save = screen.getByRole('button', { name: 'Save voter rules' });
    expect(save).toBeDisabled();

    await user.selectOptions(screen.getByLabelText('Administrative members'), 'months');
    await user.click(save);

    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
    expect(updateElection).toHaveBeenCalledWith('elec-1', {
      eligibility_rules: {
        attendance: { mode: 'count', min_meetings: 6, of_last_meetings: 12, meeting_types: ['business'] },
        waiting_periods: { administrative: { mode: 'months', months: 12 } },
      },
    });
  });

  it('discards an unsaved change', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ElectionEligibilityRulesPanel election={baseElection} onUpdate={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText('Requirement'), 'none');
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));

    expect(screen.getByLabelText('Requirement')).toHaveValue('count');
    expect(screen.getByRole('button', { name: 'Save voter rules' })).toBeDisabled();
  });

  it('shows the rules as fixed once voting is open', () => {
    renderWithRouter(
      <ElectionEligibilityRulesPanel election={{ ...baseElection, status: 'open' }} onUpdate={vi.fn()} />
    );

    expect(screen.queryByRole('button', { name: 'Save voter rules' })).not.toBeInTheDocument();
    expect(screen.getByText('Attended at least 6 of their last 12 business meetings')).toBeInTheDocument();
  });

  it('asks before moving the election to the annual meeting, then lets the server re-apply its rules', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    renderWithRouter(<ElectionEligibilityRulesPanel election={baseElection} onUpdate={onUpdate} />);

    await user.selectOptions(screen.getByLabelText('Held at'), 'annual');
    await user.click(await screen.findByRole('button', { name: 'Keep current rules' }));
    expect(updateElection).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByLabelText('Held at'), 'annual');
    await user.click(await screen.findByRole('button', { name: 'Change and replace rules' }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
    expect(updateElection).toHaveBeenCalledWith('elec-1', { meeting_kind: 'annual' });
  });
});
