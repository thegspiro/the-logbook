/**
 * An apparatus can ride the same position more than once.
 *
 * Each riding position is a seat (CLAUDE.md pitfall 20), but the step offered
 * each position once and hid its button after, so an engine riding an
 * officer, a driver and two firefighters could not be entered (workflow
 * review W01-6).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

vi.mock('../services/api-client', () => ({ apiClient: { saveApparatus: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import ApparatusSetup from './ApparatusSetup';
import { useOnboardingStore } from '../store';
import { ThemeProvider } from '../../../contexts/ThemeContext';

const renderStep = () =>
  render(
    <ThemeProvider>
      <MemoryRouter>
        <ApparatusSetup />
      </MemoryRouter>
    </ThemeProvider>
  );

const seats = () =>
  screen.getAllByRole('button', { name: /^remove .* \(seat \d+\)$/i }).map((b) => b.getAttribute('aria-label'));

beforeEach(() => {
  useOnboardingStore.setState({ departmentName: 'Falls Church VFD', apparatus: [] });
});

describe('riding positions', () => {
  it('adds a position once per seat', async () => {
    const user = userEvent.setup();
    renderStep();
    await user.click(screen.getByRole('button', { name: /add apparatus/i }));

    for (const position of ['officer', 'driver', 'firefighter', 'firefighter']) {
      await user.click(screen.getByRole('button', { name: new RegExp(`^\\+ ${position}$`, 'i') }));
    }

    expect(seats()).toEqual([
      'Remove officer (seat 1)',
      'Remove driver (seat 2)',
      'Remove firefighter (seat 3)',
      'Remove firefighter (seat 4)',
    ]);
  });

  it('removes one seat, not every seat with that position', async () => {
    const user = userEvent.setup();
    renderStep();
    await user.click(screen.getByRole('button', { name: /add apparatus/i }));
    await user.click(screen.getByRole('button', { name: /^\+ firefighter$/i }));
    await user.click(screen.getByRole('button', { name: /^\+ firefighter$/i }));

    await user.click(screen.getByRole('button', { name: 'Remove firefighter (seat 2)' }));

    expect(seats()).toEqual(['Remove firefighter (seat 1)']);
  });

  it('writes EMT as an abbreviation', async () => {
    const user = userEvent.setup();
    renderStep();
    await user.click(screen.getByRole('button', { name: /add apparatus/i }));

    expect(screen.getByRole('button', { name: '+ EMT' })).toBeInTheDocument();
  });
});
