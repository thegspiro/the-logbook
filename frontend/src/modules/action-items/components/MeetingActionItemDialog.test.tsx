import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { ActionItemSummary } from '../../../services/api';

const updateActionItem = vi.fn();
vi.mock('../../../services/api', () => ({
  meetingsService: {
    updateActionItem: (...args: unknown[]) => updateActionItem(...args) as unknown,
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { MeetingActionItemDialog } from './MeetingActionItemDialog';

const item: ActionItemSummary = {
  id: 'ai-1',
  source: 'meeting',
  source_id: 'm-1',
  description: 'Order new hose',
  due_date: '2026-12-01',
  status: 'open',
  priority: '0',
  completion_notes: null,
  created_at: '2026-11-01T00:00:00Z',
};

describe('MeetingActionItemDialog', () => {
  beforeEach(() => {
    updateActionItem.mockReset();
    updateActionItem.mockResolvedValue({});
  });

  it('saves the rest without a field the server refuses and keeps it flagged', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    updateActionItem
      .mockRejectedValueOnce({
        response: { status: 422, data: { detail: [{ field: 'due_date', message: 'Invalid date format.' }] } },
      })
      .mockResolvedValue({});
    renderWithRouter(<MeetingActionItemDialog item={item} assignees={[]} onClose={vi.fn()} onSaved={onSaved} />);

    await user.click(await screen.findByRole('button', { name: 'Save' }));

    const due = screen.getByLabelText('Due date');
    await waitFor(() => expect(due).toHaveAccessibleDescription('Due date needs a valid date.'));
    expect(due).toHaveAttribute('aria-invalid', 'true');
    expect(updateActionItem).toHaveBeenCalledTimes(2);
    const retried = updateActionItem.mock.calls[1]?.[1] as Record<string, unknown>;
    expect('due_date' in retried).toBe(false);
    expect(retried.description).toBe('Order new hose');
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(/Saved, except the field flagged below/);
  });

  it('tells the page to refresh behind it after a partial save', async () => {
    const user = userEvent.setup();
    const onSavedExcept = vi.fn();
    updateActionItem
      .mockRejectedValueOnce({
        response: { status: 422, data: { detail: [{ field: 'due_date', message: 'Invalid date format.' }] } },
      })
      .mockResolvedValue({});
    renderWithRouter(
      <MeetingActionItemDialog
        item={item}
        assignees={[]}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onSavedExcept={onSavedExcept}
      />
    );

    await user.click(await screen.findByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSavedExcept).toHaveBeenCalledTimes(1));
  });

  it('asks before Cancel discards an edit', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithRouter(<MeetingActionItemDialog item={item} assignees={[]} onClose={onClose} onSaved={vi.fn()} />);

    await user.type(await screen.findByLabelText(/^Description/), ' and nozzles');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^Description/)).toHaveValue('Order new hose and nozzles');
  });

  it('closes at once when nothing changed', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithRouter(<MeetingActionItemDialog item={item} assignees={[]} onClose={onClose} onSaved={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });
});
