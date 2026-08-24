const mockWithdraw = vi.fn();
const mockCreateSwap = vi.fn();
const mockTradeCandidates = vi.fn();
const mockStandingClaim = vi.fn();
const mockEndStanding = vi.fn();

vi.mock('../../../modules/scheduling', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../../modules/scheduling');
  return {
    ...actual,
    schedulingService: {
      withdrawSignup: (...args: unknown[]) => mockWithdraw(...args) as unknown,
      createSwapRequest: (...args: unknown[]) => mockCreateSwap(...args) as unknown,
      getTradeCandidates: (...args: unknown[]) => mockTradeCandidates(...args) as unknown,
      getStandingClaimForShift: (...args: unknown[]) => mockStandingClaim(...args) as unknown,
      endStandingShift: (...args: unknown[]) => mockEndStanding(...args) as unknown,
    },
  };
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ShiftRecord } from '../../../modules/scheduling';
import GiveUpShiftModal from './GiveUpShiftModal';

const ME = 'me-1';

const SHIFT: ShiftRecord = {
  id: 's1',
  organization_id: 'org',
  shift_date: '2026-08-27',
  start_time: '2026-08-27T22:00:00Z',
  end_time: '2026-08-28T10:00:00Z',
  apparatus_unit_number: 'Engine 101',
  positions: [
    { position: 'officer', required: true },
    { position: 'driver', required: true },
    { position: 'firefighter', required: true },
    { position: 'firefighter', required: true },
  ],
  attendee_count: 3,
  call_count: 0,
  is_finalized: false,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
  roster: [
    { assignment_id: 'a1', user_id: ME, user_name: 'You', position: 'driver', status: 'assigned' },
    { assignment_id: 'a2', user_id: 'u2', user_name: 'Dana Ruiz', position: 'officer', status: 'assigned' },
    { assignment_id: 'a3', user_id: 'u3', user_name: 'Casey Lee', position: 'firefighter', status: 'assigned' },
  ],
};

const onClose = vi.fn();
const onChanged = vi.fn();

const renderModal = () =>
  render(
    <GiveUpShiftModal
      shift={SHIFT}
      currentUserId={ME}
      timezone="America/New_York"
      onClose={onClose}
      onChanged={onChanged}
    />
  );

beforeEach(() => {
  vi.clearAllMocks();
  mockWithdraw.mockResolvedValue(undefined);
  mockCreateSwap.mockResolvedValue({ id: 'sw1' });
  mockTradeCandidates.mockResolvedValue([
    { user_id: 'u9', user_name: 'T. Nguyen', position: 'driver', shifts_this_month: 6, owes_trade: false },
    { user_id: 'u8', user_name: 'R. Okafor', position: 'driver', shifts_this_month: 2, owes_trade: true },
  ]);
  mockStandingClaim.mockResolvedValue(null);
  mockEndStanding.mockResolvedValue({ released: 3 });
});

describe('GiveUpShiftModal', () => {
  it('asks which way out before doing anything', () => {
    renderModal();
    expect(screen.getByText(/release it to the open list/i)).toBeInTheDocument();
    expect(screen.getByText(/offer it to someone specific/i)).toBeInTheDocument();
    expect(mockWithdraw).not.toHaveBeenCalled();
  });

  it('spells out what releasing costs the crew', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole('button', { name: /continue/i }));
    // Three on the roster now, so two after this member leaves.
    expect(await screen.findByText(/drops the crew to 2 of 4/i)).toBeInTheDocument();
  });

  it('releases the seat only after the confirm step', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.click(screen.getByRole('button', { name: /release shift/i }));
    await waitFor(() => expect(mockWithdraw).toHaveBeenCalledWith('s1'));
    expect(onChanged).toHaveBeenCalled();
    expect(await screen.findByText(/you're off the/i)).toBeInTheDocument();
  });

  it('does not offer to end a series when the shift belongs to none', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await screen.findByText(/drops the crew/i);
    expect(screen.queryByLabelText(/standing series/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/rest of this standing series/i)).not.toBeInTheDocument();
  });

  it('offers to end the series when there is one, and leaves it unticked', async () => {
    mockStandingClaim.mockResolvedValue({ id: 'claim-1', is_active: true });
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole('button', { name: /continue/i }));
    const checkbox = await screen.findByRole('checkbox');
    // Ending a series and emptying seats already on the roster are separate
    // decisions, so the default must not do the second one.
    expect(checkbox).not.toBeChecked();

    await user.click(screen.getByRole('button', { name: /release shift/i }));
    await waitFor(() => expect(mockWithdraw).toHaveBeenCalledWith('s1'));
    expect(mockEndStanding).not.toHaveBeenCalled();
  });

  it('ends the series and its future dates when the member asks', async () => {
    mockStandingClaim.mockResolvedValue({ id: 'claim-1', is_active: true });
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.click(await screen.findByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /release shift/i }));
    await waitFor(() => expect(mockEndStanding).toHaveBeenCalledWith('claim-1', true));
  });

  it('lists who could cover, and will not send until one is picked', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByText(/offer it to someone specific/i));
    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByText('T. Nguyen')).toBeInTheDocument();
    expect(screen.getByText('Owes you a trade')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pick someone to cover/i })).toBeDisabled();
  });

  it('sends the offer to the member picked', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByText(/offer it to someone specific/i));
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.click(await screen.findByRole('button', { name: /T\. Nguyen/ }));
    await user.click(screen.getByRole('button', { name: /send offer to T\. Nguyen/i }));

    await waitFor(() => expect(mockCreateSwap).toHaveBeenCalledWith({ offering_shift_id: 's1', target_user_id: 'u9' }));
    expect(await screen.findByText(/offer sent to T\. Nguyen/i)).toBeInTheDocument();
  });

  it('points at the open list when nobody qualified is free', async () => {
    mockTradeCandidates.mockResolvedValue([]);
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByText(/offer it to someone specific/i));
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(await screen.findByText(/nobody qualified is free/i)).toBeInTheDocument();
  });

  it('keeps the member on the roster when the release fails', async () => {
    mockWithdraw.mockRejectedValue(new Error('nope'));
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.click(screen.getByRole('button', { name: /release shift/i }));
    await waitFor(() => expect(mockWithdraw).toHaveBeenCalledWith('s1'));
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.queryByText(/you're off the/i)).not.toBeInTheDocument();
  });
});

describe('GiveUpShiftModal — opened from "Offer trade"', () => {
  it('lands on the trade branch instead of asking again', async () => {
    const user = userEvent.setup();
    render(
      <GiveUpShiftModal
        shift={SHIFT}
        initialChoice="trade"
        currentUserId={ME}
        timezone="America/New_York"
        onClose={onClose}
        onChanged={onChanged}
      />
    );
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(await screen.findByText('T. Nguyen')).toBeInTheDocument();
  });
});
