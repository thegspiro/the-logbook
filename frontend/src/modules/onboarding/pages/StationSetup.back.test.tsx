/**
 * Stations goes Back to the step before it.
 *
 * Ranks & Positions can be revisited, but Stations showed the "organization
 * details are already saved" note that belongs beside Organization Setup in
 * place of a Back button (workflow review W01-16).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const navigate = vi.fn();
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useNavigate: () => navigate,
}));
vi.mock('../services/api-client', () => ({ apiClient: { saveStations: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import StationSetup from './StationSetup';
import { useOnboardingStore } from '../store';
import { ThemeProvider } from '../../../contexts/ThemeContext';
import { previousStepPath } from '../config/steps';

const renderStep = () =>
  render(
    <ThemeProvider>
      <MemoryRouter>
        <StationSetup />
      </MemoryRouter>
    </ThemeProvider>
  );

beforeEach(() => {
  navigate.mockReset();
  useOnboardingStore.setState({ departmentName: 'Falls Church VFD', stations: [] });
});

describe('Stations', () => {
  it('goes back to Ranks & Positions', async () => {
    const user = userEvent.setup();
    renderStep();

    await user.click(screen.getByRole('button', { name: 'Back' }));

    expect(navigate).toHaveBeenCalledWith('/onboarding/positions');
    expect(previousStepPath('stations')).toBe('/onboarding/positions');
  });

  it('does not tell the administrator the step cannot be revisited', () => {
    renderStep();

    expect(screen.queryByText(/organization details are already saved/i)).not.toBeInTheDocument();
  });

  // W01-14's sibling: the button read "Reset Progress" and was named "Reset
  // onboarding progress", so a voice-control user saying what they saw got no match.
  it('names Reset Progress by the words it shows', () => {
    renderStep();

    expect(screen.getByRole('button', { name: 'Reset Progress' })).toHaveClass('touch-target-phone');
  });
});
