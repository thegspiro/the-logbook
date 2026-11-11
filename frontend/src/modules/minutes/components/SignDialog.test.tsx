import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockSign = vi.fn();

vi.mock('../services/api', () => ({
  minutesService: { sign: (...a: unknown[]) => mockSign(...a) as unknown },
}));

import { renderWithRouter } from '../../../test/utils';
import { SignDialog } from './SignDialog';

describe('SignDialog', () => {
  const onClose = vi.fn();
  const onSigned = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockSign.mockReset();
    mockSign.mockResolvedValue({});
    onSigned.mockReset();
    onSigned.mockResolvedValue(undefined);
  });

  const open = () =>
    renderWithRouter(
      <SignDialog
        isOpen
        minutesId="m1"
        minutesTitle="October business meeting"
        slotKey="recording_secretary"
        slotTitle="Recording Secretary"
        onClose={onClose}
        onSigned={onSigned}
      />
    );

  it('says what is being attested and in which slot', () => {
    open();
    expect(screen.getByRole('heading', { name: 'Sign as Recording Secretary' })).toBeInTheDocument();
    expect(screen.getByText('October business meeting')).toBeInTheDocument();
    expect(screen.getByText(/signed again/)).toBeInTheDocument();
  });

  it('will not sign without both a name and a password, and says so on each field', async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText(/^Type your full name/), 'Pat Chief');
    await user.click(screen.getByRole('button', { name: 'Sign the minutes' }));

    const password = screen.getByLabelText(/^Confirm your password/);
    expect(password).toHaveAccessibleDescription('Confirm your password to sign.');
    expect(password).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/^Type your full name/)).not.toHaveAttribute('aria-invalid');
    expect(mockSign).not.toHaveBeenCalled();
  });

  it('puts a 422 on the name field and announces it', async () => {
    mockSign.mockRejectedValueOnce({
      response: {
        status: 422,
        data: { detail: [{ field: 'signed_name', message: 'String should have at most 200 characters' }] },
      },
    });
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText(/^Type your full name/), 'Pat Chief');
    await user.type(screen.getByLabelText(/^Confirm your password/), 'secret');
    await user.click(screen.getByRole('button', { name: 'Sign the minutes' }));

    const name = screen.getByLabelText(/^Type your full name/);
    await waitFor(() =>
      expect(name).toHaveAccessibleDescription(
        expect.stringContaining('Your full name is too long — keep it to 200 characters.')
      )
    );
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('asks before Cancel throws a typed name away', async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText(/^Type your full name/), 'Pat Chief');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^Type your full name/)).toHaveValue('Pat Chief');
  });

  it('sends the slot, the typed name and the password, then closes', async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText(/^Type your full name/), '  Pat Chief ');
    await user.type(screen.getByLabelText(/^Confirm your password/), 'secret');
    await user.click(screen.getByRole('button', { name: 'Sign the minutes' }));

    expect(mockSign).toHaveBeenCalledWith('m1', 'recording_secretary', 'Pat Chief', 'secret');
    expect(onSigned).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the password masked and from autofilling a stale one', () => {
    open();
    const password = screen.getByLabelText(/^Confirm your password/);
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveAttribute('autocomplete', 'current-password');
  });

  it('shows the server’s reason, clears the password and stays open when signing fails', async () => {
    mockSign.mockRejectedValue(new Error('Your password is incorrect'));
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText(/^Type your full name/), 'Pat Chief');
    await user.type(screen.getByLabelText(/^Confirm your password/), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign the minutes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Your password is incorrect');
    expect(screen.getByLabelText(/^Confirm your password/)).toHaveValue('');
    expect(screen.getByLabelText(/^Type your full name/)).toHaveValue('Pat Chief');
    expect(onClose).not.toHaveBeenCalled();
    expect(onSigned).not.toHaveBeenCalled();
  });
});
