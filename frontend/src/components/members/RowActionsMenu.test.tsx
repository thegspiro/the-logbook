import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RowActionsMenu } from './RowActionsMenu';

const setup = () => {
  const onReset = vi.fn();
  const onDelete = vi.fn();
  render(
    <div>
      <p>Outside</p>
      <RowActionsMenu
        label="More actions for Jordan Avery"
        actions={[
          { label: 'Reset Password', ariaLabel: 'Reset password for Jordan Avery', onSelect: onReset },
          { label: 'Delete', tone: 'danger', onSelect: onDelete },
        ]}
      />
    </div>
  );
  return { onReset, onDelete, user: userEvent.setup() };
};

describe('RowActionsMenu', () => {
  it('opens on the trigger, focuses the first item, and runs the chosen one', async () => {
    const { onReset, onDelete, user } = setup();
    const trigger = screen.getByRole('button', { name: 'More actions for Jordan Avery' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menuitem', { name: 'Reset password for Jordan Avery' })).toHaveFocus();

    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onReset).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('moves between items with the arrow keys', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'More actions for Jordan Avery' }));

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Reset password for Jordan Avery' })).toHaveFocus();
  });

  it('closes on Escape and gives focus back to the trigger', async () => {
    const { user } = setup();
    const trigger = screen.getByRole('button', { name: 'More actions for Jordan Avery' });
    await user.click(trigger);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes on a click outside it without running anything', async () => {
    const { onReset, onDelete, user } = setup();
    await user.click(screen.getByRole('button', { name: 'More actions for Jordan Avery' }));

    await user.click(screen.getByText('Outside'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(onReset).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('renders nothing when there are no actions', () => {
    render(<RowActionsMenu label="More actions for Cory Self" actions={[]} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  describe('near the phone bottom bar', () => {
    const originalHeight = window.innerHeight;

    afterEach(() => {
      document.documentElement.style.removeProperty('--bottom-nav-height');
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight });
      vi.restoreAllMocks();
    });

    it('opens upward rather than under a bar set in rem', async () => {
      // The app sets the bar's height as 3.5rem. Read as a bare number it was
      // 3.5px, so a menu ending inside the bar's 56px opened downward under it.
      document.documentElement.style.setProperty('--bottom-nav-height', '3.5rem');
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(80);
      const { user } = setup();
      const trigger = screen.getByRole('button', { name: 'More actions for Jordan Avery' });
      vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
        top: 664,
        bottom: 700,
        left: 300,
        right: 340,
        width: 40,
        height: 36,
        x: 300,
        y: 664,
        toJSON: () => ({}),
      });

      await user.click(trigger);
      // 700 + 4 + 80 = 784 is past 800 - 56 = 744, so it opens above: 664 - 4 - 80.
      expect(screen.getByRole('menu').style.top).toBe('580px');
    });
  });
});
