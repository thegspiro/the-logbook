import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useConfirm, type ConfirmOptions } from './useConfirm';

/** A host that runs the same await-a-confirmation flow a real caller does. */
const Host: React.FC<{ onResult: (v: boolean) => void; options?: ConfirmOptions }> = ({
  onResult,
  options = { message: 'Delete this room?' },
}) => {
  const { confirm, confirmDialog } = useConfirm();
  return (
    <>
      <button onClick={() => void confirm(options).then(onResult)}>Delete</button>
      {confirmDialog}
    </>
  );
};

describe('useConfirm', () => {
  const onResult = vi.fn<(v: boolean) => void>();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not show a dialog until something asks', () => {
    render(<Host onResult={onResult} />);

    expect(screen.queryByText('Delete this room?')).not.toBeInTheDocument();
  });

  it('resolves true when confirmed', async () => {
    const user = userEvent.setup();
    render(<Host onResult={onResult} />);

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Delete this room?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
  });

  it('resolves false when dismissed', async () => {
    const user = userEvent.setup();
    render(<Host onResult={onResult} />);

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(await screen.findByRole('button', { name: /cancel/i }));

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });

  it('closes the dialog once answered', async () => {
    const user = userEvent.setup();
    render(<Host onResult={onResult} />);

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(await screen.findByRole('button', { name: /confirm/i }));

    await waitFor(() => expect(screen.queryByText('Delete this room?')).not.toBeInTheDocument());
  });

  it('uses the labels the caller chose for the decision', async () => {
    const user = userEvent.setup();
    render(
      <Host
        onResult={onResult}
        options={{
          message: 'Delete this room?',
          title: 'Delete room',
          confirmLabel: 'Delete room',
          cancelLabel: 'Keep it',
        }}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByRole('button', { name: 'Delete room' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep it' })).toBeInTheDocument();
  });

  // A promise nobody settles leaves the caller's `await` hanging and the rest
  // of its function never runs — the same silent failure this replaces.
  it('answers no if the component unmounts while the question is open', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Host onResult={onResult} />);

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    unmount();

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });

  it('answers no to a question that a second one replaces', async () => {
    const user = userEvent.setup();
    render(<Host onResult={onResult} />);

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
    expect(onResult).toHaveBeenCalledTimes(1);
  });
});
