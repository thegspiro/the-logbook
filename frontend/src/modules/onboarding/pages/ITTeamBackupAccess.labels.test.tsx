/**
 * Every field on the IT contacts step has a label a screen reader announces.
 *
 * Seven of its eight inputs had a visible <label> with no `htmlFor` and no
 * `id` to point at, so assistive technology announced them by placeholder or
 * not at all (workflow review W01-7).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../services/api-client', () => ({ apiClient: { saveITTeam: vi.fn() } }));
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

beforeEach(() => {
  useOnboardingStore.setState({ departmentName: 'Falls Church VFD' });
});

describe('IT contacts field labels', () => {
  it('labels every contact and backup field', () => {
    render(
      <ThemeProvider>
        <MemoryRouter>
          <ITTeamBackupAccess />
        </MemoryRouter>
      </ThemeProvider>
    );

    for (const label of [
      /^full name/i,
      /^role\/title/i,
      /^email/i,
      /^phone/i,
      /^backup recovery email/i,
      /^backup phone number/i,
      /^secondary admin email/i,
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it('does not send the administrator to a rank step that is behind them', () => {
    render(
      <ThemeProvider>
        <MemoryRouter>
          <ITTeamBackupAccess />
        </MemoryRouter>
      </ThemeProvider>
    );

    expect(screen.queryByText(/on the next step/i)).not.toBeInTheDocument();
    expect(screen.getByText(/members → settings → operational ranks/i)).toBeInTheDocument();
  });
});
