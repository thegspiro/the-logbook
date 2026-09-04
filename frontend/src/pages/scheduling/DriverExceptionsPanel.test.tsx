import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockList = vi.fn();
const mockRequest = vi.fn();
const mockReview = vi.fn();
const mockRevoke = vi.fn();
const mockConfirm = vi.fn();
const mockCheckPermission = vi.fn();

vi.mock('../../modules/apparatus/services/api', () => ({
  driverExceptionService: {
    list: (...a: unknown[]) => mockList(...a) as unknown,
    request: (...a: unknown[]) => mockRequest(...a) as unknown,
    review: (...a: unknown[]) => mockReview(...a) as unknown,
    revoke: (...a: unknown[]) => mockRevoke(...a) as unknown,
  },
}));

vi.mock('../../modules/scheduling/store/schedulingStore', () => ({
  // Honours the selector, as the real store does.
  useSchedulingStore: (selector?: (s: unknown) => unknown) => {
    const state = {
      members: [
        { id: 'u1', label: 'Alice Adams' },
        { id: 'u2', label: 'Bob Brown' },
      ],
      apparatus: [{ id: 'ap1', unit_number: 'E-1', name: 'Engine 1' }],
      loadMembers: vi.fn(),
      loadApparatus: vi.fn(),
      settingsLoaded: true,
      signupClosesMinutesBefore: 0,
      lateSignupGraceMinutes: 60,
      loadSettings: vi.fn(),
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      checkPermission: (p: string) => mockCheckPermission(p) as unknown,
      user: { id: 'chief-1' },
    }),
}));

vi.mock('../../contexts/ConfirmContext', () => ({
  useConfirm: () => ({ confirm: (...a: unknown[]) => mockConfirm(...a) as unknown }),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import DriverExceptionsPanel from './DriverExceptionsPanel';

const exception = (overrides: Record<string, unknown> = {}) => ({
  id: 'exc-1',
  organizationId: 'org-1',
  userId: 'u1',
  userName: 'Alice Adams',
  apparatusId: 'ap1',
  apparatusUnitNumber: 'E-1',
  reason: 'parade',
  justification: 'Life member driving the antique in the Labor Day parade.',
  restrictions: 'Parade route only, no emergency response.',
  validFrom: '2026-09-01',
  validUntil: '2026-09-05',
  status: 'pending',
  requestedBy: 'officer-1',
  requestedByName: 'Sam Officer',
  requestedAt: '2026-08-16T12:00:00Z',
  reviewedBy: null,
  reviewedByName: null,
  reviewedAt: null,
  reviewNotes: null,
  ...overrides,
});

describe('DriverExceptionsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue([exception()]);
    mockRequest.mockResolvedValue(exception());
    mockReview.mockResolvedValue(exception({ status: 'approved' }));
    mockRevoke.mockResolvedValue(exception({ status: 'revoked' }));
    mockConfirm.mockResolvedValue(true);
    mockCheckPermission.mockReturnValue(true);
  });

  it('shows the exception with its restrictions and window', async () => {
    render(<DriverExceptionsPanel />);
    expect(await screen.findByText('Alice Adams')).toBeInTheDocument();
    expect(screen.getByText(/Parade route only/)).toBeInTheDocument();
    expect(screen.getByText(/requested by Sam Officer/)).toBeInTheDocument();
  });

  it('counts what is awaiting a decision', async () => {
    render(<DriverExceptionsPanel />);
    expect(await screen.findByText(/1 awaiting a chief/i)).toBeInTheDocument();
  });

  it('hides approve controls from members without the chief permission', async () => {
    mockCheckPermission.mockReturnValue(false);
    render(<DriverExceptionsPanel />);
    await screen.findByText('Alice Adams');
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deny' })).not.toBeInTheDocument();
  });

  it('confirms before approving, naming the consequence', async () => {
    const user = userEvent.setup();
    render(<DriverExceptionsPanel />);
    await screen.findByText('Alice Adams');

    await user.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() =>
      expect(mockConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringMatching(/without the required EVOC/i) as unknown as string,
          confirmLabel: 'Approve exception',
        })
      )
    );
    await waitFor(() => expect(mockReview).toHaveBeenCalledWith('exc-1', true));
  });

  it('does not approve when the confirmation is declined', async () => {
    const user = userEvent.setup();
    mockConfirm.mockResolvedValue(false);
    render(<DriverExceptionsPanel />);
    await screen.findByText('Alice Adams');

    await user.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() =>
      expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Approve exception' }))
    );
    expect(mockReview).not.toHaveBeenCalled();
  });

  it('denies without a confirmation step', async () => {
    const user = userEvent.setup();
    render(<DriverExceptionsPanel />);
    await screen.findByText('Alice Adams');

    await user.click(screen.getByRole('button', { name: 'Deny' }));

    await waitFor(() => expect(mockReview).toHaveBeenCalledWith('exc-1', false));
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('replaces the approve controls when the reviewer raised the request', async () => {
    // Separation of duties, mirrored in the UI so the button is absent rather
    // than present-and-failing.
    mockList.mockResolvedValue([exception({ requestedBy: 'chief-1' })]);
    render(<DriverExceptionsPanel />);
    await screen.findByText('Alice Adams');

    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.getByText(/You raised this request/i)).toBeInTheDocument();
  });

  it('replaces the approve controls when the reviewer is the beneficiary', async () => {
    mockList.mockResolvedValue([exception({ userId: 'chief-1', requestedBy: 'officer-1' })]);
    render(<DriverExceptionsPanel />);
    await screen.findByText('Alice Adams');

    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.getByText(/cannot approve your own exception/i)).toBeInTheDocument();
  });

  it('offers revocation only on approved exceptions', async () => {
    mockList.mockResolvedValue([exception({ status: 'approved' })]);
    render(<DriverExceptionsPanel />);
    await screen.findByText('Alice Adams');

    expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('confirms before revoking', async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValue([exception({ status: 'approved' })]);
    render(<DriverExceptionsPanel />);
    await screen.findByText('Alice Adams');

    await user.click(screen.getByRole('button', { name: 'Revoke' }));

    await waitFor(() => expect(mockRevoke).toHaveBeenCalledWith('exc-1'));
  });

  it('omits blank optional fields from a request', async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValue([]);
    render(<DriverExceptionsPanel />);
    await screen.findByText(/No driver exceptions/i);

    await user.click(screen.getByRole('button', { name: /request exception/i }));
    await user.selectOptions(screen.getByLabelText('Member'), 'u1');
    await user.type(screen.getByLabelText('Justification'), 'Labor Day parade.');
    await user.click(screen.getByRole('button', { name: /submit request/i }));

    // Blanks omitted rather than sent as '' — a Pydantic validator would
    // reject the empty string with a 422.
    await waitFor(() =>
      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          apparatusId: undefined,
          reason: 'parade',
          justification: 'Labor Day parade.',
          restrictions: undefined,
        })
      )
    );
  });

  it('will not submit a request with no member or justification', async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValue([]);
    render(<DriverExceptionsPanel />);
    await screen.findByText(/No driver exceptions/i);

    await user.click(screen.getByRole('button', { name: /request exception/i }));
    await user.click(screen.getByRole('button', { name: /submit request/i }));

    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('refetches with expired records when asked', async () => {
    const user = userEvent.setup();
    render(<DriverExceptionsPanel />);
    await screen.findByText('Alice Adams');

    await user.click(screen.getByLabelText(/include expired/i));

    await waitFor(() => expect(mockList).toHaveBeenCalledWith({ includeExpired: true }));
  });
});
