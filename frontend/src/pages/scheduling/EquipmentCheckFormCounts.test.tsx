/**
 * How a quantity item arrives pre-filled, and what that does (and does not)
 * count as having been checked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';

const mockGetLastCheckResults = vi.fn();
const mockSubmitCheck = vi.fn();

vi.mock('../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getLastCheckResults: (...a: unknown[]) => mockGetLastCheckResults(...a) as unknown,
    submitEquipmentCheck: (...a: unknown[]) => mockSubmitCheck(...a) as unknown,
    submitStandaloneCheck: (...a: unknown[]) => mockSubmitCheck(...a) as unknown,
    getEquipmentCheck: vi.fn(),
    uploadCheckItemPhoto: vi.fn(),
    swapItemLot: vi.fn(),
  },
}));

vi.mock('../../services/inventoryService', () => ({
  inventoryService: { getItemLots: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
vi.mock('../../utils/offlineQueue', () => ({
  enqueueCheck: vi.fn(),
  listPendingChecks: vi.fn().mockResolvedValue([]),
  dequeueCheck: vi.fn(),
  markRetry: vi.fn(),
  pendingCount: vi.fn().mockResolvedValue(0),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import EquipmentCheckForm from './EquipmentCheckForm';

const template = (itemOverrides = {}) => ({
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
          id: 'ti-1',
          compartmentId: 'c-1',
          name: '4x4 Gauze',
          sortOrder: 0,
          checkType: 'quantity',
          isRequired: true,
          requiredQuantity: 4,
          expectedQuantity: 4,
          hasExpiration: false,
          expirationWarningDays: 30,
          ...itemOverrides,
        },
      ],
    },
  ],
});

describe('EquipmentCheckForm quantity seeding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockGetLastCheckResults.mockResolvedValue({});
    mockSubmitCheck.mockResolvedValue({ id: 'check-1', items: [] });
  });

  const render = (itemOverrides = {}) =>
    renderWithRouter(<EquipmentCheckForm shiftId="shift-1" template={template(itemOverrides) as never} />);

  it('starts from the running on-truck count, not the last check', async () => {
    // The last check saw four; two were used mid-shift and recorded against
    // the truck. The crew should open this at two.
    mockGetLastCheckResults.mockResolvedValue({ 'ti-1': { quantity_found: 4 } });
    render({ quantityOnTruck: 2 });

    expect(await screen.findByDisplayValue('2')).toBeInTheDocument();
  });

  it('falls back to the last check when nothing has been counted', async () => {
    mockGetLastCheckResults.mockResolvedValue({ 'ti-1': { quantity_found: 3 } });
    render();

    expect(await screen.findByDisplayValue('3')).toBeInTheDocument();
  });

  it('shows the count against par with the catalog unit', async () => {
    render({ quantityOnTruck: 2, unitOfMeasure: 'Box' });

    expect(await screen.findByText('2/4 Box')).toBeInTheDocument();
  });

  it('does not count a carried-over number as checked', async () => {
    render({ quantityOnTruck: 4 });
    await screen.findByDisplayValue('4');

    // The whole safety point: a pre-filled number is a starting point, so the
    // progress counter must not report the check as done before anyone looked.
    expect(screen.getByText('0/1')).toBeInTheDocument();
    expect(screen.getByText(/Carried over/)).toBeInTheDocument();
  });

  it('confirms an unchanged count in one tap', async () => {
    const user = userEvent.setup();
    render({ quantityOnTruck: 4 });
    await screen.findByDisplayValue('4');

    await user.click(screen.getByRole('button', { name: /Carried over/ }));

    await waitFor(() => {
      expect(screen.getByText('1/1')).toBeInTheDocument();
    });
    expect(screen.queryByText(/Carried over/)).not.toBeInTheDocument();
  });

  it('treats an adjustment as the check itself', async () => {
    const user = userEvent.setup();
    render({ quantityOnTruck: 4 });
    await screen.findByDisplayValue('4');

    await user.click(screen.getByRole('button', { name: /Decrease 4x4 Gauze quantity/ }));

    await waitFor(() => {
      expect(screen.getByText('1/1')).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue('3')).toBeInTheDocument();
  });
});
