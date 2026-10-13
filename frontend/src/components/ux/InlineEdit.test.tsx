import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InlineEdit } from './InlineEdit';

describe('InlineEdit', () => {
  it('names the edit field', async () => {
    const user = userEvent.setup();
    render(<InlineEdit value="Engine 1" onSave={vi.fn()} label="Apparatus name" />);

    await user.click(screen.getByRole('button', { name: /Engine 1/ }));
    expect(screen.getByRole('textbox', { name: 'Apparatus name' })).toHaveFocus();
  });

  it('returns focus to the value after saving with Enter', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<InlineEdit value="Engine 1" onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: /Engine 1/ }));
    await user.keyboard('{Control>}a{/Control}Engine 2{Enter}');

    expect(onSave).toHaveBeenCalledWith('Engine 2');
    expect(await screen.findByRole('button', { name: /Engine 1/ })).toHaveFocus();
  });

  it('cancels on Escape without letting the key reach a surrounding dialog', async () => {
    const user = userEvent.setup();
    const onDocumentEscape = vi.fn();
    document.addEventListener('keydown', onDocumentEscape);
    render(<InlineEdit value="Engine 1" onSave={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /Engine 1/ }));
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Engine 1/ })).toHaveFocus();
    expect(onDocumentEscape).not.toHaveBeenCalled();
    document.removeEventListener('keydown', onDocumentEscape);
  });
});
