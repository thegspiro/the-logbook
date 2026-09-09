/**
 * What the Positions step says about Medical Supplies.
 *
 * Every route in `medical_supplies.py` is gated
 * `require_permission('inventory.view_medical', 'inventory.view')` — an OR — so
 * the broad Inventory grant opens the module on its own. Every seeded position
 * down to `member` carries `inventory.view`, and `facilities_manager` carries
 * `inventory.manage` with no medical grant at all.
 *
 * The editor showed all of them an unticked Medical Supplies box, which was a
 * claim they could not reach the module. Worse, the box looked like it would
 * revoke: unticking it removes only the narrow grant, so the access survives
 * and the box re-ticks on reload.
 *
 * So it is shown on and not editable while Inventory confers it, with the
 * reason on the control. The lock is read off the grid being edited rather
 * than a stored answer, so unticking Inventory releases it in the same breath.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

vi.mock('../services/api-client', () => ({
  apiClient: { savePositionsConfig: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../components', async () => {
  const actual = await vi.importActual<typeof import('../components')>('../components');
  return { ...actual, RankLadderSection: () => null, MembershipLadderSection: () => null };
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

/** Open one position's permission grid. */
const openPermissions = async (user: ReturnType<typeof userEvent.setup>, name: RegExp) => {
  await user.click(screen.getByRole('button', { name }));
};

// Matches the control in both states: locked it is named for the reason, and
// released it takes the ordinary enable/disable label.
const medicalView = () =>
  screen.getByRole('button', {
    name: /(medical supplies view comes with|view permission for medical supplies)/i,
  });
const inventoryView = () => screen.getByRole('button', { name: /view permission for Inventory$/i });

beforeEach(() => {
  vi.clearAllMocks();
  useOnboardingStore.setState({
    departmentName: 'Falls Church VFD',
    organizationType: 'fire_department',
    positionsConfig: null,
    reconciledSeededSlugs: [],
  });
});

describe('a tier another module confers', () => {
  it('shows Medical Supplies as granted, for a position holding only Inventory view', async () => {
    // `member` is seeded `inventory.view` and no medical grant, so the box read
    // unticked while every member of the department could open the module.
    const user = userEvent.setup();
    renderStep();
    await openPermissions(user, /^Regular Member - click to expand/i);

    expect(medicalView()).toBeDisabled();
  });

  it('says on the control why it cannot be turned off', async () => {
    // A disabled control with no reason reads as a bug. The name has to carry
    // the explanation, because it is the only thing a screen reader gets.
    const user = userEvent.setup();
    renderStep();
    await openPermissions(user, /^Regular Member - click to expand/i);

    expect(medicalView()).toHaveAccessibleName(/comes with Inventory view and cannot be turned off separately/i);
  });

  it('does nothing when the locked control is clicked', async () => {
    const user = userEvent.setup();
    renderStep();
    await openPermissions(user, /^Regular Member - click to expand/i);

    await user.click(medicalView());

    expect(medicalView()).toBeDisabled();
  });

  it('releases the tier when Inventory view is unticked', async () => {
    // The lock is read off the grid, not a stored answer: taking Inventory away
    // is what actually revokes the medical access, and the editor has to follow
    // that in the same breath rather than after a reload.
    const user = userEvent.setup();
    renderStep();
    await openPermissions(user, /^Regular Member - click to expand/i);

    await user.click(inventoryView());

    expect(medicalView()).toBeEnabled();
    expect(medicalView()).toHaveAccessibleName(/enable view permission for medical supplies/i);
  });

  it('leaves a module nothing else confers editable', async () => {
    const user = userEvent.setup();
    renderStep();
    await openPermissions(user, /^Regular Member - click to expand/i);

    expect(inventoryView()).toBeEnabled();
  });
});
