/**
 * EV-23: a series RSVP that includes training sessions ahead of the member's
 * pipeline phase is answered with a 409 listing every such session. The form
 * confirms once against that list and retries the whole series with override;
 * declining writes nothing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import type React from 'react';

const mockRsvpToSeries = vi.fn();
const mockCreateOrUpdateRSVP = vi.fn();
const mockConfirm = vi.fn();

vi.mock('../services/api', () => ({
  eventService: {
    rsvpToSeries: (...a: unknown[]) => mockRsvpToSeries(...a) as unknown,
    createOrUpdateRSVP: (...a: unknown[]) => mockCreateOrUpdateRSVP(...a) as unknown,
  },
}));

vi.mock('../contexts/ConfirmContext', () => ({
  useConfirm: () => ({ confirm: (...a: unknown[]) => mockConfirm(...a) as unknown }),
}));

vi.mock('./useTimezone', () => ({ useTimezone: () => 'America/Chicago' }));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { useRSVPForm } from './useRSVPForm';
import type { Event } from '../types/event';

const seriesEvent = { id: 'e1', is_recurring: true, recurrence_parent_id: null } as unknown as Event;

const phaseGate409 = {
  response: {
    status: 409,
    data: {
      detail: {
        warning_type: 'phase_gate',
        message: '2 sessions are in this series ahead of your current training phase.',
        occurrences: [
          {
            event_id: 'e2',
            title: 'Live burn',
            start_datetime: '2026-11-09T01:00:00+00:00',
            message: 'This session is part of Phase 3 (Live Fire).',
          },
          {
            event_id: 'e3',
            title: 'RIT',
            start_datetime: '2026-11-16T01:00:00+00:00',
            message: 'This session is part of Phase 4 (RIT).',
          },
        ],
      },
    },
  },
};

const submitSeries = async () => {
  const onSuccess = vi.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() => useRSVPForm({ eventId: 'e1', event: seriesEvent, onSuccess }));
  act(() => result.current.setRsvpApplyToSeries(true));
  await act(async () => {
    await result.current.handleSubmit({ preventDefault: vi.fn() } as unknown as React.FormEvent);
  });
  return { result, onSuccess };
};

describe('useRSVPForm series phase gate (EV-23)', () => {
  beforeEach(() => {
    mockRsvpToSeries.mockReset();
    mockCreateOrUpdateRSVP.mockReset();
    mockConfirm.mockReset();
  });

  it('lists every ahead-of-phase session and retries the series with override once confirmed', async () => {
    mockRsvpToSeries.mockRejectedValueOnce(phaseGate409).mockResolvedValueOnce({ message: 'ok', rsvp_count: 5 });
    mockConfirm.mockResolvedValue(true);

    const { onSuccess } = await submitSeries();

    expect(mockConfirm).toHaveBeenCalledTimes(1);
    const options = mockConfirm.mock.calls[0]?.[0] as { message: React.ReactNode; confirmLabel: string };
    expect(options.confirmLabel).toBe('RSVP to series');
    render(options.message as React.ReactElement);
    expect(screen.getByText('Live burn')).toBeInTheDocument();
    expect(screen.getByText('RIT')).toBeInTheDocument();
    // Shown on the department's clock: 01:00 UTC is 7:00 PM the evening before in Chicago.
    expect(screen.getByText(/November 8, 2026 at 7:00 PM/)).toBeInTheDocument();

    expect(mockRsvpToSeries).toHaveBeenNthCalledWith(1, 'e1', expect.objectContaining({ status: 'going' }));
    expect(mockRsvpToSeries).toHaveBeenNthCalledWith(2, 'e1', expect.objectContaining({ status: 'going' }), true);
    expect(onSuccess).toHaveBeenCalled();
  });

  it('writes nothing more when the member declines', async () => {
    mockRsvpToSeries.mockRejectedValueOnce(phaseGate409);
    mockConfirm.mockResolvedValue(false);

    const { result, onSuccess } = await submitSeries();

    expect(mockRsvpToSeries).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(result.current.submitError).toBeNull();
  });

  it('reports any other series failure as an error without prompting', async () => {
    mockRsvpToSeries.mockRejectedValueOnce({ response: { status: 400, data: { detail: 'Event not found' } } });

    const { result } = await submitSeries();

    expect(mockConfirm).not.toHaveBeenCalled();
    expect(result.current.submitError).toBe('Event not found');
  });
});
