import { fireEvent, screen, waitFor } from '@testing-library/react';
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
    await user.type(screen.getByLabelText(/^Name/), 'Spring order');
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

describe('WindowFormModal errors and discarding', () => {
  const tooLong = (field: string) => ({
    response: { status: 422, data: { detail: [{ field, message: 'Value is too long.' }] } },
  });

  beforeEach(() => {
    createWindow.mockReset();
    updateWindow.mockReset();
    createWindow.mockResolvedValue(fallOrder);
    updateWindow.mockResolvedValue(fallOrder);
  });

  it('puts a refusal of a new window on its field, announced, and creates nothing', async () => {
    createWindow.mockRejectedValueOnce(tooLong('name'));
    const user = userEvent.setup();
    renderModal(null);
    await user.type(screen.getByLabelText(/^Name/), 'Spring order');
    await user.click(screen.getByRole('button', { name: 'Save window' }));

    const name = screen.getByLabelText(/^Name/);
    await waitFor(() => expect(name).toHaveAccessibleDescription('Name is too long — keep it to 200 characters.'));
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(createWindow).toHaveBeenCalledTimes(1);
  });

  it('saves the rest of an edit, keeps the stored name the server refused and flags it', async () => {
    updateWindow.mockRejectedValueOnce(tooLong('name'));
    const user = userEvent.setup();
    renderModal(fallOrder);
    await screen.findByDisplayValue('Fall 2026 apparel order');
    await user.type(screen.getByLabelText(/^Name/), ' (extended)');
    await user.clear(screen.getByLabelText('Internal notes'));
    await user.click(screen.getByRole('button', { name: 'Save window' }));

    await waitFor(() => expect(updateWindow).toHaveBeenCalledTimes(2));
    const retry = updateWindow.mock.calls[1]?.[1] as Record<string, unknown>;
    expect(retry).not.toHaveProperty('name');
    expect(retry).toMatchObject({ notes: null });
    expect(screen.getByLabelText(/^Name/)).toHaveAccessibleDescription('Name is too long — keep it to 200 characters.');
  });

  it('asks before Escape or Cancel discards what was typed', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderWithRouter(<WindowFormModal isOpen window={null} products={[]} onClose={onClose} onSaved={vi.fn()} />);
    await user.type(screen.getByLabelText(/^Name/), 'Spring order');

    fireEvent.keyDown(document, { key: 'Escape' });
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
