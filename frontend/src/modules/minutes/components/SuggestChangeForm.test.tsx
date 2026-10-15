import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockAdd = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock('../services/api', () => ({
  minutesService: { addSuggestion: (...a: unknown[]) => mockAdd(...a) as unknown },
}));
vi.mock('react-hot-toast', () => ({
  default: {
    error: (...a: unknown[]) => toastError(...a) as unknown,
    success: (...a: unknown[]) => toastSuccess(...a) as unknown,
  },
}));

import { SuggestChangeForm } from './SuggestChangeForm';

describe('SuggestChangeForm', () => {
  const onSent = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdd.mockReset();
    mockAdd.mockResolvedValue({});
    onSent.mockReset();
    onSent.mockResolvedValue(undefined);
  });

  const open = (sectionKey?: string) =>
    render(
      <SuggestChangeForm
        minutesId="m1"
        sectionKey={sectionKey}
        subject="New Business"
        onSent={onSent}
        onCancel={onCancel}
      />
    );

  it('is named for the section it is about', () => {
    open('new_business');
    expect(screen.getByRole('form', { name: 'Suggest a change to New Business' })).toBeInTheDocument();
  });

  it('will not send until there is something to say', async () => {
    const user = userEvent.setup();
    open('new_business');
    expect(screen.getByRole('button', { name: 'Send suggestion' })).toBeDisabled();
    await user.type(screen.getByLabelText('What should change?'), 'ab');
    expect(screen.getByRole('button', { name: 'Send suggestion' })).toBeDisabled();
    await user.type(screen.getByLabelText('What should change?'), 'c');
    expect(screen.getByRole('button', { name: 'Send suggestion' })).toBeEnabled();
  });

  it('sends the section, the comment and the optional wording, then reports it sent', async () => {
    const user = userEvent.setup();
    open('new_business');

    await user.type(screen.getByLabelText('What should change?'), '  The vote was 5-1  ');
    await user.type(screen.getByLabelText(/Suggested wording/), 'Motion carried 5-1.');
    await user.click(screen.getByRole('button', { name: 'Send suggestion' }));

    expect(mockAdd).toHaveBeenCalledWith('m1', {
      section_key: 'new_business',
      comment: 'The vote was 5-1',
      proposed_text: 'Motion carried 5-1.',
    });
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('omits the section and blank wording for a whole-minutes suggestion', async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText('What should change?'), 'Please add the guest list');
    await user.click(screen.getByRole('button', { name: 'Send suggestion' }));

    expect(mockAdd).toHaveBeenCalledWith('m1', {
      section_key: undefined,
      comment: 'Please add the guest list',
      proposed_text: undefined,
    });
  });

  it('reports a refusal, keeps what was typed and does not claim it was sent', async () => {
    mockAdd.mockRejectedValue(new Error('Changes can be suggested only while the minutes are circulated'));
    const user = userEvent.setup();
    open('new_business');

    await user.type(screen.getByLabelText('What should change?'), 'Too late maybe');
    await user.click(screen.getByRole('button', { name: 'Send suggestion' }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getByLabelText('What should change?')).toHaveValue('Too late maybe');
    expect(onSent).not.toHaveBeenCalled();
  });

  it('cancels without sending', async () => {
    const user = userEvent.setup();
    open('new_business');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  describe('editing the section’s own text', () => {
    const edit = (original = { content: '<p>Three bids today.</p>', format: 'html' as 'html' | 'text' }) =>
      render(
        <SuggestChangeForm
          minutesId="m1"
          sectionKey="old_business"
          subject="Old Business"
          original={original}
          onSent={onSent}
          onCancel={onCancel}
        />
      );

    it('opens the original text in the editor, with an optional comment and no wording box', async () => {
      edit();
      const editor = await screen.findByRole('textbox', { name: 'Your edit of Old Business' });
      expect(editor).toHaveTextContent('Three bids today.');
      expect(screen.getByLabelText('Comment (optional)')).toBeInTheDocument();
      expect(screen.queryByLabelText(/Suggested wording/)).not.toBeInTheDocument();
    });

    it('will not send an untouched copy', async () => {
      edit();
      await screen.findByRole('textbox', { name: 'Your edit of Old Business' });
      expect(screen.getByRole('button', { name: 'Send suggestion' })).toBeDisabled();
    });

    it('sends the edited copy as tracked changes, with no comment needed', async () => {
      const user = userEvent.setup();
      edit();
      const editor = await screen.findByRole('textbox', { name: 'Your edit of Old Business' });
      await user.click(editor);
      await user.keyboard('X');
      await user.click(screen.getByRole('button', { name: 'Send suggestion' }));

      await waitFor(() => expect(mockAdd).toHaveBeenCalledTimes(1));
      const [id, payload] = mockAdd.mock.calls[0] as [string, Record<string, unknown>];
      expect(id).toBe('m1');
      expect(payload.section_key).toBe('old_business');
      expect(payload.comment).toBeUndefined();
      expect(payload.proposed_text).toBeUndefined();
      expect(payload.proposed_html).toEqual(expect.stringContaining('X'));
      expect(payload.proposed_html).toEqual(expect.stringContaining('Three bids today.'));
    });

    it('still sends a comment on its own, with no edit', async () => {
      const user = userEvent.setup();
      edit();
      await user.type(await screen.findByLabelText('Comment (optional)'), 'Please add the date');
      await user.click(screen.getByRole('button', { name: 'Send suggestion' }));

      expect(mockAdd).toHaveBeenCalledWith('m1', {
        section_key: 'old_business',
        comment: 'Please add the date',
        proposed_text: undefined,
        proposed_html: undefined,
      });
    });

    it('opens an old plain-text section as paragraphs, words unchanged', async () => {
      edit({ content: 'Hose order\n\nNote <5 bids', format: 'text' });
      const editor = await screen.findByRole('textbox', { name: 'Your edit of Old Business' });
      expect(editor).toHaveTextContent('Hose order');
      expect(editor).toHaveTextContent('Note <5 bids');
    });
  });
});
