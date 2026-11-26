/**
 * EC2-9: an item left unchecked was submitted with the number the form had
 * seeded into it — the truck's running total or the last check's count. The
 * server treats any quantity_found as a crew standing at the compartment
 * counting, so an incomplete check reset the truck's count and lots to a
 * number nobody took, and stored a quantity on a row nobody looked at.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

const mockGetLastCheckResults = vi.fn();
const mockSubmitCheck = vi.fn();

vi.mock('@/modules/inventory/services/equipmentCheckApi', () => ({
  equipmentCheckService: {
    getLastCheckResults: (...a: unknown[]) => mockGetLastCheckResults(...a) as unknown,
    getLastCheckSeals: vi.fn().mockResolvedValue({}),
    submitEquipmentCheck: (...a: unknown[]) => mockSubmitCheck(...a) as unknown,
    submitStandaloneCheck: (...a: unknown[]) => mockSubmitCheck(...a) as unknown,
    getEquipmentCheck: vi.fn(),
    uploadCheckItemPhotos: vi.fn(),
  },
}));
vi.mock('../../../services/inventoryService', () => ({ inventoryService: { getItemLots: vi.fn() } }));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
vi.mock('../../../utils/offlineQueue', () => ({
  enqueueCheck: vi.fn(),
  listOwnPendingChecks: vi.fn().mockResolvedValue([]),
  dequeueCheck: vi.fn(),
  markCheckSubmitted: vi.fn(),
  markPhotosUploaded: vi.fn(),
  markRetry: vi.fn(),
  pendingCount: vi.fn().mockResolvedValue(0),
}));
vi.mock('../../../utils/offlineQueueOwner', () => ({ isOwnedByCurrentMember: () => true }));
vi.mock('../../../stores/authStore', () => ({ useAuthStore: () => ({ checkPermission: () => true }) }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import EquipmentCheckForm from './EquipmentCheckForm';

const template = {
  id: 'tmpl-1',
  organizationId: 'org-1',
  name: 'Engine 1 Daily',
  checkTiming: 'start_of_shift',
  apparatusId: 'app-1',
  isActive: true,
  sortOrder: 0,
  compartments: [
    {
      id: 'c-1',
      templateId: 'tmpl-1',
      name: 'Front Bumper',
      sortOrder: 0,
      items: [
        {
          id: 'ti-gauze',
          compartmentId: 'c-1',
          name: '4x4 Gauze',
          sortOrder: 0,
          checkType: 'count',
          isRequired: false,
          requiredQuantity: 4,
          expectedQuantity: 4,
          quantityOnTruck: 4,
          hasExpiration: false,
          expirationWarningDays: 30,
        },
        {
          id: 'ti-light',
          compartmentId: 'c-1',
          name: 'Portable light',
          sortOrder: 1,
          checkType: 'function',
          isRequired: true,
          hasExpiration: false,
          expirationWarningDays: 30,
        },
      ],
    },
  ],
};

describe('EquipmentCheckForm submitting an unchecked count', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockGetLastCheckResults.mockResolvedValue({ 'ti-gauze': { quantity_found: 4 } });
    mockSubmitCheck.mockResolvedValue({ id: 'check-1', items: [] });
  });

  it('sends no count for an item nobody counted', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EquipmentCheckForm shiftId="shift-1" template={template as never} />);
    // The seeded starting point is on screen, unanswered.
    await screen.findByDisplayValue('4');

    await user.click(screen.getByRole('button', { name: 'Pass' }));
    await user.click(screen.getByRole('button', { name: 'Submit Report' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Submit anyway' }));

    await waitFor(() => expect(mockSubmitCheck).toHaveBeenCalled());
    const payload = JSON.stringify(mockSubmitCheck.mock.calls[0]);
    const sent = (JSON.parse(payload) as unknown[]).find(
      (arg): arg is { items: { template_item_id: string; status: string; quantity_found?: number }[] } =>
        typeof arg === 'object' && arg !== null && 'items' in arg
    );
    const gauze = sent?.items.find((i) => i.template_item_id === 'ti-gauze');
    expect(gauze?.status).toBe('not_checked');
    expect(gauze?.quantity_found).toBeUndefined();
  });
});
