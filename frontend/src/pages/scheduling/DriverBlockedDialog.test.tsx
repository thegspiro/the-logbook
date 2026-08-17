import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockApprovers = vi.fn();
const mockRequest = vi.fn();
const mockCheckPermission = vi.fn();

vi.mock('../../modules/apparatus/services/api', () => ({
  driverExceptionService: {
    approvers: (...a: unknown[]) => mockApprovers(...a) as unknown,
    request: (...a: unknown[]) => mockRequest(...a) as unknown,
  },
}));

vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ checkPermission: (p: string) => mockCheckPermission(p) as unknown }),
}));

vi.mock('../../hooks/useRanks', () => ({
  useRanks: () => ({
    ranks: [
      { rank_code: 'fire_chief', display_name: 'Fire Chief' },
      { rank_code: 'deputy_chief', display_name: 'Deputy Chief' },
    ],
    loading: false,
  }),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import { DriverBlockedDialog } from './DriverBlockedDialog';

const renderDialog = (overrides: Record<string, unknown> = {}) =>
  render(
    <DriverBlockedDialog
      isOpen
      onClose={vi.fn()}
      userId="u1"
      userName="Alice Adams"
      apparatusId="ap1"
      apparatusUnitNumber="E-1"
      shiftDate="2026-09-04"
      blockedReason="This apparatus requires EVOC Level 3 (Engine). This member has no EVOC certification."
      {...overrides}
    />
  );

describe('DriverBlockedDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApprovers.mockResolvedValue([
      { userId: 'c1', userName: 'Dana Chief', rank: 'fire_chief' },
      { userId: 'c2', userName: 'Rio Deputy', rank: 'deputy_chief' },
    ]);
    mockRequest.mockResolvedValue({ id: 'exc-1' });
    mockCheckPermission.mockReturnValue(true);
  });

  it('states who was refused, from which apparatus, and why', async () => {
    renderDialog();
    expect(await screen.findByText(/Alice Adams was not assigned as driver of E-1/)).toBeInTheDocument();
    expect(screen.getByText(/requires EVOC Level 3/)).toBeInTheDocument();
  });

  it('names the people who can approve, with their ranks', async () => {
    renderDialog();
    expect(await screen.findByText('Dana Chief')).toBeInTheDocument();
    expect(screen.getByText('Rio Deputy')).toBeInTheDocument();
    // Rank codes are resolved to the department's own display names.
    expect(screen.getByText(/Fire Chief/)).toBeInTheDocument();
    expect(screen.getByText(/Deputy Chief/)).toBeInTheDocument();
  });

  it('says so when nobody holds the approval permission', async () => {
    // Otherwise the officer waits on an approval that can never arrive.
    mockApprovers.mockResolvedValue([]);
    renderDialog();
    expect(await screen.findByText(/Nobody currently holds the approval permission/i)).toBeInTheDocument();
  });

  it('still shows the block when the approver lookup fails', async () => {
    mockApprovers.mockRejectedValue(new Error('network'));
    renderDialog();
    expect(await screen.findByText(/requires EVOC Level 3/)).toBeInTheDocument();
  });

  it('offers the request form to someone who can raise one', async () => {
    renderDialog();
    expect(await screen.findByRole('button', { name: /request an exception/i })).toBeInTheDocument();
  });

  it('tells a member without the permission who to ask instead', async () => {
    mockCheckPermission.mockReturnValue(false);
    renderDialog();
    await screen.findByText('Dana Chief');
    expect(screen.queryByRole('button', { name: /request an exception/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Ask one of the people above/i)).toBeInTheDocument();
  });

  it('scopes the request to the shift, prefilled from it', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(await screen.findByRole('button', { name: /request an exception/i }));
    await user.type(screen.getByLabelText('Justification'), 'Labor Day parade.');
    await user.click(screen.getByRole('button', { name: /submit request/i }));

    // The narrowest grant that solves the problem in front of the officer:
    // this member, this unit, this day.
    await waitFor(() =>
      expect(mockRequest).toHaveBeenCalledWith({
        userId: 'u1',
        apparatusId: 'ap1',
        reason: 'parade',
        justification: 'Labor Day parade.',
        restrictions: undefined,
        validFrom: '2026-09-04',
        validUntil: '2026-09-04',
      })
    );
  });

  it('will not submit without a justification', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(await screen.findByRole('button', { name: /request an exception/i }));
    await user.click(screen.getByRole('button', { name: /submit request/i }));

    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('makes clear the request does not unblock the shift by itself', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(await screen.findByRole('button', { name: /request an exception/i }));

    expect(screen.getByText(/stays off this shift as driver until the exception is approved/i)).toBeInTheDocument();
    expect(screen.getByText(/grants nothing until a chief other than you approves it/i)).toBeInTheDocument();
  });

  it('omits the apparatus when the shift has none', async () => {
    const user = userEvent.setup();
    renderDialog({ apparatusId: undefined, apparatusUnitNumber: undefined });
    await user.click(await screen.findByRole('button', { name: /request an exception/i }));
    await user.type(screen.getByLabelText('Justification'), 'Covering the parade.');
    await user.click(screen.getByRole('button', { name: /submit request/i }));

    await waitFor(() => expect(mockRequest).toHaveBeenCalledWith(expect.objectContaining({ apparatusId: undefined })));
  });

  it('closes after a successful request', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderDialog({ onClose });
    await user.click(await screen.findByRole('button', { name: /request an exception/i }));
    await user.type(screen.getByLabelText('Justification'), 'Labor Day parade.');
    await user.click(screen.getByRole('button', { name: /submit request/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalledWith());
  });
});
