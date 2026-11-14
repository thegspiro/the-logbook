import { describe, expect, it, vi } from 'vitest';
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
});
