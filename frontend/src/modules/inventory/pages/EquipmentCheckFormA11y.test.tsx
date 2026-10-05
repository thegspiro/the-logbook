/**
 * What a screen reader is told about an answer on the check form (W46-7).
 *
 * Every item carries the same "Pass", "Fail" and "Note" labels, and which one
 * was chosen was shown by colour alone. The quantity box had no name at all.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { EquipmentCheckTemplate } from '../types/equipmentCheck';

const mockGetLastCheckResults = vi.fn();
const mockSubmitCheck = vi.fn();
const mockUpdateDeployedLot = vi.fn();
const mockUploadCheckItemPhotos = vi.fn();
const mockListPendingChecks = vi.fn();
const mockDequeueCheck = vi.fn();
const mockMarkCheckSubmitted = vi.fn();
const mockMarkPhotosUploaded = vi.fn();
const mockSwapItemLot = vi.fn();
const mockGetItemLots = vi.fn();
const mockEnqueueCheck = vi.fn();

// Equipment-check calls moved to modules/inventory when checklists
// became an Inventory feature; the scheduling service re-exports it.
vi.mock('@/modules/inventory/services/equipmentCheckApi', () => ({
  equipmentCheckService: {
    getLastCheckResults: (...a: unknown[]) => mockGetLastCheckResults(...a) as unknown,
    submitEquipmentCheck: (...a: unknown[]) => mockSubmitCheck(...a) as unknown,
    submitStandaloneCheck: (...a: unknown[]) => mockSubmitCheck(...a) as unknown,
    getEquipmentCheck: vi.fn(),
    updateDeployedLot: (...a: unknown[]) => mockUpdateDeployedLot(...a) as unknown,
    uploadCheckItemPhotos: (...a: unknown[]) => mockUploadCheckItemPhotos(...a) as unknown,
    swapItemLot: (...a: unknown[]) => mockSwapItemLot(...a) as unknown,
  },
}));

vi.mock('../../../services/inventoryService', () => ({
  inventoryService: { getItemLots: (...a: unknown[]) => mockGetItemLots(...a) as unknown },
}));

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
vi.mock('../../../utils/offlineQueue', () => ({
  enqueueCheck: (...a: unknown[]) => mockEnqueueCheck(...a) as unknown,
  listOwnPendingChecks: (...a: unknown[]) => mockListPendingChecks(...a) as unknown,
  dequeueCheck: (...a: unknown[]) => mockDequeueCheck(...a) as unknown,
  markCheckSubmitted: (...a: unknown[]) => mockMarkCheckSubmitted(...a) as unknown,
  markPhotosUploaded: (...a: unknown[]) => mockMarkPhotosUploaded(...a) as unknown,
  markRetry: vi.fn(),
  pendingCount: vi.fn().mockResolvedValue(0),
}));

const mockCheckPermission = vi.fn(() => true);
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: () => ({
    checkPermission: (...a: unknown[]) => mockCheckPermission(...a) as unknown,
  }),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import EquipmentCheckForm from './EquipmentCheckForm';

const template: EquipmentCheckTemplate = {
  id: 'tmpl-1',
  organizationId: 'org-1',
  name: 'Engine Daily Check',
  checkTiming: 'start_of_shift',
  templateType: 'equipment',
  isActive: true,
  sortOrder: 0,
  contentRevision: 1,
  compartments: [
    {
      id: 'c-1',
      templateId: 'tmpl-1',
      name: 'Cab',
      sortOrder: 0,
      items: [
        {
          id: 'ti-radio',
          compartmentId: 'c-1',
          name: 'Portable radio',
          sortOrder: 0,
          checkType: 'function',
          isRequired: true,
          hasExpiration: false,
          expirationWarningDays: 30,
        },
        {
          id: 'ti-scba',
          compartmentId: 'c-1',
          name: 'SCBA',
          sortOrder: 1,
          checkType: 'count',
          isRequired: true,
          requiredQuantity: 4,
          expectedQuantity: 4,
          hasExpiration: false,
          expirationWarningDays: 30,
        },
      ],
    },
  ],
};

describe('EquipmentCheckForm answers, as announced', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockGetLastCheckResults.mockReset();
    mockGetLastCheckResults.mockResolvedValue({});
    mockListPendingChecks.mockReset();
    mockListPendingChecks.mockResolvedValue([]);
    mockGetItemLots.mockReset();
    mockGetItemLots.mockResolvedValue([]);
    mockCheckPermission.mockReset();
    mockCheckPermission.mockReturnValue(true);
  });

  it("names each item's answers after the item and says which one is held", async () => {
    const user = userEvent.setup();
    renderWithRouter(<EquipmentCheckForm shiftId="shift-1" template={template} />);

    const radio = await screen.findByRole('group', { name: 'Portable radio' });
    const pass = within(radio).getByRole('button', { name: 'Pass' });
    const fail = within(radio).getByRole('button', { name: 'Fail' });
    expect(pass).toHaveAttribute('aria-pressed', 'false');
    expect(fail).toHaveAttribute('aria-pressed', 'false');

    await user.click(fail);

    const failed = screen.getByRole('group', { name: 'Portable radio' });
    expect(within(failed).getByRole('button', { name: 'Fail' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(failed).getByRole('button', { name: 'Pass' })).toHaveAttribute('aria-pressed', 'false');
    // The two answers only offered once an item has failed report their state too.
    expect(within(failed).getByRole('button', { name: /Not on truck/ })).toHaveAttribute('aria-pressed', 'false');
    expect(within(failed).getByRole('button', { name: /Out of service/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('names the quantity box after the item it counts', async () => {
    renderWithRouter(<EquipmentCheckForm shiftId="shift-1" template={template} />);

    const scba = await screen.findByRole('group', { name: 'SCBA' });
    expect(within(scba).getByRole('spinbutton', { name: 'SCBA quantity found' })).toBeInTheDocument();
    expect(within(scba).getByRole('button', { name: /Not on truck/ })).toHaveAttribute('aria-pressed', 'false');
  });
});
