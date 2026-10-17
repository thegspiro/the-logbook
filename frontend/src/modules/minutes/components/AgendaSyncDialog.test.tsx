import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockPreview = vi.fn();
const mockApply = vi.fn();
vi.mock('../services/api', () => ({
  minutesService: {
    getAgendaSync: (...a: unknown[]) => mockPreview(...a) as unknown,
    applyAgendaSync: (...a: unknown[]) => mockApply(...a) as unknown,
  },
}));

import { AgendaSyncDialog } from './AgendaSyncDialog';

const preview = {
  meeting_id: 'm1',
  changes: [
    { id: 'add:d', type: 'add', key: 'd', title: 'Four', has_content: false, fields: [] },
    {
      id: 'update:a',
      type: 'update',
      key: 'a',
      title: 'One (revised)',
      has_content: true,
      fields: [{ field: 'Title', before: 'One', after: 'One (revised)' }],
    },
    { id: 'remove:b', type: 'remove', key: 'b', title: 'Two', has_content: true, fields: [] },
    { id: 'remove:c', type: 'remove', key: 'c', title: 'Three', has_content: false, fields: [] },
    { id: 'reorder', type: 'reorder', key: '', title: 'Order of the items', has_content: false, fields: [] },
  ],
};

describe('AgendaSyncDialog', () => {
  const onClose = vi.fn();
  const onApplied = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockPreview.mockReset();
    mockPreview.mockResolvedValue(preview);
    mockApply.mockReset();
    mockApply.mockResolvedValue({});
    onApplied.mockReset();
  });

  const open = () => render(<AgendaSyncDialog isOpen minutesId="mm1" onClose={onClose} onApplied={onApplied} />);

  it('lists what the agenda changed, as the server read it', async () => {
    open();
    expect(await screen.findByText('New item: Four')).toBeInTheDocument();
    expect(screen.getByText('Changed: One (revised)')).toBeInTheDocument();
    expect(screen.getByText('Title: One → One (revised)')).toBeInTheDocument();
    expect(screen.getByText(/The items are in a different order/)).toBeInTheDocument();
  });

  it('says what a removal will do, by whether the section holds text', async () => {
    open();
    expect(await screen.findByText(/Two\. It has text, so it stays as an ordinary section/)).toBeInTheDocument();
    expect(screen.getByText(/Three\. Its empty section will be deleted/)).toBeInTheDocument();
  });

  it('applies every change by default', async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: 'Apply 5 changes' }));

    expect(mockApply).toHaveBeenCalledWith('mm1', ['add:d', 'update:a', 'remove:b', 'remove:c', 'reorder']);
    expect(onApplied).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('applies only the changes left ticked', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByText('New item: Four');
    for (const box of screen.getAllByRole('checkbox')) await user.click(box);
    await user.click(screen.getAllByRole('checkbox')[0] as HTMLElement);
    await user.click(screen.getByRole('button', { name: 'Apply 1 change' }));

    expect(mockApply).toHaveBeenCalledWith('mm1', ['add:d']);
  });

  it('cannot apply with nothing ticked', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByText('New item: Four');
    for (const box of screen.getAllByRole('checkbox')) await user.click(box);

    expect(screen.getByRole('button', { name: 'Apply 0 changes' })).toBeDisabled();
  });

  it('says so when the minutes already match', async () => {
    mockPreview.mockResolvedValueOnce({ meeting_id: 'm1', changes: [] });
    open();
    expect(await screen.findByText(/already match the meeting’s agenda/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Apply/ })).not.toBeInTheDocument();
  });

  it('shows the error when the comparison fails', async () => {
    mockPreview.mockRejectedValueOnce(new Error('boom'));
    open();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('keeps the dialog open and says why when applying fails', async () => {
    mockApply.mockRejectedValueOnce(new Error('boom'));
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: 'Apply 5 changes' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
