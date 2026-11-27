/**
 * Money raised and attendance are moved on the server by each Zeffy payment
 * the sync applies. Editing an event's name must not write back the totals
 * the dialog loaded, which would erase payments synced since; a total the
 * officer did change is still sent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider } from '@/contexts/ConfirmContext';
import type { FundraisingEvent } from '../types';

const updateFundraisingEvent = vi.fn();
vi.mock('../services/api', () => ({
  fundraisingService: {
    createFundraisingEvent: vi.fn(),
    updateFundraisingEvent: (...args: unknown[]) => updateFundraisingEvent(...args) as unknown,
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

import { FundraisingEventDialog } from './FundraisingEventDialog';

const gala: FundraisingEvent = {
  id: 'ev-1',
  organizationId: 'org-1',
  campaignId: null,
  eventId: null,
  name: 'Pancake Breakfast',
  description: null,
  eventType: 'dinner',
  eventDate: '2027-03-06T13:00:00Z',
  location: null,
  ticketPrice: null,
  maxAttendees: null,
  currentAttendees: 12,
  revenueGoal: null,
  actualRevenue: '100.00',
  expenses: '25.00',
  status: 'planning',
  registrationUrl: null,
  sponsors: null,
  notes: null,
  createdBy: null,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
};

const renderDialog = () =>
  render(<FundraisingEventDialog event={gala} campaigns={[]} onClose={vi.fn()} onSaved={vi.fn()} />, {
    wrapper: ConfirmProvider,
  });

describe('FundraisingEventDialog totals on edit', () => {
  beforeEach(() => {
    updateFundraisingEvent.mockReset();
    updateFundraisingEvent.mockResolvedValue({});
  });

  it('does not send the loaded totals when only the name changes', async () => {
    const user = userEvent.setup();
    renderDialog();
    const name = screen.getByLabelText(/^Name/);
    await user.clear(name);
    await user.type(name, 'Spring Pancake Breakfast');
    await user.click(screen.getByRole('button', { name: 'Save event' }));

    await waitFor(() => expect(updateFundraisingEvent).toHaveBeenCalledTimes(1));
    const payload = updateFundraisingEvent.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.name).toBe('Spring Pancake Breakfast');
    expect(payload).not.toHaveProperty('actualRevenue');
    expect(payload).not.toHaveProperty('expenses');
    expect(payload).not.toHaveProperty('currentAttendees');
  });

  it('sends a total the officer changed', async () => {
    const user = userEvent.setup();
    renderDialog();
    const raised = screen.getByLabelText(/^Money raised/);
    await user.clear(raised);
    await user.type(raised, '150');
    await user.click(screen.getByRole('button', { name: 'Save event' }));

    await waitFor(() => expect(updateFundraisingEvent).toHaveBeenCalledTimes(1));
    const payload = updateFundraisingEvent.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.actualRevenue).toBe('150');
    expect(payload).not.toHaveProperty('currentAttendees');
  });
});
