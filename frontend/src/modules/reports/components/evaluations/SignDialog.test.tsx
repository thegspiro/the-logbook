import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../../test/utils';
import { SignDialog } from './SignDialog';
import type { SigningOption } from '../../types/evaluations';

const option: SigningOption = { step_key: 'member', label: 'Member acknowledgement', dispositions: ['acknowledged'] };

describe('evaluation SignDialog', () => {
  const onClose = vi.fn();
  const onSign = vi.fn();

  beforeEach(() => {
    onClose.mockReset();
    onSign.mockReset();
    onSign.mockResolvedValue(undefined);
  });

  const open = () =>
    renderWithRouter(
      <SignDialog option={option} signerName="Pat Member" busy={false} onClose={onClose} onSign={onSign} />
    );

  it('puts a 422 the page rethrows on its field and announces it', async () => {
    onSign.mockRejectedValueOnce({
      response: {
        status: 422,
        data: { detail: [{ field: 'signed_name', message: 'String should have at most 200 characters' }] },
      },
    });
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText(/^Type your full name to sign/), 'Pat Member');
    await user.click(screen.getByRole('checkbox', { name: /intend this typed name/ }));
    await user.click(screen.getByRole('button', { name: 'Acknowledge receipt' }));

    const name = screen.getByLabelText(/^Type your full name to sign/);
    await waitFor(() =>
      expect(name).toHaveAccessibleDescription('Your full name is too long — keep it to 200 characters.')
    );
    expect(name).toHaveAttribute('aria-invalid', 'true');
  });

  it('asks before Cancel throws a typed name away', async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText(/^Type your full name to sign/), 'Pat Member');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^Type your full name to sign/)).toHaveValue('Pat Member');
  });
});
