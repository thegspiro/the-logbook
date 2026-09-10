/**
 * What pressing Continue on the Ranks & Positions step does when nothing was
 * edited — which is how the overwhelming majority of departments leave it.
 *
 * Two ways that click can quietly destroy work, both found in review:
 *
 * Unticking a position now removes it, so the set left ticked *is* the
 * department's structure. Six positions used to be preselected, from when an
 * unticked box meant "do not submit" and the row survived regardless; carrying
 * that forward would have made the default Continue delete the twenty-three it
 * does not name.
 *
 * And the membership ladder batches its edits behind its own Save, so editing
 * it and pressing Continue lost the lot behind a success toast.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const savePositionsConfig = vi.fn();
vi.mock('../services/api-client', () => ({
  apiClient: {
    savePositionsConfig: (...args: unknown[]) => savePositionsConfig(...args) as unknown,
  },
}));

const toastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: (...args: unknown[]) => toastError(...args) as unknown },
}));

// The two ladders each own an API of their own; this file is about the step's
// Continue, so they are stubbed down to what it needs to know.
let ladderDirty = false;
vi.mock('../components', async () => {
  const actual = await vi.importActual<typeof import('../components')>('../components');
  const React = await import('react');
  return {
    ...actual,
    RankLadderSection: () => null,
    MembershipLadderSection: ({ onDirtyChange }: { onDirtyChange?: (d: boolean) => void }) => {
      React.useEffect(() => onDirtyChange?.(ladderDirty), [onDirtyChange]);
      return null;
    },
  };
});

import RoleSetup from './RoleSetup';
import { useOnboardingStore } from '../store';
import { ThemeProvider } from '../../../contexts/ThemeContext';

const renderStep = () =>
  render(
    <ThemeProvider>
      <MemoryRouter>
        <RoleSetup />
      </MemoryRouter>
    </ThemeProvider>
  );

beforeEach(() => {
  vi.clearAllMocks();
  ladderDirty = false;
  savePositionsConfig.mockResolvedValue({ data: { created: [], updated: [], removed: [] } });
  useOnboardingStore.setState({
    departmentName: 'Falls Church VFD',
    organizationType: 'fire_department',
    positionsConfig: null,
    reconciledSeededSlugs: [],
  });
});

describe('the unedited Continue', () => {
  it('submits every position the agency has, not a shortlist', async () => {
    const user = userEvent.setup();
    renderStep();

    await user.click(screen.getByRole('button', { name: /continue to modules/i }));

    await waitFor(() => expect(savePositionsConfig).toHaveBeenCalled());
    const sent = savePositionsConfig.mock.calls[0]?.[0] as { positions: { id: string }[] };
    const ids = sent.positions.map((p) => p.id);

    // The six that used to be preselected, and a sample of the twenty-three
    // that were not — those are the ones the default Continue would have
    // deleted.
    for (const id of ['it_manager', 'member', 'fire_chief', 'captain', 'lieutenant', 'firefighter', 'treasurer']) {
      expect(ids).toContain(id);
    }
    expect(ids.length).toBeGreaterThan(20);
  });

  it('still lets a department untick what it does not have', async () => {
    const user = userEvent.setup();
    renderStep();

    await user.click(screen.getByRole('checkbox', { name: /^Lieutenant - / }));
    await user.click(screen.getByRole('button', { name: /continue to modules/i }));

    await waitFor(() => expect(savePositionsConfig).toHaveBeenCalled());
    const sent = savePositionsConfig.mock.calls[0]?.[0] as { positions: { id: string }[] };
    expect(sent.positions.map((p) => p.id)).not.toContain('lieutenant');
  });
});

describe('unsaved membership ladder edits', () => {
  it('refuses to continue, rather than reporting success and losing them', async () => {
    ladderDirty = true;
    const user = userEvent.setup();
    renderStep();

    await user.click(screen.getByRole('button', { name: /continue to modules/i }));

    expect(savePositionsConfig).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('membership tier changes'));
  });
});
