import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockSign = vi.fn();

vi.mock('../services/api', () => ({
  minutesService: { sign: (...a: unknown[]) => mockSign(...a) as unknown },
}));

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
    render(
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

  it('will not sign without both a name and a password', async () => {
    const user = userEvent.setup();
    open();
    const button = screen.getByRole('button', { name: 'Sign the minutes' });
    expect(button).toBeDisabled();

    await user.type(screen.getByLabelText('Type your full name'), 'Pat Chief');
    expect(button).toBeDisabled();

    await user.type(screen.getByLabelText('Confirm your password'), 'secret');
    expect(button).toBeEnabled();
  });

  it('sends the slot, the typed name and the password, then closes', async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText('Type your full name'), '  Pat Chief ');
    await user.type(screen.getByLabelText('Confirm your password'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Sign the minutes' }));

    expect(mockSign).toHaveBeenCalledWith('m1', 'recording_secretary', 'Pat Chief', 'secret');
    expect(onSigned).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the password masked and from autofilling a stale one', () => {
    open();
    const password = screen.getByLabelText('Confirm your password');
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveAttribute('autocomplete', 'current-password');
  });

  it('shows the server’s reason, clears the password and stays open when signing fails', async () => {
    mockSign.mockRejectedValue(new Error('Your password is incorrect'));
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText('Type your full name'), 'Pat Chief');
    await user.type(screen.getByLabelText('Confirm your password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign the minutes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Your password is incorrect');
    expect(screen.getByLabelText('Confirm your password')).toHaveValue('');
    expect(screen.getByLabelText('Type your full name')).toHaveValue('Pat Chief');
    expect(onClose).not.toHaveBeenCalled();
    expect(onSigned).not.toHaveBeenCalled();
  });
});
