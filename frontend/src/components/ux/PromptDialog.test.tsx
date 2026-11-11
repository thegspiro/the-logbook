import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider } from '@/contexts/ConfirmContext';
import { PromptDialog } from './PromptDialog';

describe('PromptDialog', () => {
  const onSubmit = vi.fn<(value: string) => void>();
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderDialog = (props: Partial<React.ComponentProps<typeof PromptDialog>> = {}) =>
    render(
      <PromptDialog
        isOpen
        onClose={onClose}
        onSubmit={onSubmit}
        title="Void batch"
        label="Reason for voiding"
        {...props}
      />
    );

  it('passes the trimmed value to onSubmit', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText(/reason for voiding/i), '  wrong election  ');
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onSubmit).toHaveBeenCalledWith('wrong election');
  });

  // The whole point of replacing window.prompt: a value that fails validation
  // used to be dropped with no indication that anything had been rejected.
  it('says why a required value was rejected instead of doing nothing', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(screen.getByRole('alert')).toHaveTextContent('Reason for voiding is required.');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('says how long a too-short value needs to be', async () => {
    const user = userEvent.setup();
    renderDialog({ minLength: 3 });

    await user.type(screen.getByLabelText(/reason for voiding/i), 'ab');
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(screen.getByRole('alert')).toHaveTextContent('at least 3 characters');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // The dialog appends "(optional)" itself; a label that already says so
  // rendered it twice.
  it('marks an optional value as optional exactly once', () => {
    renderDialog({ required: false, label: 'Note' });

    const label = screen.getByText(/^Note/, { selector: 'label' });
    expect(label.textContent?.match(/\(optional\)/g)).toHaveLength(1);
  });

  it('allows an empty submission when the value is optional', async () => {
    const user = userEvent.setup();
    renderDialog({ required: false });

    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onSubmit).toHaveBeenCalledWith('');
  });

  it('prefills a default the user can simply accept', async () => {
    const user = userEvent.setup();
    renderDialog({ defaultValue: 'Engine 1 check (Copy)' });

    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onSubmit).toHaveBeenCalledWith('Engine 1 check (Copy)');
  });

  // These dialogs are rendered permanently and toggled with `isOpen`, so a
  // value left behind would be prefilled into the next one — on a void reason,
  // that means filing someone else's explanation.
  it('does not carry a typed value over to the next time it opens', async () => {
    const user = userEvent.setup();
    const { rerender } = renderDialog();

    await user.type(screen.getByLabelText(/reason for voiding/i), 'first reason');
    rerender(
      <PromptDialog
        isOpen={false}
        onClose={onClose}
        onSubmit={onSubmit}
        title="Void batch"
        label="Reason for voiding"
      />
    );
    rerender(
      <PromptDialog isOpen onClose={onClose} onSubmit={onSubmit} title="Void batch" label="Reason for voiding" />
    );

    expect(screen.getByLabelText(/reason for voiding/i)).toHaveValue('');
  });

  it('submits a single-line field on Enter', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText(/reason for voiding/i), '10428{Enter}');

    expect(onSubmit).toHaveBeenCalledWith('10428');
  });

  it('does not submit while a previous submission is in flight', async () => {
    const user = userEvent.setup();
    renderDialog({ defaultValue: 'a reason', loading: true });

    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  // Opt-in (owner decision, 2026-11-11, first used on Approvals): a typed
  // value is not thrown away by one stray Escape, X or Cancel.
  describe('askBeforeDiscard', () => {
    const renderGuarded = (props: Partial<React.ComponentProps<typeof PromptDialog>> = {}) =>
      render(
        <ConfirmProvider>
          <PromptDialog
            isOpen
            onClose={onClose}
            onSubmit={onSubmit}
            title="Deny request"
            label="Reason"
            askBeforeDiscard
            {...props}
          />
        </ConfirmProvider>
      );

    it('closes at once while nothing has been typed', async () => {
      const user = userEvent.setup();
      renderGuarded();
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('asks before Cancel throws a typed value away, and keeps it on Keep editing', async () => {
      const user = userEvent.setup();
      renderGuarded();
      await user.type(screen.getByLabelText('Reason'), 'Over budget');
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      await user.click(await screen.findByRole('button', { name: 'Keep editing' }));
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByLabelText('Reason')).toHaveValue('Over budget');
    });

    it('closes on Discard changes', async () => {
      const user = userEvent.setup();
      renderGuarded();
      await user.type(screen.getByLabelText('Reason'), 'Over budget');
      await user.keyboard('{Escape}');
      await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('treats an untouched default as nothing typed', async () => {
      const user = userEvent.setup();
      renderGuarded({ defaultValue: 'Approved as asked' });
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('does not ask before discarding unless the caller opts in', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByLabelText(/reason for voiding/i), 'typed');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Keep editing' })).not.toBeInTheDocument();
  });

  // The server's refusal goes on the field, as the owner rule (2026-11-05)
  // puts every other form's, and clears once the value is edited.
  it("shows the server's refusal on the field until it is edited", async () => {
    const user = userEvent.setup();
    renderDialog({ defaultValue: 'x', error: 'Reason is too long.' });
    const field = screen.getByLabelText(/reason for voiding/i);
    expect(screen.getByText('Reason is too long.')).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription('Reason is too long.');

    await user.type(field, 'y');
    expect(screen.queryByText('Reason is too long.')).not.toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'false');
  });
});
