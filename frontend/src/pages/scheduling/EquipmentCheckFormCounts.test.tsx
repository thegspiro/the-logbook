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
const mockUpdateDeployedLot = vi.fn();

vi.mock('../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getLastCheckResults: (...a: unknown[]) => mockGetLastCheckResults(...a) as unknown,
    submitEquipmentCheck: (...a: unknown[]) => mockSubmitCheck(...a) as unknown,
    submitStandaloneCheck: (...a: unknown[]) => mockSubmitCheck(...a) as unknown,
    getEquipmentCheck: vi.fn(),
    updateDeployedLot: (...a: unknown[]) => mockUpdateDeployedLot(...a) as unknown,
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
    mockUpdateDeployedLot.mockResolvedValue({
      templateItemId: 'ti-1',
      itemName: '4x4 Gauze',
      isShort: false,
      lots: [{ id: 'dl-1', lotNumber: 'NEW-9', expirationDate: '2028-01-31', quantity: 2, isExpired: false }],
    });
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
  });

  it('states the carry-over once rather than on every row', async () => {
    render({ quantityOnTruck: 4 });
    await screen.findByDisplayValue('4');

    // One standing rule about the whole check, not sixty pieces of chrome.
    expect(screen.getByText(/Counts are carried over from the last recorded count/)).toBeInTheDocument();
  });

  it('confirms an unchanged count when the field is touched', async () => {
    const user = userEvent.setup();
    render({ quantityOnTruck: 4 });
    const field = await screen.findByDisplayValue('4');

    await user.click(field);

    await waitFor(() => {
      expect(screen.getByText('1/1')).toBeInTheDocument();
    });
    // Nothing left carried, so the explanation retires itself.
    expect(screen.queryByText(/Counts are carried over/)).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('4')).toBeInTheDocument();
  });

  it('keeps the photo control with the note it evidences', async () => {
    const user = userEvent.setup();
    render({ quantityOnTruck: 4 });
    await screen.findByDisplayValue('4');

    // Collapsed, the row carries two controls rather than four.
    expect(screen.queryByRole('button', { name: /Add photo/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Note$/ }));

    expect(await screen.findByRole('button', { name: /Add photo/ })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Notes for this item...')).toBeInTheDocument();
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

  it('shows every lot aboard with its own date', async () => {
    render({
      hasExpiration: true,
      expirationDate: '2028-01-01',
      lotsAboard: [
        { id: 'dl-1', lotNumber: 'LOT-A', expirationDate: '2026-11-30', quantity: 1, isExpired: false },
        { id: 'dl-2', lotNumber: 'LOT-B', expirationDate: '2027-06-30', quantity: 1, isExpired: false },
      ],
    });

    // A drug bag holding two boxes holds two dates; one line cannot say that.
    expect(await screen.findByText('LOT-A')).toBeInTheDocument();
    expect(screen.getByText('LOT-B')).toBeInTheDocument();
    expect(screen.getByText(/Expires.*2026/)).toBeInTheDocument();
    expect(screen.getByText(/Expires.*2027/)).toBeInTheDocument();
  });

  it('judges expiry on the soonest date aboard, not the position column', async () => {
    render({
      hasExpiration: true,
      // The column says next decade; a box in the bag expired yesterday.
      expirationDate: '2030-01-01',
      lotsAboard: [
        { id: 'dl-1', lotNumber: 'LOT-OLD', expirationDate: '2020-01-01', quantity: 1, isExpired: true },
        { id: 'dl-2', lotNumber: 'LOT-NEW', expirationDate: '2030-01-01', quantity: 1, isExpired: false },
      ],
    });

    expect(await screen.findByText('EXPIRED')).toBeInTheDocument();
  });

  it('records a corrected date without leaving the check', async () => {
    const user = userEvent.setup();
    render({
      hasExpiration: true,
      lotsAboard: [{ id: 'dl-1', lotNumber: 'LOT-A', expirationDate: '2026-11-30', quantity: 2, isExpired: false }],
    });
    await screen.findByText('LOT-A');

    await user.click(screen.getByRole('button', { name: /Correct/ }));
    const dateField = screen.getByLabelText('Expiration');
    await user.clear(dateField);
    await user.type(dateField, '2028-01-31');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // The record follows the box the crew is holding, in the same act.
    await waitFor(() => {
      expect(mockUpdateDeployedLot).toHaveBeenCalledWith('ti-1', 'dl-1', {
        quantity: 2,
        lotNumber: 'LOT-A',
        expirationDate: '2028-01-31',
      });
    });
    expect(await screen.findByText('NEW-9')).toBeInTheDocument();
  });
});
