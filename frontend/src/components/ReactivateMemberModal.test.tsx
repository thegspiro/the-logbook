import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockReactivateMember = vi.fn();
vi.mock('../services/api', () => ({
  memberStatusService: {
    reactivateMember: (...args: unknown[]) => mockReactivateMember(...args) as unknown,
  },
}));

const mockToastSuccess = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: { success: (...args: unknown[]) => mockToastSuccess(...args) as unknown, error: vi.fn() },
}));

// Import AFTER mocks
import { ReactivateMemberModal } from './ReactivateMemberModal';

const MEMBER = { id: 'u9', name: 'Pat Returner' };

describe('ReactivateMemberModal', () => {
  const onClose = vi.fn();
  const onReactivated = vi.fn();

  beforeEach(() => {
    mockReactivateMember.mockReset();
    mockReactivateMember.mockResolvedValue({ user_id: 'u9', new_status: 'active' });
    mockToastSuccess.mockReset();
    onClose.mockReset();
    onReactivated.mockReset();
    onReactivated.mockResolvedValue(undefined);
  });

  function renderModal(isOpen = true) {
    return render(
      <ReactivateMemberModal isOpen={isOpen} onClose={onClose} member={MEMBER} onReactivated={onReactivated} />
    );
  }

  it('names the member and the status they return to', () => {
    renderModal();

    expect(screen.getByRole('heading', { name: 'Reactivate Member' })).toBeInTheDocument();
    expect(screen.getByText('Pat Returner')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('sends the trimmed reason, refreshes the caller, then closes', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText(/Reason/), '  Returned from relocation  ');
    await user.click(screen.getByRole('button', { name: 'Reactivate' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockReactivateMember).toHaveBeenCalledWith('u9', { reason: 'Returned from relocation' });
    expect(onReactivated).toHaveBeenCalled();
    expect(mockToastSuccess).toHaveBeenCalledWith('Pat Returner has been reactivated');
  });

  it('omits a blank reason rather than sending an empty string', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText(/Reason/), '   ');
    await user.click(screen.getByRole('button', { name: 'Reactivate' }));

    await waitFor(() => expect(mockReactivateMember).toHaveBeenCalledWith('u9', { reason: undefined }));
  });

  it('keeps the dialog open and shows the error when the backend refuses', async () => {
    const user = userEvent.setup();
    mockReactivateMember.mockRejectedValue(new Error('Only archived members can be reactivated.'));
    renderModal();

    await user.click(screen.getByRole('button', { name: 'Reactivate' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Only archived members can be reactivated.');
    expect(onClose).not.toHaveBeenCalled();
    expect(onReactivated).not.toHaveBeenCalled();
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it('closes without calling the backend on "Keep archived"', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole('button', { name: 'Keep archived' }));

    expect(onClose).toHaveBeenCalled();
    expect(mockReactivateMember).not.toHaveBeenCalled();
  });

  it('clears a reason typed for a previous open', async () => {
    const user = userEvent.setup();
    const { rerender } = renderModal();
    await user.type(screen.getByLabelText(/Reason/), 'stale reason');

    rerender(<ReactivateMemberModal isOpen={false} onClose={onClose} member={MEMBER} onReactivated={onReactivated} />);
    rerender(<ReactivateMemberModal isOpen onClose={onClose} member={MEMBER} onReactivated={onReactivated} />);

    expect(screen.getByLabelText(/Reason/)).toHaveValue('');
  });
});
