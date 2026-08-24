import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '../../../test/utils';

const getRooms = vi.fn();
const createRoom = vi.fn();
const updateRoom = vi.fn();
const deleteRoom = vi.fn();

vi.mock('../../../services/api', () => ({
  facilitiesService: {
    getRooms: (...args: unknown[]) => getRooms(...args) as unknown,
    createRoom: (...args: unknown[]) => createRoom(...args) as unknown,
    updateRoom: (...args: unknown[]) => updateRoom(...args) as unknown,
    deleteRoom: (...args: unknown[]) => deleteRoom(...args) as unknown,
  },
}));

import RoomsSection from './RoomsSection';

const office = {
  id: 'office',
  facilityId: 'facility-1',
  name: 'Volunteer Office',
  roomType: 'office',
  parentRoomId: null,
  createdAt: '2026-08-16T00:00:00Z',
  updatedAt: '2026-08-16T00:00:00Z',
};

const storage = {
  id: 'storage',
  facilityId: 'facility-1',
  name: "Quartermaster's Storage",
  roomType: 'storage',
  parentRoomId: 'office',
  createdAt: '2026-08-16T00:00:00Z',
  updatedAt: '2026-08-16T00:00:00Z',
};

function renderSection(canCreate = true, canEdit = true, canDelete = true) {
  return renderWithRouter(
    <RoomsSection facilityId="facility-1" canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />
  );
}

describe('RoomsSection nesting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRooms.mockResolvedValue([storage, office]);
    createRoom.mockResolvedValue(storage);
    updateRoom.mockResolvedValue(storage);
    deleteRoom.mockResolvedValue(undefined);
  });

  it('requests the whole facility so nested rooms are not cut off by paging', async () => {
    renderSection();

    await screen.findByText('Volunteer Office');
    expect(getRooms).toHaveBeenCalledWith({ facility_id: 'facility-1', limit: 500 });
  });

  it('labels a room that contains others with its sub-room count', async () => {
    renderSection();

    expect(await screen.findByText('1 sub-room')).toBeInTheDocument();
  });

  it('lets an editor change rooms without exposing manager-only deletion', async () => {
    renderSection(true, true, false);

    expect(await screen.findByRole('button', { name: 'Edit room Volunteer Office' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete room Volunteer Office' })).not.toBeInTheDocument();
  });

  it('lets a creator add rooms without exposing edit or delete controls', async () => {
    renderSection(true, false, false);

    expect(await screen.findByRole('button', { name: 'Add Room' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit room Volunteer Office' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete room Volunteer Office' })).not.toBeInTheDocument();
  });

  it('creates a sub-room with the containing room as parent', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(await screen.findByRole('button', { name: 'Add a room inside Volunteer Office' }));
    await user.type(screen.getByLabelText('Name *'), 'Gear Cage');
    await user.click(screen.getByRole('button', { name: /Add$/ }));

    await waitFor(() => {
      expect(createRoom).toHaveBeenCalledWith({
        facility_id: 'facility-1',
        name: 'Gear Cage',
        room_type: 'other',
        zone_classification: 'unclassified',
        parent_room_id: 'office',
      });
    });
  });

  it('keeps a room and its own sub-rooms out of its parent picker', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(await screen.findByRole('button', { name: 'Edit room Volunteer Office' }));

    const parentSelect = screen.getByLabelText('Located Inside');
    const optionValues = within(parentSelect)
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value);
    expect(optionValues).not.toContain('office');
    expect(optionValues).not.toContain('storage');
    expect(optionValues).toEqual(['']);
  });

  it('sends an explicit null when a room is moved back to the top level', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(await screen.findByRole('button', { name: "Edit room Quartermaster's Storage" }));
    await user.selectOptions(screen.getByLabelText('Located Inside'), '');
    await user.click(screen.getByRole('button', { name: /Update/ }));

    await waitFor(() => {
      expect(updateRoom).toHaveBeenCalledWith(
        'storage',
        expect.objectContaining({ parent_room_id: null, name: "Quartermaster's Storage" })
      );
    });
  });

  describe('depth cap on the parent picker', () => {
    const makeRoom = (id: string, name: string, parentRoomId: string | null) => ({
      id,
      facilityId: 'facility-1',
      name,
      roomType: 'other',
      parentRoomId,
      createdAt: '2026-08-16T00:00:00Z',
      updatedAt: '2026-08-16T00:00:00Z',
    });

    // A chain four levels deep (alpha › bravo › charlie › delta) plus a
    // separate top-level room (xray) holding one sub-room (yankee).
    beforeEach(() => {
      getRooms.mockResolvedValue([
        makeRoom('alpha', 'Alpha', null),
        makeRoom('bravo', 'Bravo', 'alpha'),
        makeRoom('charlie', 'Charlie', 'bravo'),
        makeRoom('delta', 'Delta', 'charlie'),
        makeRoom('xray', 'X-Ray', null),
        makeRoom('yankee', 'Yankee', 'xray'),
      ]);
    });

    const parentOptionValues = () =>
      within(screen.getByLabelText('Located Inside'))
        .getAllByRole('option')
        .map((option) => (option as HTMLOptionElement).value);

    it('counts the edited room subtree against the cap, not just the parent depth', async () => {
      // Moving X-Ray (which holds Yankee, subtree height 2) under Delta
      // (backend depth 4) would make Yankee level 6 — the backend rejects it,
      // so the picker must not offer Delta. Charlie (depth 3) is the deepest
      // legal parent: 3 + 2 = 5 = MAX_ROOM_NESTING_DEPTH.
      const user = userEvent.setup();
      renderSection();

      await user.click(await screen.findByRole('button', { name: 'Edit room X-Ray' }));

      const optionValues = parentOptionValues();
      expect(optionValues).toContain('charlie');
      expect(optionValues).not.toContain('delta');
      expect(optionValues).not.toContain('xray');
      expect(optionValues).not.toContain('yankee');
    });

    it('still offers deep parents to a room with no sub-rooms', async () => {
      // Yankee alone is subtree height 1, so Delta (depth 4) is fine:
      // 4 + 1 = 5 = MAX_ROOM_NESTING_DEPTH.
      const user = userEvent.setup();
      renderSection();

      await user.click(await screen.findByRole('button', { name: 'Edit room Yankee' }));

      expect(parentOptionValues()).toContain('delta');
    });
  });

  it('warns that sub-rooms survive a delete, then deletes only the room', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(await screen.findByRole('button', { name: 'Delete room Volunteer Office' }));

    expect(await screen.findByText(/sub-room will move up a level/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(deleteRoom).toHaveBeenCalledWith('office');
    });
  });

  it('counts only the rooms that actually move up, not the whole subtree', async () => {
    // The backend re-parents `WHERE parent_room_id = room_id`, so a grandchild
    // keeps its own parent and rides along inside that subtree. Counting
    // descendants told the officer "3 sub-rooms will move up a level" when 2
    // do, on a dialog whose whole job is to state the consequence of something
    // irreversible -- and disagreed with the row badge directly above it.
    const lockerCage = {
      id: 'locker-cage',
      facilityId: 'facility-1',
      name: 'Locker Cage',
      roomType: 'storage',
      parentRoomId: 'storage',
      createdAt: '2026-08-16T00:00:00Z',
      updatedAt: '2026-08-16T00:00:00Z',
    };
    const recordsCloset = {
      id: 'records-closet',
      facilityId: 'facility-1',
      name: 'Records Closet',
      roomType: 'storage',
      parentRoomId: 'office',
      createdAt: '2026-08-16T00:00:00Z',
      updatedAt: '2026-08-16T00:00:00Z',
    };
    getRooms.mockResolvedValue([office, storage, lockerCage, recordsCloset]);

    const user = userEvent.setup();
    renderSection();

    await user.click(await screen.findByRole('button', { name: 'Delete room Volunteer Office' }));

    expect(await screen.findByText(/2 sub-rooms will move up a level/)).toBeInTheDocument();
    expect(screen.queryByText(/3 sub-rooms will move up a level/)).not.toBeInTheDocument();
  });
});
