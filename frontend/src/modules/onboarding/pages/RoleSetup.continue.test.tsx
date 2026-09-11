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
let ladderNeverSaved = false;
let ladderLoading = false;
let tierNamePending = false;
let rankFormPending = false;
vi.mock('../components', async () => {
  const actual = await vi.importActual<typeof import('../components')>('../components');
  const React = await import('react');
  return {
    ...actual,
    RankLadderSection: ({ onPendingChange }: { onPendingChange?: (p: boolean) => void }) => {
      React.useEffect(() => onPendingChange?.(rankFormPending), [onPendingChange]);
      return null;
    },
    MembershipLadderSection: ({
      onDirtyChange,
      onLoadingChange,
      onPendingTierChange,
    }: {
      onDirtyChange?: (d: boolean, neverSaved: boolean) => void;
      onLoadingChange?: (l: boolean) => void;
      onPendingTierChange?: (p: boolean) => void;
    }) => {
      React.useEffect(() => onDirtyChange?.(ladderDirty, ladderNeverSaved), [onDirtyChange]);
      React.useEffect(() => onLoadingChange?.(ladderLoading), [onLoadingChange]);
      React.useEffect(() => onPendingTierChange?.(tierNamePending), [onPendingTierChange]);
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
  ladderNeverSaved = false;
  ladderLoading = false;
  tierNamePending = false;
  rankFormPending = false;
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

    await user.click(screen.getByRole('button', { name: /continue to stations/i }));

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
    await user.click(screen.getByRole('button', { name: /continue to stations/i }));

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

    await user.click(screen.getByRole('button', { name: /continue to stations/i }));

    expect(savePositionsConfig).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('membership tier changes'));
  });
});

describe('a ladder the department has never stored', () => {
  it('tells them to save, not to discard, because discarding cannot clear it', async () => {
    // The backend synthesized this ladder, so the editor opens dirty and
    // reloading re-proposes it. Naming Discard here sends an administrator to a
    // button that puts them back where they started.
    ladderDirty = true;
    ladderNeverSaved = true;
    const user = userEvent.setup();
    renderStep();

    await user.click(screen.getByRole('button', { name: /continue to stations/i }));

    expect(savePositionsConfig).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('have not been stored yet'));
    expect(toastError).not.toHaveBeenCalledWith(expect.stringContaining('or discard'));
  });

  it('still offers discard for an ordinary unsaved edit', async () => {
    ladderDirty = true;
    ladderNeverSaved = false;
    const user = userEvent.setup();
    renderStep();

    await user.click(screen.getByRole('button', { name: /continue to stations/i }));

    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('Save or discard'));
  });
});

describe('a membership ladder that has not finished loading', () => {
  it('refuses to continue, because clean is not yet an answer', async () => {
    // `dirty` is false for the whole of the tier config read. An organization
    // with no stored `membership_tiers` gets `is_saved: false` and the editor
    // opens dirty — but only once the response lands, so a Continue pressed
    // before then walks straight past the guard, for exactly the organization
    // the guard exists for. The ladder is then never written and no backend
    // reader honours it.
    ladderLoading = true;
    const user = userEvent.setup();
    renderStep();

    await user.click(screen.getByRole('button', { name: /continue to stations/i }));

    expect(savePositionsConfig).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('still loading'));
  });

  it('lets a failed load through, because that step says to carry on', async () => {
    // `useTierEditor` leaves `loading` false when the read fails, and the
    // section's own message tells the administrator to set the tiers up later
    // under Members → Settings. Refusing Continue here would strand them on the
    // step behind a retry that may keep failing.
    ladderLoading = false;
    const user = userEvent.setup();
    renderStep();

    await user.click(screen.getByRole('button', { name: /continue to stations/i }));

    await waitFor(() => expect(savePositionsConfig).toHaveBeenCalled());
  });
});

describe('a draft saved before unticking meant deletion', () => {
  it('restores the positions that draft never named', async () => {
    // The build before this one preselected six positions, because leaving one
    // unticked meant "do not submit it" and the row survived regardless. That
    // draft is in localStorage. Restoring it verbatim and submitting it now
    // deletes the twenty-three it does not name — the same defect the
    // all-position initialisation exists to prevent, reached through a resumed
    // session instead of a fresh mount.
    useOnboardingStore.setState({
      positionsConfig: {
        it_manager: { id: 'it_manager', name: 'IT Manager', description: '', permissions: {}, priority: 100 },
        member: { id: 'member', name: 'Regular Member', description: '', permissions: {}, priority: 10 },
      },
      reconciledSeededSlugs: [],
    });
    const user = userEvent.setup();
    renderStep();

    await user.click(screen.getByRole('button', { name: /continue to stations/i }));

    await waitFor(() => expect(savePositionsConfig).toHaveBeenCalled());
    const sent = savePositionsConfig.mock.calls[0]?.[0] as { positions: { id: string }[] };
    const ids = sent.positions.map((p) => p.id);
    for (const id of ['captain', 'lieutenant', 'firefighter', 'treasurer']) {
      expect(ids).toContain(id);
    }
  });

  it('leaves an untick alone once the draft has been topped up', async () => {
    // The marker is what separates "written by the old build" from "narrowed on
    // purpose". A draft that already carries it is the administrator's own.
    useOnboardingStore.setState({
      positionsConfig: {
        it_manager: { id: 'it_manager', name: 'IT Manager', description: '', permissions: {}, priority: 100 },
        member: { id: 'member', name: 'Regular Member', description: '', permissions: {}, priority: 10 },
      },
      reconciledSeededSlugs: ['@all-positions-baseline'],
    });
    const user = userEvent.setup();
    renderStep();

    await user.click(screen.getByRole('button', { name: /continue to stations/i }));

    await waitFor(() => expect(savePositionsConfig).toHaveBeenCalled());
    const sent = savePositionsConfig.mock.calls[0]?.[0] as { positions: { id: string }[] };
    expect(sent.positions.map((p) => p.id)).not.toContain('captain');
  });
});

describe('a tier name typed but never added', () => {
  it('refuses to continue, the way an unsaved rank edit does', async () => {
    // The Add a tier field's value lives inside MembershipTiersSection, so it
    // is in neither the ladder's dirty flag nor the config a Save would write.
    // Continue unmounts the field, and the tier is gone with it.
    tierNamePending = true;
    const user = userEvent.setup();
    renderStep();

    await user.click(screen.getByRole('button', { name: /continue to stations/i }));

    expect(savePositionsConfig).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('tier you are typing'));
  });
});

describe('an unsaved rank edit', () => {
  it('refuses to continue, the way an unsaved tier edit does', async () => {
    // The rank editor's Add/Edit form is typed but not yet written, and
    // Continue unmounts the section that holds it.
    rankFormPending = true;
    const user = userEvent.setup();
    renderStep();

    await user.click(screen.getByRole('button', { name: /continue to stations/i }));

    expect(savePositionsConfig).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('rank you are editing'));
  });
});
