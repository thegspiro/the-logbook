import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Collapsible } from './Collapsible';

describe('Collapsible', () => {
  // jsdom does not apply `inert` to focus navigation, so this asserts the
  // attribute; the browser's skipping of inert content is its own behaviour.
  it('marks closed content inert so its controls leave the tab order', () => {
    render(
      <Collapsible title="Attachments">
        <button type="button">Hidden action</button>
      </Collapsible>
    );

    expect(screen.getByRole('region', { name: 'Attachments', hidden: true })).toHaveAttribute('inert');
  });

  it('opens with the trigger and reports its state', async () => {
    const user = userEvent.setup();
    render(
      <Collapsible title="Attachments">
        <button type="button">Hidden action</button>
      </Collapsible>
    );

    const trigger = screen.getByRole('button', { name: 'Attachments' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: 'Attachments' })).not.toHaveAttribute('inert');
  });

  it('does not submit the form it sits in', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Collapsible title="Attachments">content</Collapsible>
      </form>
    );

    await user.click(screen.getByRole('button', { name: 'Attachments' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
