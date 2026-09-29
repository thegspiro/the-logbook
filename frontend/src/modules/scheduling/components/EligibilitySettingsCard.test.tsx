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

import { EligibilitySettingsCard } from './EligibilitySettingsCard';

beforeEach(() => {
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
});
