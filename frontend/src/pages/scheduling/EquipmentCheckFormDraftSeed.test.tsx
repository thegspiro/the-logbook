/**
 * The carried-count seed must not overwrite a restored draft.
 *
 * The last-check effect runs on mount and deliberately omits `results` from
 * its deps, so any `results` read inside its promise callback is the
 * mount-render `{}` forever. The IndexedDB draft restore resolves in the
 * window between that request going out and its response arriving, so a guard
 * written against the closure value sees "nothing entered yet" and replaces a
 * truck check the crew was part-way through — which the autosave effect then
 * writes back over the draft itself.
 *
 * The existing revision-reconciliation suite cannot catch this: it stubs
 * `getLastCheckResults` to `{}`, so no seed is ever built.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { renderWithRouter } from '../../test/utils';

const { loadEquipmentCheckDraft, getLastCheckResults, authState } = vi.hoisted(() => ({
  loadEquipmentCheckDraft: vi.fn(),
  getLastCheckResults: vi.fn(),
  // One frozen object for the life of the suite. Returning a fresh object per
  // call — as the sibling suites do — invalidates the `draftIdentity` memo on
  // every render, so the draft effect re-runs continuously and re-restores the
  // draft after anything overwrites it. That masks this defect completely.
  // Real zustand hands back a stable reference.
  authState: { user: { id: 'user-1', organization_id: 'org-1' }, checkPermission: () => true },
}));

vi.mock('../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getLastCheckResults,
    getLastCheckSeals: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock('../../services/inventoryService', () => ({ inventoryService: { getItemLots: vi.fn() } }));
vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
vi.mock('../../utils/offlineQueue', () => ({
  listPendingChecks: vi.fn().mockResolvedValue([]),
  pendingCount: vi.fn().mockResolvedValue(0),
  CHECK_QUEUE_MAX_RETRIES: 5,
}));
vi.mock('../../utils/equipmentCheckDrafts', () => ({
  loadEquipmentCheckDraft,
  saveEquipmentCheckDraft: vi.fn().mockResolvedValue(undefined),
  deleteEquipmentCheckDraft: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../stores/authStore', () => ({ useAuthStore: () => authState }));

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

let releaseSeed: (() => void) | null = null;

describe('carried-count seed vs restored draft', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('has_session', '1');
    loadEquipmentCheckDraft.mockReset();
    getLastCheckResults.mockReset();
    // Held open, released by the test. The defect is an ordering one: IndexedDB
    // is local and answers first; the network answers second and overwrites
    // what the draft restored. Resolving both in the same tick lets the draft
    // land last, hiding the bug — the first version of this test did exactly
    // that and passed against broken code. A timer would only make that race
    // likelier to fall the right way, not certain, so the test drives the
    // ordering explicitly instead.
    releaseSeed = null;
    getLastCheckResults.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseSeed = () => resolve({ 'item-1': { quantity_found: 4 } });
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

  it('keeps the count the crew recorded rather than reseeding from the truck total', async () => {
    renderWithRouter(<EquipmentCheckForm template={template as never} shiftId="shift-1" />);

    const qty = await screen.findByRole('spinbutton');
    // The crew's own restored answer lands first, from IndexedDB.
    await waitFor(() => expect(qty).toHaveValue(7));

    // Now let the network answer arrive. This is the moment the defect fired:
    // the seed was written straight over the restored draft.
    await act(async () => {
      releaseSeed?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // 7 is the crew's count; 4 is the carried on-truck total that must not
    // replace it.
    expect(qty).toHaveValue(7);
  });
});
