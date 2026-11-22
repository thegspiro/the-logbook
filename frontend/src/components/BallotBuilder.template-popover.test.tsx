/**
 * The template picker opened upward from its button whatever the room. On the
 * election's ballot page the button sits near the top of a short page, so the
 * panel's heading and saved templates ran past the top of the screen, where
 * nothing could scroll to them.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import type { Election } from '../types/election';

const getBallotTemplates = vi.fn();
const getSavedBallotTemplates = vi.fn();

vi.mock('../services/api', () => ({
  electionService: {
    getBallotTemplates: (...args: unknown[]) => getBallotTemplates(...args) as unknown,
    getSavedBallotTemplates: (...args: unknown[]) => getSavedBallotTemplates(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import { BallotBuilder } from './BallotBuilder';

const election = {
  id: 'elec-1',
  status: 'draft',
  positions: ['Chief'],
  ballot_items: [
    {
      id: 'item-1',
      type: 'general_vote',
      title: 'Article VII Amendment',
      description: '',
      vote_type: 'approval',
      eligible_voter_types: ['all'],
      require_attendance: false,
    },
  ],
  total_votes: 0,
} as unknown as Election;

/** Puts the toolbar's Use Template button at `top`, and `left`, in a 1440x900 window. */
function placeButton(top: number, left = 900) {
  const button = screen.getByRole('button', { name: /^Use Template$/ });
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
    top,
    bottom: top + 36,
    left,
    right: left + 160,
    width: 160,
    height: 36,
    x: left,
    y: top,
    toJSON: () => ({}),
  });
  return button;
}

describe('BallotBuilder template picker placement', () => {
  const originalHeight = window.innerHeight;
  const originalWidth = window.innerWidth;

  beforeEach(() => {
    getBallotTemplates.mockReset();
    getSavedBallotTemplates.mockReset();
    getBallotTemplates.mockResolvedValue([]);
    getSavedBallotTemplates.mockResolvedValue([]);
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
    vi.restoreAllMocks();
  });

  it('keeps the whole panel on screen when its button is part-way down a short page', async () => {
    const user = userEvent.setup();
    renderWithRouter(<BallotBuilder electionId="elec-1" election={election} onUpdate={vi.fn()} />);
    await user.click(placeButton(473));

    const panel = screen.getByTestId('template-popover');
    expect(panel).toHaveClass('bottom-full');
    // 473px of button top, less the 8px gap, leaves the panel's top 16px
    // inside the window rather than ~160px above it.
    expect(panel.style.maxHeight).toBe(`${473 - 8 - 16}px`);
    expect(screen.getByText('Select a Template')).toBeInTheDocument();
  });

  it('opens downward when its button is near the top', async () => {
    const user = userEvent.setup();
    renderWithRouter(<BallotBuilder electionId="elec-1" election={election} onUpdate={vi.fn()} />);
    await user.click(placeButton(200));

    const panel = screen.getByTestId('template-popover');
    expect(panel).toHaveClass('top-full');
    expect(panel).not.toHaveClass('bottom-full');
    expect(panel.style.maxHeight).toBe('630px');
  });

  it('opens upward, capped below the top edge, when its button is near the bottom', async () => {
    const user = userEvent.setup();
    renderWithRouter(<BallotBuilder electionId="elec-1" election={election} onUpdate={vi.fn()} />);
    await user.click(placeButton(800));

    const panel = screen.getByTestId('template-popover');
    expect(panel).toHaveClass('bottom-full');
    expect(panel.style.maxHeight).toBe('630px');
  });

  it('keeps the panel inside the left edge when its button is at the left of the row', async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    renderWithRouter(<BallotBuilder electionId="elec-1" election={election} onUpdate={vi.fn()} />);
    await user.click(placeButton(400, 40));

    const panel = screen.getByTestId('template-popover');
    // Right-aligned to a button at x 40-200, a 358px panel started at -118px.
    expect(panel.style.width).toBe('358px');
    expect(panel.style.left).toBe(`${16 - 40}px`);
  });
});
