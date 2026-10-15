import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RichTextEditor } from './RichTextEditor';

describe('RichTextEditor', () => {
  const onChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    onChange.mockReset();
  });

  const open = (value = '') =>
    render(<RichTextEditor id="ed" value={value} onChange={onChange} label="Old Business content" />);

  it('is a named text area with a labelled formatting toolbar', async () => {
    open();
    expect(await screen.findByRole('textbox', { name: 'Old Business content' })).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Formatting for Old Business content' })).toBeInTheDocument();
    for (const name of [
      'Bold',
      'Italic',
      'Underline',
      'Heading',
      'Subheading',
      'Bulleted list',
      'Numbered list',
      'Quote',
      'Link',
    ]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('offers nothing the server would strip', async () => {
    open();
    await screen.findByRole('textbox');
    expect(screen.queryByRole('button', { name: /strike|code|image|table/i })).not.toBeInTheDocument();
  });

  it('reports what is typed as the HTML subset', async () => {
    const user = userEvent.setup();
    open();
    await user.type(await screen.findByRole('textbox'), 'Motion carried');
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('<p>Motion carried</p>'));
  });

  it('opens with the document it is given, cleaned', async () => {
    open('<p>Existing <strong>text</strong></p><script>bad()</script>');
    const box = await screen.findByRole('textbox');
    expect(box).toHaveTextContent('Existing text');
    expect(box.innerHTML).not.toContain('script');
  });

  it('applies bold from the toolbar', async () => {
    const user = userEvent.setup();
    open();
    const box = await screen.findByRole('textbox');
    await user.click(box);
    await user.click(screen.getByRole('button', { name: 'Bold' }));
    expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
    // The editor takes focus back from the toolbar button asynchronously;
    // keys typed before that would go nowhere.
    await waitFor(() => expect(box).toHaveFocus());
    await user.keyboard('loud');
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('<p><strong>loud</strong></p>'));
  });

  it('reports an empty document as an empty string, not an empty paragraph', async () => {
    const user = userEvent.setup();
    open('<p>x</p>');
    await user.click(await screen.findByRole('textbox'));
    await user.keyboard('{Control>}a{/Control}{Backspace}');
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(''));
  });

  it('adds a link, assuming https for a bare address', async () => {
    const user = userEvent.setup();
    open('<p>See the site</p>');
    const box = await screen.findByRole('textbox');
    await user.click(box);
    await user.keyboard('{Control>}a{/Control}');
    await user.click(screen.getByRole('button', { name: 'Link' }));
    await user.type(screen.getByLabelText('Link address'), 'example.org');
    await user.click(screen.getByRole('button', { name: 'Apply link' }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining('href="https://example.org"'));
  });

  it('refuses a script address and says why', async () => {
    const user = userEvent.setup();
    open('<p>See the site</p>');
    await user.click(await screen.findByRole('textbox'));
    await user.keyboard('{Control>}a{/Control}');
    await user.click(screen.getByRole('button', { name: 'Link' }));
    await user.type(screen.getByLabelText('Link address'), 'javascript:alert(1)');
    await user.click(screen.getByRole('button', { name: 'Apply link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/web address/);
    expect(onChange).not.toHaveBeenCalled();
  });
});
