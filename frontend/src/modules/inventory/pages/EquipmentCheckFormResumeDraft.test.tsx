/**
 * EC2-10: "Continue checklist" passes the incomplete check's id, and the form
 * replaced its answers with the server's copy of that check. The IndexedDB
 * draft — everything answered since that submit — restores first, being
 * local, and was then overwritten; autosave wrote the older answers back over
 * the draft, though the leave dialog promises progress is kept. A draft only
 * exists after the last submit (a successful submit deletes it), so the
 * crew's answers in it win, item by item.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';

const { loadEquipmentCheckDraft, getLastCheckResults, getEquipmentCheck, authState } = vi.hoisted(() => ({
  loadEquipmentCheckDraft: vi.fn(),
  getLastCheckResults: vi.fn(),
  getEquipmentCheck: vi.fn(),
  // One frozen object for the life of the suite. Returning a fresh object per
  // call — as the sibling suites do — invalidates the `draftIdentity` memo on
  // every render, so the draft effect re-runs continuously and re-restores the
  // draft after anything overwrites it. That masks this defect completely.
  // Real zustand hands back a stable reference.
  authState: { user: { id: 'user-1', organization_id: 'org-1' }, checkPermission: () => true },
}));

vi.mock('@/modules/inventory/services/equipmentCheckApi', () => ({
  equipmentCheckService: {
    getLastCheckResults,
    getEquipmentCheck,
    getLastCheckSeals: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock('../../../services/inventoryService', () => ({ inventoryService: { getItemLots: vi.fn() } }));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
vi.mock('../../../utils/offlineQueue', () => ({
  listOwnPendingChecks: vi.fn().mockResolvedValue([]),
  pendingCount: vi.fn().mockResolvedValue(0),
  CHECK_QUEUE_MAX_RETRIES: 5,
}));
vi.mock('../../../utils/equipmentCheckDrafts', () => ({
  loadEquipmentCheckDraft,
  saveEquipmentCheckDraft: vi.fn().mockResolvedValue(undefined),
  deleteEquipmentCheckDraft: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../stores/authStore', () => ({ useAuthStore: () => authState }));

import EquipmentCheckForm from './EquipmentCheckForm';

const template = {
  id: 'tmpl-1',
  organizationId: 'org-1',
  name: 'Daily check',
  checkTiming: 'start_of_shift',
  templateType: 'equipment',
  isActive: true,
  sortOrder: 0,
  contentRevision: 2,
  compartments: [
    {
      id: 'comp-1',
      templateId: 'tmpl-1',
      name: 'Airway bag',
      sortOrder: 0,
      items: [
        {
          id: 'item-1',
          compartmentId: 'comp-1',
          name: 'Oxygen cylinder',
          sortOrder: 0,
          checkType: 'count',
          isRequired: true,
          hasExpiration: false,
          expirationWarningDays: 30,
          quantityOnTruck: 4,
        },
      ],
    },
  ],
};

let releaseRecord: (() => void) | null = null;

describe('resuming an incomplete check with a newer draft', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('has_session', '1');
    loadEquipmentCheckDraft.mockReset();
    getLastCheckResults.mockReset();
    getEquipmentCheck.mockReset();
    getLastCheckResults.mockResolvedValue({});
    // Held, like the seed in EquipmentCheckFormDraftSeed: the local draft
    // answers first and the network second, which is the order that lost work.
    releaseRecord = null;
    getEquipmentCheck.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseRecord = () =>
            resolve({
              id: 'check-1',
              notes: null,
              items: [{ templateItemId: 'item-1', status: 'pass', quantityFound: 3, notes: null }],
            });
        })
    );
    loadEquipmentCheckDraft.mockResolvedValue({
      updatedAt: Date.now(),
      contents: {
        contentRevision: 2,
        results: { 'item-1': { status: 'pass', quantityFound: 7 } },
        overallNotes: '',
        itemDefinitions: {
          'item-1': { name: 'Oxygen cylinder', compartmentId: 'comp-1', checkType: 'count', hasExpiration: false },
        },
        seals: {},
        sealDefinitions: {},
      },
    });
  });

  it('keeps what the crew answered since the last submit', async () => {
    renderWithRouter(<EquipmentCheckForm template={template as never} shiftId="shift-1" existingCheckId="check-1" />);
    const qty = await screen.findByRole('spinbutton');
    await waitFor(() => expect(qty).toHaveValue(7));

    await act(async () => {
      releaseRecord?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(qty).toHaveValue(7);
  });
});
