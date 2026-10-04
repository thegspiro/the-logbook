/**
 * Adding a typed position takes one tap (W50-63).
 *
 * The combobox used to mount a full-screen `fixed inset-0 z-10` click-away
 * scrim whenever the input had focus, even after the typed text matched no
 * rank and the listbox itself had unmounted. The scrim sat over the Add
 * button, so the first tap only dismissed nothing and the second one added.
 * The listbox now closes on the input's blur instead, so no scrim is ever
 * mounted and Add is reachable in both states.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const mockGetElections = vi.fn();
const mockGetRanks = vi.fn();

vi.mock('../services/api', () => ({
  electionService: {
    getElections: (...args: unknown[]) => mockGetElections(...args) as unknown,
    getElectionSettings: vi.fn().mockRejectedValue(new Error('not needed')),
  },
  eventService: { getEvents: vi.fn().mockResolvedValue([]) },
  meetingsService: { getMeetings: vi.fn().mockResolvedValue({ meetings: [] }) },
  ranksService: { getRanks: (...args: unknown[]) => mockGetRanks(...args) as unknown },
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    user: { id: 'u1', permissions: ['elections.manage'] },
    checkPermission: () => true,
  }),
}));

import { ElectionsPage } from './ElectionsPage';

const ranks = [
  { id: 'r1', rank_code: 'CHIEF', display_name: 'Fire Chief', description: null, is_active: true },
  { id: 'r2', rank_code: 'CAPT', display_name: 'Captain', description: null, is_active: true },
];

// The scrim was an aria-hidden, textless div with no role or label to query
// by; asserting its absence needs the class selector it used to carry.
const scrim = (container: HTMLElement) =>
  // eslint-disable-next-line testing-library/no-node-access -- see above
  container.querySelector('.fixed.inset-0.z-10');

async function openCreateDialog() {
  mockGetElections.mockResolvedValue([]);
  const view = renderWithRouter(<ElectionsPage />);
  await waitFor(() => {
    expect(screen.getByRole('button', { name: /^Create Election$/ })).toBeInTheDocument();
  });
  await userEvent.click(screen.getByRole('button', { name: /^Create Election$/ }));
  await waitFor(() => {
    expect(mockGetRanks).toHaveBeenCalled();
  });
  return view.container;
}

describe('ElectionsPage position combobox (W50-63)', () => {
  beforeEach(() => {
    mockGetElections.mockReset();
    mockGetRanks.mockReset();
    mockGetRanks.mockResolvedValue(ranks);
  });

  it('never mounts a click-away scrim, open listbox or not', async () => {
    const container = await openCreateDialog();
    const input = screen.getByRole('textbox', { name: 'Position name' });

    expect(scrim(container)).toBeNull();

    await userEvent.click(input);
    expect(screen.getByRole('listbox', { name: 'Available positions' })).toBeInTheDocument();
    expect(scrim(container)).toBeNull();

    await userEvent.type(input, 'Treasurer');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(scrim(container)).toBeNull();
  });

  it('closes the listbox when the input loses focus', async () => {
    await openCreateDialog();
    const input = screen.getByRole('textbox', { name: 'Position name' });

    await userEvent.type(input, 'Chief');
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    await userEvent.tab();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('adds a typed position on the first Add click while the listbox is open', async () => {
    await openCreateDialog();
    const input = screen.getByRole('textbox', { name: 'Position name' });

    await userEvent.type(input, 'Chief');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(screen.getByText('Chief')).toBeInTheDocument();
    expect(input).toHaveValue('');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('adds a typed position on the first Add click when nothing matches', async () => {
    await openCreateDialog();
    const input = screen.getByRole('textbox', { name: 'Position name' });

    await userEvent.type(input, 'Treasurer');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(screen.getByText('Treasurer')).toBeInTheDocument();
    expect(input).toHaveValue('');
  });
});
