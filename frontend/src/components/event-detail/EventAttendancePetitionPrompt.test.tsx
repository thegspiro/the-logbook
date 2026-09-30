import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import EventAttendancePetitionPrompt from './EventAttendancePetitionPrompt';
import type { AttendancePetition } from '../../types/event';

const mockGetMine = vi.fn();
const mockSubmit = vi.fn();
vi.mock('../../services/api', () => ({
  eventService: {
    getMyAttendancePetition: (...args: unknown[]) => mockGetMine(...args) as unknown,
    submitAttendancePetition: (...args: unknown[]) => mockSubmit(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const petition = (over: Partial<AttendancePetition> = {}): AttendancePetition => ({
  id: 'pet-1',
  event_id: 'evt-1',
  user_id: 'user-1',
  status: 'pending',
  reason: 'Phone died',
  created_at: '2026-09-29T20:00:00Z',
  ...over,
});

const render = () => renderWithRouter(<EventAttendancePetitionPrompt eventId="evt-1" timezone="UTC" />);

describe('EventAttendancePetitionPrompt', () => {
  beforeEach(() => {
    mockGetMine.mockReset();
    mockSubmit.mockReset();
    mockGetMine.mockResolvedValue({ petition: null, can_request: false, unavailable_reason: 'Already present' });
  });

  it('offers nothing when the server says a request would be refused', async () => {
    const { container } = render();

    await vi.waitFor(() => expect(mockGetMine).toHaveBeenCalledWith('evt-1'));
    expect(screen.queryByRole('button', { name: /I was there/ })).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('sends the reason and shows the request as pending', async () => {
    mockGetMine.mockResolvedValue({ petition: null, can_request: true });
    mockSubmit.mockResolvedValue(petition());
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByRole('button', { name: /I was there/ }));
    await user.type(screen.getByLabelText('Why is there no check-in?'), '  Phone died  ');
    await user.click(screen.getByRole('button', { name: 'Send request' }));

    expect(mockSubmit).toHaveBeenCalledWith('evt-1', {
      reason: 'Phone died',
      requested_check_in_at: undefined,
      requested_check_out_at: undefined,
    });
    expect(await screen.findByText(/You asked to be marked present/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /I was there/ })).not.toBeInTheDocument();
  });

  it('keeps the form open with the server’s refusal', async () => {
    mockGetMine.mockResolvedValue({ petition: null, can_request: true });
    mockSubmit.mockRejectedValue({ response: { status: 400, data: { detail: 'Too late to ask' } } });
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByRole('button', { name: /I was there/ }));
    await user.type(screen.getByLabelText('Why is there no check-in?'), 'Phone died');
    await user.click(screen.getByRole('button', { name: 'Send request' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Too late to ask');
  });

  it('tells the member why a request was declined', async () => {
    mockGetMine.mockResolvedValue({
      petition: petition({ status: 'rejected', reviewed_by_name: 'Olive Member', review_note: 'Not on the sheet' }),
      can_request: false,
    });
    render();

    expect(await screen.findByText(/was not approved by Olive Member/)).toBeInTheDocument();
    expect(screen.getByText('Reason: Not on the sheet')).toBeInTheDocument();
  });

  it('confirms an approved request', async () => {
    mockGetMine.mockResolvedValue({
      petition: petition({ status: 'approved', reviewed_by_name: 'Olive Member' }),
      can_request: false,
    });
    render();

    expect(await screen.findByText('Your attendance was confirmed by Olive Member.')).toBeInTheDocument();
  });
});
