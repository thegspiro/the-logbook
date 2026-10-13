import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useFocusTrap } from './useFocusTrap';

const Dialog: React.FC<{ autoFocusField?: boolean; marked?: boolean; onClose: () => void }> = ({
  autoFocusField = false,
  marked = false,
  onClose,
}) => {
  const ref = useFocusTrap<HTMLDivElement>(true);
  return (
    <div ref={ref} role="dialog" aria-label="Edit">
      <button type="button" data-dialog-close onClick={onClose}>
        Close
      </button>
      <input aria-label="Name" autoFocus={autoFocusField} />
      <button type="button" data-autofocus={marked ? '' : undefined}>
        Keep it
      </button>
    </div>
  );
};

const Harness: React.FC<{ autoFocusField?: boolean; marked?: boolean }> = (props) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && <Dialog {...props} onClose={() => setOpen(false)} />}
    </>
  );
};

describe('useFocusTrap', () => {
  it('starts on the first control that is not the close button', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus();
  });

  it('prefers an element marked data-autofocus', async () => {
    const user = userEvent.setup();
    render(<Harness marked />);

    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('button', { name: 'Keep it' })).toHaveFocus();
  });

  it('returns focus to the opener even when a field inside took focus first', async () => {
    const user = userEvent.setup();
    render(<Harness autoFocusField />);

    const opener = screen.getByRole('button', { name: 'Open' });
    await user.click(opener);
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(opener).toHaveFocus();
  });

  it('keeps Tab inside the container', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });
});
