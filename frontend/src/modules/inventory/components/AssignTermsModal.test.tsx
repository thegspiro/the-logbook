import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssignTermsModal } from './AssignTermsModal';

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'America/Chicago' }));

describe('AssignTermsModal', () => {
  const onConfirm = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    onConfirm.mockReset();
    onClose.mockReset();
  });

  const renderModal = () =>
    render(<AssignTermsModal isOpen memberName="Pat Lee" itemName="SCBA 14" onClose={onClose} onConfirm={onConfirm} />);

  it('assigns permanently by default with no return date', async () => {
    const user = userEvent.setup();
    renderModal();

    expect(screen.getByRole('radio', { name: 'Permanent' })).toBeChecked();
    expect(screen.queryByLabelText('Return date')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Assign to Pat Lee' }));

    expect(onConfirm).toHaveBeenCalledWith({ assignment_type: 'permanent' });
  });

  it('requires a return date for a temporary assignment and sends it as UTC', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole('radio', { name: 'Temporary' }));
    const submit = screen.getByRole('button', { name: 'Assign to Pat Lee' });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText('Return date'), '2099-10-01T10:00');
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(onConfirm).toHaveBeenCalledWith({
      assignment_type: 'temporary',
      expected_return_date: '2099-10-01T15:00:00.000Z',
    });
  });

  it('describes each choice without folding the hint into its name', () => {
    renderModal();

    expect(screen.getByRole('radio', { name: 'Temporary' })).toHaveAccessibleDescription(
      /Due back on a date you choose/
    );
  });
});
