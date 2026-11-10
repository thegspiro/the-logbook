/**
 * The fundraising event dialog puts a server refusal on the field it names
 * (forms review F-2) and asks before Escape or Cancel throws a changed form
 * away (F-6).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider } from '@/contexts/ConfirmContext';

const createFundraisingEvent = vi.fn();
vi.mock('../services/api', () => ({
  fundraisingService: {
    createFundraisingEvent: (...args: unknown[]) => createFundraisingEvent(...args) as unknown,
    updateFundraisingEvent: vi.fn(),
  },
}));
const toastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: (...args: unknown[]) => toastError(...args) as unknown },
}));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

import { FundraisingEventDialog } from './FundraisingEventDialog';

const renderDialog = () => {
  const handlers = { onClose: vi.fn(), onSaved: vi.fn() };
  render(<FundraisingEventDialog campaigns={[]} {...handlers} />, { wrapper: ConfirmProvider });
  return handlers;
};

describe('FundraisingEventDialog', () => {
  beforeEach(() => {
    createFundraisingEvent.mockReset();
    toastError.mockReset();
  });

  it("puts the server's refusal of the location under the location and adds nothing", async () => {
    createFundraisingEvent.mockRejectedValue({
      response: { status: 422, data: { detail: [{ field: 'location', message: 'Value is too long.' }] } },
    });
    const user = userEvent.setup();
    const { onSaved } = renderDialog();
    await user.type(screen.getByLabelText(/^Name/), 'Golf Classic');
    await user.type(screen.getByLabelText(/^Date and time/), '2027-05-15T08:00');
    await user.type(screen.getByLabelText(/^Location/), 'Pine Hills');
    await user.click(screen.getByRole('button', { name: 'Add event' }));

    const location = screen.getByLabelText(/^Location/);
    await waitFor(() => expect(location).toHaveAttribute('aria-invalid', 'true'));
    expect(location).toHaveAccessibleDescription('Location is too long — keep it to 300 characters.');
    expect(location).toHaveFocus();
    expect(onSaved).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('asks before Escape or Cancel throws away a changed form', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await user.type(screen.getByLabelText(/^Name/), 'Golf Classic');

    await user.keyboard('{Escape}');
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^Name/)).toHaveValue('Golf Classic');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
