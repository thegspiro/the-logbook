import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PanelDisclosure } from './PanelDisclosure';

const panel = (props: Partial<React.ComponentProps<typeof PanelDisclosure>> = {}) => (
  <PanelDisclosure id="motions-heading" title="Motions" count={3} actions={<button>Add Motion</button>} {...props}>
    <p>Motion one</p>
    <input aria-label="Draft motion text" />
  </PanelDisclosure>
);

describe('PanelDisclosure', () => {
  it('names the panel from its heading, with the count', () => {
    render(panel());
    expect(screen.getByRole('region', { name: 'Motions (3)' })).toBeInTheDocument();
  });

  it('starts open unless told otherwise', () => {
    render(panel());
    expect(screen.getByRole('button', { name: 'Motions (3)' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Motion one')).toBeVisible();
  });

  it('folds: the body is hidden and the heading says so', () => {
    render(panel({ defaultOpen: false }));
    const toggle = screen.getByRole('button', { name: 'Motions (3)' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Motion one')).not.toBeVisible();
  });

  it('opens and folds on a tap of the heading', async () => {
    const user = userEvent.setup();
    render(panel({ defaultOpen: false }));
    await user.click(screen.getByRole('button', { name: 'Motions (3)' }));
    expect(screen.getByText('Motion one')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Motions (3)' }));
    expect(screen.queryByText('Motion one')).not.toBeVisible();
  });

  it('shows header actions only while open, since they act on the body', async () => {
    const user = userEvent.setup();
    render(panel({ defaultOpen: false }));
    expect(screen.queryByRole('button', { name: 'Add Motion' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Motions (3)' }));
    expect(screen.getByRole('button', { name: 'Add Motion' })).toBeInTheDocument();
  });

  it('keeps what was typed when the panel is folded and reopened', async () => {
    const user = userEvent.setup();
    render(panel());
    await user.type(screen.getByLabelText('Draft motion text'), 'Move to adjourn');
    await user.click(screen.getByRole('button', { name: 'Motions (3)' }));
    await user.click(screen.getByRole('button', { name: 'Motions (3)' }));
    expect(screen.getByLabelText('Draft motion text')).toHaveValue('Move to adjourn');
  });

  it('unfolds and flags itself when something needs attention, so a warning cannot hide', () => {
    const { rerender } = render(panel({ defaultOpen: false, attention: false }));
    expect(screen.queryByText('Needs attention')).not.toBeInTheDocument();
    rerender(panel({ defaultOpen: false, attention: true }));
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByText('Motion one')).toBeVisible();
  });

  it('omits the count when none is given', () => {
    render(panel({ count: undefined }));
    expect(screen.getByRole('button', { name: 'Motions' })).toBeInTheDocument();
  });
});
