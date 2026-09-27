/**
 * The IT team step can be skipped.
 *
 * The step is optional — `config/steps.ts` says so, the backend marks it
 * `required: False`, and the progress sidebar tells the admin "Skip is a
 * complete answer" — yet the page had no Skip, and Continue would not proceed
 * until five contact fields were filled in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const saveITTeam = vi.fn();
const navigate = vi.fn();

vi.mock('../services/api-client', () => ({
  apiClient: { saveITTeam: (...args: unknown[]) => saveITTeam(...args) as unknown },
}));
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useNavigate: () => navigate,
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
import { nextStepPath } from '../config/steps';

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
  saveITTeam.mockResolvedValue({ data: { success: true } });
  navigate.mockReset();
  useOnboardingStore.setState({ departmentName: 'Falls Church VFD' });
});

describe('skipping the IT team step', () => {
  it('moves on with nothing filled in', async () => {
    const user = userEvent.setup();
    renderStep();

    await user.click(screen.getByRole('button', { name: 'Skip for now' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith(nextStepPath('it_team')));
    expect(screen.queryByText(/backup recovery email is required/i)).not.toBeInTheDocument();
  });

  it('saves an empty step, so contacts from an earlier pass do not become accounts', async () => {
    const user = userEvent.setup();
    renderStep();

    await user.click(screen.getByRole('button', { name: 'Skip for now' }));

    await waitFor(() => expect(saveITTeam).toHaveBeenCalledWith({ it_team: [], backup_access: {} }));
  });

  it('stays on the step when the save fails', async () => {
    saveITTeam.mockResolvedValue({ error: 'Session expired' });
    const user = userEvent.setup();
    renderStep();

    await user.click(screen.getByRole('button', { name: 'Skip for now' }));

    await waitFor(() => expect(saveITTeam).toHaveBeenCalled());
    expect(navigate).not.toHaveBeenCalledWith(nextStepPath('it_team'));
  });

  it('retries the skip, not a Continue, after a failed skip', async () => {
    saveITTeam.mockResolvedValueOnce({ error: 'Session expired' });
    const user = userEvent.setup();
    renderStep();

    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    await user.click(await screen.findByRole('button', { name: /retry|try again/i }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith(nextStepPath('it_team')));
    expect(saveITTeam).toHaveBeenLastCalledWith({ it_team: [], backup_access: {} });
  });
});
