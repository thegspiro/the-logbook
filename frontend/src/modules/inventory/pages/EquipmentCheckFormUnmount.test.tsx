/**
 * Async handlers in this form must not act once the member has left it.
 *
 * Every effect that starts an async read in `EquipmentCheckForm` sets a
 * `cancelled` flag in its cleanup and checks it before touching state — five
 * of them say so in a comment. Two paths did not, and the draft-recovery one
 * is visible to a member rather than only to a test runner: a recovery that
 * fails after they have navigated away raised "Draft recovery is unavailable"
 * over whatever page they had moved on to, describing a form no longer on
 * screen.
 *
 * The rejection is held open and released after `unmount()` deliberately.
 * Rejecting in the same tick as the render lets the handler run while the
 * component is still mounted, which is the passing case and proves nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';

const { loadEquipmentCheckDraft, getLastCheckResults, pendingCount, online, authState } = vi.hoisted(() => ({
  loadEquipmentCheckDraft: vi.fn(),
  getLastCheckResults: vi.fn(),
  pendingCount: vi.fn(),
  // Mutable so one test can go offline. Online mounts an auto-sync that reads
  // the queue count itself and holds the banner on "Syncing queued checks…",
  // which hides the mount-effect read this suite is about.
  online: { value: true },
  // One frozen object for the life of the suite, as the sibling draft suites
  // do: a fresh object per call invalidates the `draftIdentity` memo on every
  // render and re-runs the effect under test continuously.
  authState: { user: { id: 'user-1', organization_id: 'org-1' }, checkPermission: () => true },
}));

const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: (...a: unknown[]): void => {
      mockToastError(...a);
    },
  },
}));

vi.mock('@/modules/inventory/services/equipmentCheckApi', () => ({
  equipmentCheckService: {
    getLastCheckResults,
    getLastCheckSeals: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock('../../../services/inventoryService', () => ({ inventoryService: { getItemLots: vi.fn() } }));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => online.value }));
vi.mock('../../../utils/offlineQueue', () => ({
  listPendingChecks: vi.fn().mockResolvedValue([]),
  pendingCount,
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
  contentRevision: 1,
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
          checkType: 'function',
          isRequired: true,
          hasExpiration: false,
          expirationWarningDays: 30,
        },
      ],
    },
  ],
};

describe('EquipmentCheckForm after the member has left it', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('has_session', '1');
    // Reset each mock before installing its default (CLAUDE.md pitfall #28):
    // an unconsumed one-shot survives vi.clearAllMocks() and is handed out
    // ahead of a later mockResolvedValue.
    loadEquipmentCheckDraft.mockReset();
    getLastCheckResults.mockReset();
    pendingCount.mockReset();
    mockToastError.mockReset();
    online.value = true;

    loadEquipmentCheckDraft.mockResolvedValue(null);
    getLastCheckResults.mockResolvedValue({});
    pendingCount.mockResolvedValue(0);
  });

  it('does not raise a draft-recovery error over the page the member moved on to', async () => {
    let failRecovery: (() => void) | null = null;
    loadEquipmentCheckDraft.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          failRecovery = () => {
            reject(new Error('IndexedDB unavailable'));
          };
        })
    );

    const { unmount } = renderWithRouter(<EquipmentCheckForm template={template as never} shiftId="shift-1" />);
    unmount();

    await act(async () => {
      failRecovery?.();
      // Let the rejection propagate through .catch and .finally.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('still reports a draft-recovery failure while the form is on screen', async () => {
    // The other half: guarding the toast must not silence it for the member
    // who is actually looking at the form.
    loadEquipmentCheckDraft.mockRejectedValue(new Error('IndexedDB unavailable'));

    renderWithRouter(<EquipmentCheckForm template={template as never} shiftId="shift-1" />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockToastError).toHaveBeenCalledWith('Draft recovery is unavailable; no prior answers were opened');
  });

  it('still shows the pending-queue count once it resolves on a live form', async () => {
    // The guard added to that effect must not cost the feature it guards.
    // Deliberately not a test of the unmounted case: React 19 does not warn on
    // setState after unmount, so in jsdom that path has no observable symptom
    // and a test asserting it would pass with or without the fix.
    online.value = false;
    let releaseCount: (() => void) | null = null;
    pendingCount.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseCount = () => {
            resolve(3);
          };
        })
    );

    renderWithRouter(<EquipmentCheckForm template={template as never} shiftId="shift-1" />);

    await act(async () => {
      releaseCount?.();
      await Promise.resolve();
    });

    expect(await screen.findByText('3 check(s) waiting to sync')).toBeInTheDocument();
  });
});
