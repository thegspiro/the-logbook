import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Event } from '../../types/event';

const setGuestHeadcount = vi.fn();
vi.mock('../../services/api', () => ({
  eventService: {
    setGuestHeadcount: (...args: unknown[]) => setGuestHeadcount(...args) as unknown,
  },
}));
const toastSuccess = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: { success: (...args: unknown[]) => toastSuccess(...args) as unknown, error: vi.fn() },
}));

import EventGuestHeadcountCard from './EventGuestHeadcountCard';
import { MAX_GUEST_HEADCOUNT, parseHeadcount } from './guestHeadcount';

const event = (guest_headcount: number | null = null): Event =>
  ({ id: 'e1', title: 'Fire prevention assembly', guest_headcount }) as Event;

describe('parseHeadcount', () => {
  it('takes a whole number and refuses anything else', () => {
    expect(parseHeadcount(' 140 ')).toEqual({ value: 140 });
    expect(parseHeadcount('0')).toEqual({ value: 0 });
    expect(parseHeadcount('')).toHaveProperty('error');
    expect(parseHeadcount('12.5')).toHaveProperty('error');
    expect(parseHeadcount('-3')).toHaveProperty('error');
    expect(parseHeadcount(String(MAX_GUEST_HEADCOUNT + 1))).toHaveProperty('error');
  });
});

describe('EventGuestHeadcountCard', () => {
  beforeEach(() => {
    setGuestHeadcount.mockReset();
    toastSuccess.mockReset();
  });

  it('saves the count and hands the saved event back to the page', async () => {
    setGuestHeadcount.mockResolvedValue(event(140));
    const onSaved = vi.fn();
    render(<EventGuestHeadcountCard event={event()} onSaved={onSaved} />);

    await userEvent.type(screen.getByLabelText('Guests counted'), '140');
    await userEvent.click(screen.getByRole('button', { name: 'Save headcount' }));

    expect(setGuestHeadcount).toHaveBeenCalledWith('e1', 140);
    expect(onSaved).toHaveBeenCalledWith(event(140));
    expect(toastSuccess).toHaveBeenCalledWith('Headcount saved: 140 guests.');
  });

  it('shows why a value is refused, without sending it', async () => {
    render(<EventGuestHeadcountCard event={event()} onSaved={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('Guests counted'), 'about 40');
    await userEvent.click(screen.getByRole('button', { name: 'Save headcount' }));

    expect(screen.getByText('Enter the number of guests as a whole number.')).toBeInTheDocument();
    expect(setGuestHeadcount).not.toHaveBeenCalled();
  });

  it('clears a recorded count with an explicit null', async () => {
    setGuestHeadcount.mockResolvedValue(event(null));
    const onSaved = vi.fn();
    render(<EventGuestHeadcountCard event={event(75)} onSaved={onSaved} />);

    expect(screen.getByLabelText('Guests counted')).toHaveValue('75');
    // Nothing to save until the value changes.
    expect(screen.getByRole('button', { name: 'Save headcount' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(setGuestHeadcount).toHaveBeenCalledWith('e1', null);
    expect(onSaved).toHaveBeenCalledWith(event(null));
  });

  it("reports the server's refusal on the field", async () => {
    setGuestHeadcount.mockRejectedValue(new Error('A headcount can be recorded once the event has started'));
    render(<EventGuestHeadcountCard event={event()} onSaved={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('Guests counted'), '10');
    await userEvent.click(screen.getByRole('button', { name: 'Save headcount' }));

    expect(await screen.findByText('A headcount can be recorded once the event has started')).toBeInTheDocument();
  });
});
