import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
});
