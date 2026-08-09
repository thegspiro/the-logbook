import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider, useConfirm, type ConfirmOptions } from './ConfirmContext';

/** A host that runs the same await-a-confirmation flow a real caller does. */
const Asker: React.FC<{ onResult: (v: boolean) => void; options?: ConfirmOptions }> = ({
  onResult,
  options = { message: 'Delete this room?' },
}) => {
  const { confirm } = useConfirm();
  return <button onClick={() => void confirm(options).then(onResult)}>Delete</button>;
};

const renderAsker = (props: { onResult: (v: boolean) => void; options?: ConfirmOptions }) =>
  render(
    <ConfirmProvider>
      <Asker {...props} />
    </ConfirmProvider>
  );

describe('ConfirmProvider', () => {
  const onResult = vi.fn<(v: boolean) => void>();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not show a dialog until something asks', () => {
    renderAsker({ onResult });

    expect(screen.queryByText('Delete this room?')).not.toBeInTheDocument();
  });

  it('resolves true when confirmed', async () => {
    const user = userEvent.setup();
    renderAsker({ onResult });

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Delete this room?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
  });

  it('resolves false when dismissed', async () => {
    const user = userEvent.setup();
    renderAsker({ onResult });

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(await screen.findByRole('button', { name: /cancel/i }));

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });

  it('closes the dialog once answered', async () => {
    const user = userEvent.setup();
    renderAsker({ onResult });

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(await screen.findByRole('button', { name: /confirm/i }));

    await waitFor(() => expect(screen.queryByText('Delete this room?')).not.toBeInTheDocument());
  });

  it('uses the labels the caller chose for the decision', async () => {
    const user = userEvent.setup();
    renderAsker({
      onResult,
      options: {
        message: 'Delete this room?',
        title: 'Delete room',
        confirmLabel: 'Delete room',
        cancelLabel: 'Keep it',
      },
    });

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByRole('button', { name: 'Delete room' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep it' })).toBeInTheDocument();
  });

  // A promise nobody settles leaves the caller's `await` hanging and the rest
  // of its function never runs — the same silent failure this replaces.
  it('answers no if the provider unmounts while the question is open', async () => {
    const user = userEvent.setup();
    const { unmount } = renderAsker({ onResult });

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    unmount();

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });

  it('answers no to a question that a second one replaces', async () => {
    const user = userEvent.setup();
    renderAsker({ onResult });

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  // Loudly, at the call. Resolving to a default would either carry out a
  // deletion nobody agreed to, or swallow the action without a word.
  it('throws rather than hanging when no provider is mounted', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => render(<Asker onResult={onResult} />)).toThrow(/ConfirmProvider/);

    consoleError.mockRestore();
  });
});
