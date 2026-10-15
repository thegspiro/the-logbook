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
});
