import { describe, it, expect } from 'vitest';
import { StrictMode, useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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

  it('survives StrictMode running the effect twice on mount', async () => {
    const user = userEvent.setup();
    render(
      <StrictMode>
        <Harness autoFocusField />
      </StrictMode>
    );

    const opener = screen.getByRole('button', { name: 'Open' });
    await user.click(opener);
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus());

    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("falls back to the parent dialog's opener when its own opener is gone", async () => {
    const user = userEvent.setup();

    const Picker: React.FC<{ onPick: () => void }> = ({ onPick }) => {
      const ref = useFocusTrap<HTMLDivElement>(true);
      return (
        <div ref={ref} role="dialog" aria-label="Pick">
          <button type="button" onClick={onPick}>
            Jordan
          </button>
        </div>
      );
    };
    const Confirm: React.FC<{ onClose: () => void }> = ({ onClose }) => {
      const ref = useFocusTrap<HTMLDivElement>(true);
      return (
        <div ref={ref} role="dialog" aria-label="Confirm">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      );
    };
    const Flow: React.FC = () => {
      const [step, setStep] = useState<'idle' | 'pick' | 'confirm'>('idle');
      return (
        <>
          <button type="button" onClick={() => setStep('pick')}>
            Issue
          </button>
          {step === 'pick' && <Picker onPick={() => setStep('confirm')} />}
          {step === 'confirm' && <Confirm onClose={() => setStep('idle')} />}
        </>
      );
    };

    render(<Flow />);
    const issue = screen.getByRole('button', { name: 'Issue' });
    await user.click(issue);
    await user.click(screen.getByRole('button', { name: 'Jordan' }));

    // The picker's own restore must not pull focus out of the confirm.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(issue).toHaveFocus());
  });
});
