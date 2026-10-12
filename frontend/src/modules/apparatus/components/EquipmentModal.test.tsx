/**
 * Editing equipment must be able to clear a field.
 *
 * The update endpoint dumps its payload with `exclude_unset`, so an omitted
 * key means "leave this alone". The edit path used to spread blank fields out
 * of the payload, which kept the old value behind a success toast (CLAUDE.md
 * pitfall #1).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApparatusEquipment } from '../types';

const mockCreateEquipment = vi.fn();
const mockUpdateEquipment = vi.fn();
const mockToastError = vi.fn();

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: (...args: unknown[]) => mockToastError(...args) as unknown },
}));

vi.mock('../services/api', () => ({
  apparatusEquipmentService: {
    createEquipment: (...args: unknown[]) => mockCreateEquipment(...args) as unknown,
    updateEquipment: (...args: unknown[]) => mockUpdateEquipment(...args) as unknown,
  },
}));

import { EquipmentModal } from './EquipmentModal';

const equipment = (overrides: Partial<ApparatusEquipment> = {}): ApparatusEquipment => ({
  id: 'eq-1',
  organizationId: 'org-1',
  apparatusId: 'app-1',
  inventoryItemId: null,
  name: 'Halligan bar',
  description: 'Forcible entry tool',
  quantity: 2,
  locationOnApparatus: 'Compartment 3',
  isMounted: true,
  isRequired: true,
  serialNumber: 'HB-0042',
  assetTag: 'AT-7',
  isPresent: true,
  notes: 'Check tip for burrs',
  assignedBy: null,
  assignedAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const renderModal = (editEquipment: ApparatusEquipment | null = null) =>
  render(
    <EquipmentModal isOpen onClose={vi.fn()} onSaved={vi.fn()} apparatusId="app-1" editEquipment={editEquipment} />
  );

describe('EquipmentModal payloads', () => {
  beforeEach(() => {
    mockCreateEquipment.mockReset();
    mockCreateEquipment.mockResolvedValue({});
    mockUpdateEquipment.mockReset();
    mockUpdateEquipment.mockResolvedValue({});
    mockToastError.mockReset();
  });

  it('sends an explicit null for every field emptied on edit, and the rest unchanged', async () => {
    const user = userEvent.setup();
    renderModal(equipment());

    await user.clear(screen.getByDisplayValue('Forcible entry tool'));
    await user.clear(screen.getByDisplayValue('HB-0042'));
    await user.clear(screen.getByDisplayValue('Check tip for burrs'));
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(mockUpdateEquipment).toHaveBeenCalledWith('eq-1', {
      name: 'Halligan bar',
      description: null,
      quantity: 2,
      locationOnApparatus: 'Compartment 3',
      isMounted: true,
      isRequired: true,
      serialNumber: null,
      assetTag: 'AT-7',
      isPresent: true,
      notes: null,
    });
  });

  it('refuses a blank quantity on edit instead of overwriting the stored count', async () => {
    // quantity is NOT NULL; a blank box used to save as 1.
    const user = userEvent.setup();
    renderModal(equipment());

    await user.clear(screen.getByDisplayValue('2'));
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(mockUpdateEquipment).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith('Enter a quantity of at least 1');
  });

  it('still omits blank fields on create', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByPlaceholderText('Equipment name'), 'Axe');
    await user.click(screen.getByRole('button', { name: 'Add Equipment' }));

    expect(mockCreateEquipment).toHaveBeenCalledWith({
      apparatusId: 'app-1',
      name: 'Axe',
      quantity: 1,
      isMounted: false,
      isRequired: false,
      isPresent: true,
    });
  });
});
