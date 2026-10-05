import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemberIdScannerModal } from './MemberIdScannerModal';

// Mock html5-qrcode
const mockStart = vi.fn().mockResolvedValue(undefined);
const mockStop = vi.fn().mockResolvedValue(undefined);
const mockGetCameras = vi.fn().mockResolvedValue([{ id: 'cam-1', label: 'Front Camera' }]);
vi.mock('html5-qrcode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('html5-qrcode')>();
  return {
    ...actual,
    Html5Qrcode: Object.assign(
      vi.fn().mockImplementation(function () {
        return { start: mockStart, stop: mockStop };
      }),
      { getCameras: (...args: unknown[]) => mockGetCameras(...args) as unknown }
    ),
  };
});

// Mock the API module
const mockResolve = vi.fn();
vi.mock('../services/memberBadgeService', () => ({
  memberBadgeService: {
    resolve: (...args: unknown[]) => mockResolve(...args) as unknown,
  },
}));

// The card tap has its own tests (MemberCardTap.test.tsx); here only the
// modal's wiring to it is checked.
vi.mock('./MemberCardTap', () => ({
  MemberCardTap: ({
    onMemberIdentified,
  }: {
    onMemberIdentified: (m: { userId: string; memberName: string }) => void;
  }) => (
    <button type="button" onClick={() => onMemberIdentified({ userId: 'u-7', memberName: 'Dana Reyes' })}>
      Card tapped
    </button>
  ),
}));

describe('MemberIdScannerModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onMemberIdentified: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCameras.mockResolvedValue([{ id: 'cam-1', label: 'Front Camera' }]);
    mockResolve.mockReset();
    mockResolve.mockResolvedValue(null);
  });

  it('should not render when closed', () => {
    render(
      <MemberIdScannerModal
        isOpen={false}
        onClose={defaultProps.onClose}
        onMemberIdentified={defaultProps.onMemberIdentified}
      />
    );

    expect(screen.queryByText('Scan Member ID')).not.toBeInTheDocument();
  });

  it('should render the modal title when open', () => {
    render(<MemberIdScannerModal {...defaultProps} />);

    expect(screen.getByText('Scan Member ID')).toBeInTheDocument();
  });

  it('should show the scanner viewport', () => {
    render(<MemberIdScannerModal {...defaultProps} />);

    expect(screen.getByTestId('member-scanner-viewport')).toBeInTheDocument();
  });

  it('should display instruction text', () => {
    render(<MemberIdScannerModal {...defaultProps} />);

    expect(screen.getByText(/Point the camera at a member/)).toBeInTheDocument();
  });

  it('should have a close button', () => {
    render(<MemberIdScannerModal {...defaultProps} />);

    expect(screen.getByRole('button', { name: /close scanner/i })).toBeInTheDocument();
  });

  it('should call onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    render(<MemberIdScannerModal {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: /close scanner/i }));

    expect(defaultProps.onClose).toHaveBeenCalledWith();
  });

  it('should auto-start the scanner when opened', async () => {
    render(<MemberIdScannerModal {...defaultProps} />);

    await waitFor(() => {
      expect(mockGetCameras).toHaveBeenCalledWith();
    });
    await waitFor(() => {
      expect(mockStart).toHaveBeenCalledWith(
        { facingMode: { ideal: 'environment' } },
        expect.any(Object),
        expect.any(Function),
        expect.any(Function)
      );
    });
  });

  it('should prefer back camera when available', async () => {
    mockGetCameras.mockResolvedValue([
      { id: 'cam-front', label: 'Front Camera' },
      { id: 'cam-back', label: 'Back Camera' },
    ]);

    render(<MemberIdScannerModal {...defaultProps} />);

    await waitFor(() => {
      expect(mockStart).toHaveBeenCalledWith(
        'cam-back',
        expect.any(Object),
        expect.any(Function),
        expect.any(Function)
      );
    });
  });

  it('should show error when no cameras are found', async () => {
    mockGetCameras.mockResolvedValue([]);

    render(<MemberIdScannerModal {...defaultProps} />);

    await waitFor(() => {
      // The user-facing wording, not the thrown message: the point of
      // `describeCameraError` is that the browser's own text never
      // reaches the screen.
      expect(screen.getByText(/No camera was found on this device/i)).toBeInTheDocument();
    });
  });

  it('releases the camera when the modal closes during startup', async () => {
    let finishStart: (() => void) | undefined;
    mockStart.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishStart = resolve;
        })
    );

    const { rerender } = render(<MemberIdScannerModal {...defaultProps} />);
    await waitFor(() =>
      expect(mockStart).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), expect.anything())
    );

    rerender(<MemberIdScannerModal {...defaultProps} isOpen={false} />);
    finishStart?.();

    await waitFor(() => expect(mockStop).toHaveBeenCalledWith());
    expect(screen.queryByText('Scan Member ID')).not.toBeInTheDocument();
  });

  it('hands a member identified by an ID card tap to the caller', async () => {
    const user = userEvent.setup();
    const onMemberIdentified = vi.fn();
    render(<MemberIdScannerModal {...defaultProps} onMemberIdentified={onMemberIdentified} />);
    await user.click(screen.getByRole('button', { name: 'Card tapped' }));
    expect(onMemberIdentified).toHaveBeenCalledWith({ userId: 'u-7', memberName: 'Dana Reyes' });
  });
  async function scan(value: string, onMemberIdentified = vi.fn()) {
    render(<MemberIdScannerModal {...defaultProps} onMemberIdentified={onMemberIdentified} />);
    await waitFor(() => expect(mockStart).toHaveBeenCalled());
    const onSuccess = mockStart.mock.calls[0]?.[2] as ((text: string) => void) | undefined;
    onSuccess?.(value);
    return onMemberIdentified;
  }

  it('hands over the member the server resolves the badge to', async () => {
    mockResolve.mockResolvedValue({
      user_id: 'user-1',
      name: 'John Smith',
      membership_number: 'M-001',
      is_active: true,
      matched: 'badge_code',
    });

    const onMemberIdentified = await scan('MB-23456789AB');

    await waitFor(() =>
      expect(onMemberIdentified).toHaveBeenCalledWith({ userId: 'user-1', memberName: 'John Smith' })
    );
    expect(mockResolve).toHaveBeenCalledWith('MB-23456789AB');
  });

  it('never hands over an id from a QR the server does not recognise', async () => {
    // The modal used to pass an unmatched QR's id straight to the caller,
    // which then issued gear against it.
    const onMemberIdentified = await scan(JSON.stringify({ type: 'member_id', id: 'forged-id' }));

    expect(await screen.findByText(/No member found/)).toBeInTheDocument();
    expect(onMemberIdentified).not.toHaveBeenCalled();
  });

  it('refuses a member who is not active', async () => {
    mockResolve.mockResolvedValue({
      user_id: 'user-9',
      name: 'Pat Former',
      membership_number: null,
      is_active: false,
      matched: 'legacy',
    });

    const onMemberIdentified = await scan('M-009');

    expect(await screen.findByText('Pat Former is not an active member')).toBeInTheDocument();
    expect(onMemberIdentified).not.toHaveBeenCalled();
  });
});
