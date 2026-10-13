import { describe, it, expect } from 'vitest';
import { useRef, useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEscapeToClose } from './useEscapeToClose';

const Popover: React.FC = () => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEscapeToClose(open, () => setOpen(false), containerRef, triggerRef);
  return (
    <>
      <div ref={containerRef}>
        <button ref={triggerRef} type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          Presets
        </button>
        {open && <button type="button">Save current filters</button>}
      </div>
      <input aria-label="Search" />
    </>
  );
};

describe('useEscapeToClose', () => {
  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<Popover />);

    await user.click(screen.getByRole('button', { name: 'Presets' }));
    await user.tab();
    expect(screen.getByRole('button', { name: 'Save current filters' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: 'Save current filters' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Presets' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Presets' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('does not move focus when Escape is pressed elsewhere', async () => {
    const user = userEvent.setup();
    render(<Popover />);

    await user.click(screen.getByRole('button', { name: 'Presets' }));
    await user.click(screen.getByRole('textbox', { name: 'Search' }));
    await user.keyboard('{Escape}');

    expect(screen.getByRole('textbox', { name: 'Search' })).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Save current filters' })).not.toBeInTheDocument();
  });
});
