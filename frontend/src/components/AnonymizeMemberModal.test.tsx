import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockAnonymizeMember = vi.fn();
vi.mock('../services/api', () => ({
  memberStatusService: {
    anonymizeMember: (...args: unknown[]) => mockAnonymizeMember(...args) as unknown,
  },
}));

const mockToastSuccess = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: { success: (...args: unknown[]) => mockToastSuccess(...args) as unknown, error: vi.fn() },
}));

// Import AFTER mocks
import { AnonymizeMemberModal } from './AnonymizeMemberModal';

const MEMBER = { id: 'u9', name: 'Pat Departed' };

describe('AnonymizeMemberModal', () => {
  const onClose = vi.fn();
  const onAnonymized = vi.fn();

  beforeEach(() => {
    mockAnonymizeMember.mockReset();
    mockAnonymizeMember.mockResolvedValue({ user_id: 'u9', anonymized_at: '2026-09-25T12:00:00Z' });
    mockToastSuccess.mockReset();
    onClose.mockReset();
    onAnonymized.mockReset();
    onAnonymized.mockResolvedValue(undefined);
  });

  function renderModal(isOpen = true) {
    return render(
      <AnonymizeMemberModal isOpen={isOpen} onClose={onClose} member={MEMBER} onAnonymized={onAnonymized} />
    );
  }

  const confirmField = () => screen.getByLabelText(/to confirm/);
  const anonymizeButton = () => screen.getByRole('button', { name: 'Anonymize' });

  it('says the action is permanent and what it keeps', () => {
    renderModal();

    expect(screen.getByRole('heading', { name: 'Anonymize Member' })).toBeInTheDocument();
    expect(screen.getByText('It cannot be undone')).toBeInTheDocument();
    expect(screen.getByText('Training, attendance and hours')).toBeInTheDocument();
  });

  it('stays disabled until the member name is typed', async () => {
    const user = userEvent.setup();
    renderModal();

    expect(anonymizeButton()).toBeDisabled();
    await user.type(confirmField(), 'Pat');
    expect(anonymizeButton()).toBeDisabled();
    await user.click(anonymizeButton());

    expect(mockAnonymizeMember).not.toHaveBeenCalled();
  });

  it('anonymizes once the name matches, ignoring case and spacing', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(confirmField(), '  pat departed ');
    await user.click(anonymizeButton());

    await waitFor(() => expect(onAnonymized).toHaveBeenCalled());
    expect(mockAnonymizeMember).toHaveBeenCalledWith('u9');
    expect(onClose).toHaveBeenCalled();
    expect(mockToastSuccess).toHaveBeenCalledWith("Pat Departed's personal information has been removed");
  });

  it('keeps the dialog open and shows the refusal', async () => {
    const user = userEvent.setup();
    mockAnonymizeMember.mockRejectedValue(new Error('Only departed members can be anonymized.'));
    renderModal();

    await user.type(confirmField(), 'Pat Departed');
    await user.click(anonymizeButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('Only departed members can be anonymized.');
    expect(onClose).not.toHaveBeenCalled();
    expect(onAnonymized).not.toHaveBeenCalled();
  });

  it('closes without calling the backend on "Keep their details"', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole('button', { name: 'Keep their details' }));

    expect(onClose).toHaveBeenCalled();
    expect(mockAnonymizeMember).not.toHaveBeenCalled();
  });

  it('clears a name typed for a previous open', async () => {
    const user = userEvent.setup();
    const { rerender } = renderModal();
    await user.type(confirmField(), 'Pat Departed');

    rerender(<AnonymizeMemberModal isOpen={false} onClose={onClose} member={MEMBER} onAnonymized={onAnonymized} />);
    rerender(<AnonymizeMemberModal isOpen onClose={onClose} member={MEMBER} onAnonymized={onAnonymized} />);

    expect(confirmField()).toHaveValue('');
    expect(anonymizeButton()).toBeDisabled();
  });
});
