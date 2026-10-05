/**
 * The Remind Non-Voters dialog told the officer "N eligible voters have not
 * yet voted" — but paper ballots are never matched to a member, so a paper
 * voter is in that count and gets a reminder — and never mentioned the
 * server's 60-minute cooldown, which surfaced only as a 400 after pressing
 * Send (W50-64, W50-27). The dialog now states what the count is, when the
 * last reminder went out, and refuses the send itself while inside the
 * cooldown.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

import RemindNonVotersModal from './RemindNonVotersModal';
import { reminderCooldownRemainingMinutes } from '../../utils/electionHelpers';

const NOW = new Date('2026-09-30T12:00:00Z');

const renderModal = (props: Partial<React.ComponentProps<typeof RemindNonVotersModal>> = {}) => {
  const onSubmit = vi.fn();
  render(
    <RemindNonVotersModal
      nonVoterCount={7}
      reminderSentAt={null}
      sending={false}
      error={null}
      onSubmit={onSubmit}
      onClose={() => undefined}
      {...props}
    />
  );
  return { onSubmit };
};

describe('RemindNonVotersModal count sentence and cooldown (W50-64)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('describes the count as members with no electronic ballot, naming paper ballots', () => {
    renderModal();
    const sentence = screen.getByText(/no electronic ballot on file/);
    expect(sentence).toHaveTextContent('7 eligible voters have no electronic ballot on file');
    expect(sentence).toHaveTextContent('Paper ballots are not matched to members');
    expect(screen.queryByText(/not yet voted/)).not.toBeInTheDocument();
  });

  it('states the cooldown and allows the send when no reminder has gone out', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onSubmit } = renderModal();

    expect(screen.getByTestId('reminder-cooldown')).toHaveTextContent('at most once every 60 minutes');
    expect(screen.getByTestId('reminder-cooldown')).not.toHaveTextContent('Last reminder sent');

    const send = screen.getByRole('button', { name: 'Send Reminders (7)' });
    expect(send).toBeEnabled();
    await user.click(send);
    expect(onSubmit).toHaveBeenCalledWith('');
  });

  it('shows the last reminder time and disables the send inside the cooldown', () => {
    renderModal({ reminderSentAt: '2026-09-30T11:35:00Z' });

    const note = screen.getByTestId('reminder-cooldown');
    expect(note).toHaveTextContent('Last reminder sent Wednesday, September 30, 2026');
    expect(note).toHaveTextContent('can be sent in about 35 minutes');

    const send = screen.getByRole('button', { name: 'Send Reminders (7)' });
    expect(send).toBeDisabled();
    expect(send).toHaveAttribute('title', expect.stringContaining('try again in about 35 minute'));
  });

  it('re-enables the send once the cooldown has elapsed, keeping the last-sent stamp', () => {
    renderModal({ reminderSentAt: '2026-09-30T10:59:00Z' });

    const note = screen.getByTestId('reminder-cooldown');
    expect(note).toHaveTextContent('Last reminder sent');
    expect(note).not.toHaveTextContent('can be sent in about');
    expect(screen.getByRole('button', { name: 'Send Reminders (7)' })).toBeEnabled();
  });
});

describe('reminderCooldownRemainingMinutes', () => {
  const now = NOW.getTime();

  it('mirrors the server arithmetic: 60 minus whole elapsed minutes, never below 1 inside the window', () => {
    expect(reminderCooldownRemainingMinutes(null, now)).toBe(0);
    expect(reminderCooldownRemainingMinutes('2026-09-30T12:00:00Z', now)).toBe(60);
    expect(reminderCooldownRemainingMinutes('2026-09-30T11:00:30Z', now)).toBe(1);
    expect(reminderCooldownRemainingMinutes('2026-09-30T11:00:00Z', now)).toBe(0);
    expect(reminderCooldownRemainingMinutes('2026-09-30T09:00:00Z', now)).toBe(0);
  });

  it('treats an unparseable or future stamp as no cooldown rather than locking the button', () => {
    expect(reminderCooldownRemainingMinutes('not a date', now)).toBe(0);
    expect(reminderCooldownRemainingMinutes('2026-09-30T12:05:00Z', now)).toBe(0);
  });
});
