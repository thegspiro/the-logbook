import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FloatingActionButton } from './FloatingActionButton';
import React from 'react';

const PlusIcon = () => <span data-testid="plus-icon">+</span>;
const StarIcon = () => <span data-testid="star-icon">*</span>;

describe('FloatingActionButton', () => {
  const actions = [
    { id: 'add', label: 'Add Item', icon: <PlusIcon />, onClick: vi.fn() },
    { id: 'star', label: 'Favorite', icon: <StarIcon />, onClick: vi.fn() },
  ];

  it('renders the main FAB button', () => {
    render(<FloatingActionButton actions={actions} />);
    expect(screen.getByLabelText('Open quick actions')).toBeInTheDocument();
  });

  it('does not render when actions array is empty', () => {
    const { container } = render(<FloatingActionButton actions={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows action labels when FAB is clicked', async () => {
    const user = userEvent.setup();
    render(<FloatingActionButton actions={actions} />);

    await user.click(screen.getByLabelText('Open quick actions'));

    expect(screen.getByText('Add Item')).toBeInTheDocument();
    expect(screen.getByText('Favorite')).toBeInTheDocument();
    expect(screen.getByLabelText('Close quick actions')).toBeInTheDocument();
  });

  it('calls action onClick and closes menu when action is clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const testActions = [
      { id: 'test', label: 'Test Action', icon: <PlusIcon />, onClick },
    ];

    render(<FloatingActionButton actions={testActions} />);
    await user.click(screen.getByLabelText('Open quick actions'));
    await user.click(screen.getByText('Test Action'));

    expect(onClick).toHaveBeenCalledTimes(1);
    // Menu should close after click
    expect(screen.queryByText('Test Action')).not.toBeInTheDocument();
  });

  it('closes menu when FAB is clicked again', async () => {
    const user = userEvent.setup();
    render(<FloatingActionButton actions={actions} />);

    // Open
    await user.click(screen.getByLabelText('Open quick actions'));
    expect(screen.getByText('Add Item')).toBeInTheDocument();

    // Close
    await user.click(screen.getByLabelText('Close quick actions'));
    expect(screen.queryByText('Add Item')).not.toBeInTheDocument();
  });
});
