/**
 * The backup recovery email cannot be the administrator's own.
 *
 * The step told the administrator to "use a different email than the primary
 * admin account" and then accepted the same address, so recovery would go to
 * the very mailbox it exists to replace (workflow review W01-12).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const saveITTeam = vi.fn();

vi.mock('../services/api-client', () => ({
  apiClient: { saveITTeam: (...args: unknown[]) => saveITTeam(...args) as unknown },
}));
vi.mock('../../../hooks/useRanks', () => ({
  useRanks: () => ({
    ranks: [],
    rankOptions: [],
    loading: false,
    failed: false,
    refetch: vi.fn(),
    formatRank: (r: string) => r,
  }),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import ITTeamBackupAccess from './ITTeamBackupAccess';
import { useOnboardingStore } from '../store';
import { ThemeProvider } from '../../../contexts/ThemeContext';

const SAME_MAILBOX = 'Use a different email than the administrator account';

const renderStep = () =>
  render(
    <ThemeProvider>
      <MemoryRouter>
        <ITTeamBackupAccess />
      </MemoryRouter>
    </ThemeProvider>
  );

beforeEach(() => {
  saveITTeam.mockReset();
  saveITTeam.mockResolvedValue({ data: {} });
  useOnboardingStore.setState({
    departmentName: 'Falls Church VFD',
    systemOwnerFirstName: 'Riley',
    systemOwnerLastName: 'Owner',
    systemOwnerEmail: 'Riley.Owner@example.org',
    backupEmail: '',
    backupPhone: '',
    secondaryAdminEmail: '',
  });
});

describe('backup recovery email', () => {
  it("refuses the administrator's own address, whatever its case", async () => {
    const user = userEvent.setup();
    renderStep();

    await user.type(screen.getByLabelText(/^backup recovery email/i), ' riley.owner@EXAMPLE.org ');
    await user.click(screen.getByRole('button', { name: /^continue to/i }));

    expect(await screen.findByText(SAME_MAILBOX)).toBeInTheDocument();
    expect(saveITTeam).not.toHaveBeenCalled();
  });

  it('accepts a different address', async () => {
    const user = userEvent.setup();
    renderStep();

    await user.type(screen.getByLabelText(/^backup recovery email/i), 'chief@example.org');
    await user.click(screen.getByRole('button', { name: /^continue to/i }));

    expect(screen.queryByText(SAME_MAILBOX)).not.toBeInTheDocument();
  });
});

// Add Member was 36px tall at phone width (found driving workflow review W01-13).
describe('IT contacts touch targets', () => {
  it('gives Add Member the phone touch minimum', () => {
    renderStep();

    expect(screen.getByRole('button', { name: /add member/i })).toHaveClass('touch-target-phone');
  });
});
