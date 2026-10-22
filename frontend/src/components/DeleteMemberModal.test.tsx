import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DeletionImpact } from '../types/user';

const mockGetDeletionImpact = vi.fn();
vi.mock('../services/api', () => ({
  userService: {
    getDeletionImpact: (...args: unknown[]) => mockGetDeletionImpact(...args) as unknown,
  },
}));

// Import AFTER mocks
import { DeleteMemberModal } from './DeleteMemberModal';

const MEMBER = {
  id: 'u7',
  username: 'jsmith',
  first_name: 'Jane',
  last_name: 'Smith',
  status: 'active',
};

const IMPACT: DeletionImpact = {
  user_id: 'u7',
  full_name: 'Jane Smith',
  status: 'active',
  training_records: 4,
  inventory_items: 2,
  checked_out_items: 1,
  documents: 3,
  removed_records: [
    { table: 'event_rsvps', label: 'Event RSVPs', count: 12 },
    { table: 'shift_assignments', label: 'Shift assignments', count: 6 },
    { table: 'training_records', label: 'Training records', count: 4 },
  ],
  total_records: 22,
};

describe('DeleteMemberModal', () => {
  const onClose = vi.fn();
  const onSoftDelete = vi.fn();
  const onHardDelete = vi.fn();

  beforeEach(() => {
    mockGetDeletionImpact.mockReset();
    mockGetDeletionImpact.mockResolvedValue(structuredClone(IMPACT));
    onClose.mockReset();
    onSoftDelete.mockReset();
    onSoftDelete.mockResolvedValue(undefined);
    onHardDelete.mockReset();
    onHardDelete.mockResolvedValue(undefined);
  });

  function renderModal() {
    return render(
      <DeleteMemberModal
        isOpen
        onClose={onClose}
        member={MEMBER}
        onSoftDelete={onSoftDelete}
        onHardDelete={onHardDelete}
      />
    );
  }

  async function openHardDeleteTab() {
    const user = userEvent.setup();
    renderModal();
    await user.click(await screen.findByRole('tab', { name: 'Permanently Delete' }));
    return user;
  }

  it('lists every kind of record the server says a permanent delete removes', async () => {
    await openHardDeleteTab();

    const list = screen.getByRole('list', { name: 'Records permanently deleted' });
    expect(within(list).getByText('Event RSVPs')).toBeInTheDocument();
    expect(within(list).getByText('12')).toBeInTheDocument();
    expect(within(list).getByText('Shift assignments')).toBeInTheDocument();
    expect(within(list).getByText('Training records')).toBeInTheDocument();
    expect(within(list).getByText('22')).toBeInTheDocument();
  });

  it('says held inventory goes back to stock and other members’ records are kept', async () => {
    await openHardDeleteTab();

    expect(screen.getByText(/3 inventory items they hold will be returned to stock/)).toBeInTheDocument();
    expect(screen.getByText(/3 uploaded documents will stay/)).toBeInTheDocument();
    expect(screen.getByText(/Records belonging to other members/)).toBeInTheDocument();
    // The old copy claimed inventory assignments were destroyed.
    expect(screen.queryByText(/inventory assignments will be permanently deleted/)).not.toBeInTheDocument();
  });

  it('says so when nothing but the account goes', async () => {
    mockGetDeletionImpact.mockReset();
    mockGetDeletionImpact.mockResolvedValue({
      ...structuredClone(IMPACT),
      removed_records: [],
      total_records: 0,
      inventory_items: 0,
      checked_out_items: 0,
      documents: 0,
    });

    await openHardDeleteTab();

    expect(screen.getByText(/No records besides the member/)).toBeInTheDocument();
    expect(screen.queryByText(/returned to stock/)).not.toBeInTheDocument();
  });

  it('still requires the full name before permanently deleting', async () => {
    const user = await openHardDeleteTab();
    const button = screen.getByRole('button', { name: 'Permanently Delete' });

    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText(/to confirm/), 'Jane');
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText(/to confirm/), ' Smith');
    expect(button).toBeEnabled();
    await user.click(button);

    expect(onHardDelete).toHaveBeenCalledWith('u7');
  });

  it('tells the officer deactivating takes the member off future shifts', async () => {
    renderModal();

    expect(await screen.findByText(/taken off any shifts that have not started yet/)).toBeInTheDocument();
  });
});
