/**
 * The permission grid offers rows for the modules the department enabled.
 *
 * It was built from the whole registry, so a department that enabled six
 * modules still scrolled permission toggles for all twenty. Before the
 * 2026-09-11 reorder that was invisible — positions came before module
 * selection, so there was no answer to filter against.
 *
 * The load-bearing part is what is NOT filtered. Only the display narrows:
 * the stored permission set still spans the whole registry, so a module
 * enabled months later already carries its template's grants rather than
 * silently having none. Filtering the stored set is the version of this change
 * that would need a backfill on module enable, and the last test here is what
 * stops someone making that trade by accident.
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

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

// The two ladders own APIs this file does not exercise. They must still report
// themselves loaded and clean, or the step keeps Continue disabled waiting for
// them — matching the stubs in RoleSetup.continue.test.tsx.
vi.mock('../components', async () => {
  const actual = await vi.importActual<typeof import('../components')>('../components');
  const React = await import('react');
  return {
    ...actual,
    RankLadderSection: ({ onPendingChange }: { onPendingChange?: (p: boolean) => void }) => {
      React.useEffect(() => onPendingChange?.(false), [onPendingChange]);
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
      React.useEffect(() => onDirtyChange?.(false, false), [onDirtyChange]);
      React.useEffect(() => onLoadingChange?.(false), [onLoadingChange]);
      React.useEffect(() => onPendingTierChange?.(false), [onPendingTierChange]);
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

/**
 * Open one position's permission grid. Only one position expands at a time and
 * the module names appear nowhere else on the step, so the assertions below
 * query the screen directly rather than reaching for a container element.
 */
const openPermissions = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: /^Fire Chief - click to expand permissions$/ }));
  await screen.findByText('Click to toggle permissions for each module:');
};

beforeEach(() => {
  vi.clearAllMocks();
  savePositionsConfig.mockReset();
  savePositionsConfig.mockResolvedValue({ data: { created: [], updated: [], removed: [] } });
  useOnboardingStore.setState({
    departmentName: 'Falls Church VFD',
    organizationType: 'fire_department',
    positionsConfig: null,
    reconciledSeededSlugs: [],
    moduleStatuses: {},
  });
});

describe('the permission grid', () => {
  it('offers rows for enabled modules and leaves out the rest', async () => {
    useOnboardingStore.setState({
      moduleStatuses: { training: 'enabled', inventory: 'enabled', elections: 'ignored' },
    });
    const user = userEvent.setup();
    renderStep();

    await openPermissions(user);

    expect(screen.getByText('Training & Certifications')).toBeInTheDocument();
    expect(screen.getByText('Inventory')).toBeInTheDocument();
    expect(screen.queryByText('Elections & Voting')).not.toBeInTheDocument();
    expect(screen.queryByText('Department Store')).not.toBeInTheDocument();
  });

  it('always offers the System modules, which are never a choice', async () => {
    // Position Management and Organization Settings gate real permissions but
    // are never offered on the module step, so they never appear in
    // moduleStatuses and must not be filtered out by that absence.
    useOnboardingStore.setState({ moduleStatuses: { training: 'enabled' } });
    const user = userEvent.setup();
    renderStep();

    await openPermissions(user);

    expect(screen.getByText('Position Management')).toBeInTheDocument();
    expect(screen.getByText('Organization Settings')).toBeInTheDocument();
  });

  it('shows everything when the module step has not been answered', async () => {
    // Fail open: a deep link or a restored session can reach this step with no
    // answer, and an empty permission grid is worse than a long one.
    const user = userEvent.setup();
    renderStep();

    await openPermissions(user);

    expect(screen.getByText('Elections & Voting')).toBeInTheDocument();
    expect(screen.getByText('Department Store')).toBeInTheDocument();
  });

  it('says how many rows are hidden, and reveals them on request', async () => {
    useOnboardingStore.setState({ moduleStatuses: { training: 'enabled' } });
    const user = userEvent.setup();
    renderStep();

    await openPermissions(user);
    expect(screen.getByText(/modules you did not enable are hidden/i)).toBeInTheDocument();
    expect(screen.queryByText('Department Store')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /show all modules/i }));

    expect(screen.getByText('Department Store')).toBeInTheDocument();
  });

  it('still stores permissions for every module, not only the visible ones', async () => {
    // The invariant the whole approach rests on. If this fails, enabling a
    // module later leaves every position unable to use it.
    useOnboardingStore.setState({ moduleStatuses: { training: 'enabled' } });
    const user = userEvent.setup();
    renderStep();

    await user.click(screen.getByRole('button', { name: /continue to stations/i }));

    await waitFor(() => expect(savePositionsConfig).toHaveBeenCalled());
    const sent = savePositionsConfig.mock.calls[0]?.[0] as {
      positions: Array<{ id: string; permissions: Record<string, unknown> }>;
    };
    const chief = sent.positions.find((p) => p.id === 'fire_chief');

    expect(chief).toBeDefined();
    for (const hidden of ['elections', 'storefront', 'inventory']) {
      expect(Object.keys(chief?.permissions ?? {})).toContain(hidden);
    }
  });
});
