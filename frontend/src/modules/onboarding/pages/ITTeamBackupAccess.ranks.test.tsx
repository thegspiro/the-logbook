/**
 * What the IT team step shows when the rank list does not load.
 *
 * `useRanks` swallowed the failure into an empty array, and this step read only
 * `rankOptions` — so a failed `/operational-ranks` read rendered a selector
 * offering nothing but "No rank", which looks exactly like a department that
 * has not set any. Every contact would then be created without the rank the
 * administrator meant to give them, with nothing anywhere saying why.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const useRanks = vi.fn();
vi.mock('../../../hooks/useRanks', () => ({ useRanks: () => useRanks() as unknown }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import ITTeamBackupAccess from './ITTeamBackupAccess';
import { useOnboardingStore } from '../store';
import { ThemeProvider } from '../../../contexts/ThemeContext';

const renderStep = () =>
  render(
    <ThemeProvider>
      <MemoryRouter>
        <ITTeamBackupAccess />
      </MemoryRouter>
    </ThemeProvider>
  );

const ranks = (over: Record<string, unknown> = {}) => ({
  ranks: [],
  rankOptions: [{ value: 'captain', label: 'Captain' }],
  loading: false,
  failed: false,
  refetch: vi.fn(),
  formatRank: (r: string) => r,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  useRanks.mockReturnValue(ranks());
  useOnboardingStore.setState({ departmentName: 'Falls Church VFD' });
});

describe('the rank selector on the IT team step', () => {
  it('offers the ladder when it loaded', () => {
    renderStep();

    expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0);
    expect(screen.queryByText(/could not be loaded/i)).not.toBeInTheDocument();
  });

  it('says the list is missing rather than showing an empty one', () => {
    useRanks.mockReturnValue(ranks({ failed: true, rankOptions: [] }));
    renderStep();

    expect(screen.getAllByText(/the rank list could not be loaded/i).length).toBeGreaterThan(0);
  });

  it('distinguishes a failed read from a department with no ranks', () => {
    // The wording is the whole point: "not shown, not missing".
    useRanks.mockReturnValue(ranks({ failed: true, rankOptions: [] }));
    renderStep();

    expect(screen.getAllByText(/not shown, not missing/i).length).toBeGreaterThan(0);
  });

  it('offers a retry', () => {
    const refetch = vi.fn();
    useRanks.mockReturnValue(ranks({ failed: true, rankOptions: [], refetch }));
    renderStep();

    expect(screen.getAllByRole('button', { name: /try again/i }).length).toBeGreaterThan(0);
  });
});
