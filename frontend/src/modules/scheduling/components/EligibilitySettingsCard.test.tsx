import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetEligibility = vi.fn();
const mockUpdateEligibility = vi.fn();
vi.mock('../services/api', () => ({
  schedulingService: {
    getEligibilitySettings: (...a: unknown[]) => mockGetEligibility(...a) as unknown,
    updateEligibilitySettings: (...a: unknown[]) => mockUpdateEligibility(...a) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const mockShiftSettings = vi.fn();
vi.mock('../services/shiftSettingsApi', () => ({
  getCachedShiftSettings: () => mockShiftSettings() as unknown,
  ensureShiftSettingsLoaded: () => Promise.resolve(mockShiftSettings()),
}));

import { DEFAULT_SETTINGS } from '../types/shiftSettings';
import { EligibilitySettingsCard } from './EligibilitySettingsCard';

beforeEach(() => {
  mockShiftSettings.mockReset();
  mockShiftSettings.mockReturnValue(DEFAULT_SETTINGS);
  mockGetEligibility.mockReset();
  mockGetEligibility.mockResolvedValue({ excluded_membership_types: ['prospective'], open_positions: ['firefighter'] });
  mockUpdateEligibility.mockReset();
  mockUpdateEligibility.mockResolvedValue({});
});

describe('EligibilitySettingsCard', () => {
  it('says which membership types and positions are chosen, not only by colour', async () => {
    const user = userEvent.setup();
    render(<EligibilitySettingsCard />);

    const excluded = await screen.findByRole('group', { name: 'Excluded from Self-Signup' });
    expect(within(excluded).getByRole('button', { name: 'Prospective' })).toHaveAttribute('aria-pressed', 'true');
    const probationary = within(excluded).getByRole('button', { name: 'Probationary' });
    expect(probationary).toHaveAttribute('aria-pressed', 'false');

    const open = screen.getByRole('group', { name: 'Open Positions' });
    expect(within(open).getByRole('button', { name: 'Firefighter' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(probationary);
    expect(probationary).toHaveAttribute('aria-pressed', 'true');
  });

  it("offers the department's own seats, and keeps an open seat that was retired", async () => {
    // SCHED-CUSTOM-SEAT: a custom seat is assignable, so opening it to every
    // member is a grant the backend honours.
    mockShiftSettings.mockReturnValue({
      ...DEFAULT_SETTINGS,
      customPositions: [{ value: 'rescue_tech', label: 'Rescue Technician' }],
    });
    mockGetEligibility.mockResolvedValue({
      excluded_membership_types: [],
      open_positions: ['old_seat'],
    });
    const user = userEvent.setup();
    render(<EligibilitySettingsCard />);

    const open = await screen.findByRole('group', { name: 'Open Positions' });
    const rescue = within(open).getByRole('button', { name: 'Rescue Technician' });
    expect(rescue).toHaveAttribute('aria-pressed', 'false');
    expect(within(open).getByRole('button', { name: 'old seat' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(open).queryByRole('button', { name: 'Paramedic' })).not.toBeInTheDocument();

    await user.click(rescue);
    await user.click(screen.getByRole('button', { name: /Save Eligibility Settings/ }));
    expect(mockUpdateEligibility).toHaveBeenCalledWith({
      excluded_membership_types: [],
      open_positions: ['old_seat', 'rescue_tech'],
    });
  });
});
