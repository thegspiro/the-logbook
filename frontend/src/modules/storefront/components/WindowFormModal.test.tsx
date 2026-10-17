import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '../../../test/utils';
import type { StoreOrderWindow } from '../types';

const createWindow = vi.fn();
const updateWindow = vi.fn();

vi.mock('../services/api', () => ({
  storefrontService: {
    createWindow: (...args: unknown[]) => createWindow(...args) as unknown,
    updateWindow: (...args: unknown[]) => updateWindow(...args) as unknown,
  },
}));

vi.mock('../../../hooks/useTimezone', () => ({
  useTimezone: () => 'UTC',
}));

import { WindowFormModal } from './WindowFormModal';

const fallOrder: StoreOrderWindow = {
  id: 'win-1',
  organizationId: 'org-1',
  name: 'Fall 2026 apparel order',
  description: 'Station shirts and hoodies',
  status: 'scheduled',
  opensAt: '2026-10-01T12:00:00Z',
  closesAt: '2026-10-15T12:00:00Z',
  autoOpen: true,
  autoClose: true,
  expectedDeliveryDate: '2026-11-01',
  pickupInstructions: 'Pick up at Station 1',
  includeAllProducts: true,
  notifyOnOpen: true,
  notes: 'Vendor quote attached',
  orderCount: 0,
  totalSales: '0.00',
  outstandingBalance: '0.00',
  offerings: [],
};

const optionalFieldLabels = [
  'Description',
  'Opens',
  'Closes',
  'Expected delivery date',
  'Pickup instructions',
  'Internal notes',
];

function renderModal(window: StoreOrderWindow | null) {
  return renderWithRouter(<WindowFormModal isOpen window={window} products={[]} onClose={vi.fn()} onSaved={vi.fn()} />);
}

describe('WindowFormModal save payload', () => {
  beforeEach(() => {
    createWindow.mockReset();
    updateWindow.mockReset();
    createWindow.mockResolvedValue(fallOrder);
    updateWindow.mockResolvedValue(fallOrder);
  });

  it('sends null for every optional field emptied on edit, so the clear persists', async () => {
    const user = userEvent.setup();
    renderModal(fallOrder);
    await screen.findByDisplayValue('Fall 2026 apparel order');

    for (const label of optionalFieldLabels) {
      await user.clear(screen.getByLabelText(label));
    }
    await user.click(screen.getByRole('button', { name: 'Save window' }));

    await waitFor(() => expect(updateWindow).toHaveBeenCalledTimes(1));
    expect(updateWindow).toHaveBeenCalledWith('win-1', {
      name: 'Fall 2026 apparel order',
      description: null,
      opensAt: null,
      closesAt: null,
      autoOpen: true,
      autoClose: true,
      expectedDeliveryDate: null,
      pickupInstructions: null,
      includeAllProducts: true,
      notifyOnOpen: true,
      notes: null,
      offerings: [],
    });
  });

  it('still omits blank optional fields on create', async () => {
    const user = userEvent.setup();
    renderModal(null);
    await user.type(screen.getByLabelText('Name'), 'Spring order');
    await user.click(screen.getByRole('button', { name: 'Save window' }));

    await waitFor(() => expect(createWindow).toHaveBeenCalledTimes(1));
    const payload: unknown = createWindow.mock.calls[0]?.[0];
    expect(JSON.parse(JSON.stringify(payload))).toEqual({
      name: 'Spring order',
      autoOpen: true,
      autoClose: true,
      includeAllProducts: true,
      notifyOnOpen: true,
      offerings: [],
    });
  });
});
