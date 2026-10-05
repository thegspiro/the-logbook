/**
 * W50-26 — "Extend Time" accepted an end earlier than the current one without
 * a word, and a past time was refused only by the server. The modal now
 * disables the submit until the picked end is a real change in the future,
 * and asks for confirmation before shortening the window.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockConfirm = vi.fn();
vi.mock('../../contexts/ConfirmContext', () => ({
  useConfirm: () => ({ confirm: (...a: unknown[]) => mockConfirm(...a) as unknown }),
}));

import ExtendElectionModal from './ExtendElectionModal';

const NOW = new Date('2026-09-30T08:00:00Z');
const CURRENT_END = '2026-09-30T14:00:00Z';

const renderModal = () => {
  const onSubmit = vi.fn();
  render(
    <ExtendElectionModal
      currentEndDate={CURRENT_END}
      error={null}
      onSubmit={onSubmit}
      onClose={() => undefined}
      timezone="UTC"
    />
  );
  return { onSubmit };
};

const submitButton = () => screen.getByRole('button', { name: /Extend Election|Shorten Election/ });
const dateInput = () => screen.getByLabelText('New End Time');

describe('ExtendElectionModal end-time guard (W50-26)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
    mockConfirm.mockReset();
    mockConfirm.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('disables the submit until a new end is picked', () => {
    renderModal();
    expect(submitButton()).toBeDisabled();
    expect(screen.queryByTestId('extend-end-validation')).not.toBeInTheDocument();
  });

  it('refuses a past date with an inline message and a past-date floor on the picker', () => {
    const { onSubmit } = renderModal();
    expect(dateInput()).toHaveAttribute('min', '2026-09-30');

    fireEvent.change(dateInput(), { target: { value: '2026-09-29' } });

    expect(screen.getByTestId('extend-end-validation')).toHaveTextContent('already passed');
    expect(submitButton()).toBeDisabled();
    fireEvent.click(submitButton());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('submits a later end with no confirmation', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onSubmit } = renderModal();

    await user.click(screen.getByRole('button', { name: '+1 Hour' }));

    expect(screen.queryByTestId('extend-end-validation')).not.toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
    await user.click(submitButton());

    expect(mockConfirm).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledWith('2026-09-30T15:00');
  });

  it('asks before shortening the window and submits only on confirmation', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onSubmit } = renderModal();

    // Today at the picker's default 09:00 — in the future, but before the 14:00 close.
    fireEvent.change(dateInput(), { target: { value: '2026-09-30' } });

    expect(screen.getByTestId('extend-end-validation')).toHaveTextContent('shortens the voting window');
    expect(screen.getByRole('button', { name: 'Shorten Election' })).toBeEnabled();

    mockConfirm.mockResolvedValueOnce(false);
    await user.click(screen.getByRole('button', { name: 'Shorten Election' }));
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Shorten the voting window?', confirmLabel: 'Shorten voting window' })
    );
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Shorten Election' }));
    expect(onSubmit).toHaveBeenCalledWith('2026-09-30T09:00');
  });

  it('treats the current end re-picked as no change', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onSubmit } = renderModal();

    await user.click(screen.getByRole('button', { name: '+1 Hour' }));
    expect(submitButton()).toBeEnabled();

    // Back from 3 PM to 2 PM: the same instant as the current 14:00 close.
    await user.selectOptions(screen.getByLabelText('New end time hour'), '2');

    expect(screen.getByTestId('extend-end-validation')).toHaveTextContent('current end time');
    expect(submitButton()).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
