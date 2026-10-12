import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { InventoryCategory } from '../../../services/eventServices';

const mockCreateItem = vi.fn();
const mockUpdateItem = vi.fn();

vi.mock('../../../services/medicalSuppliesService', () => ({
  medicalSuppliesService: {
    createItem: (...args: unknown[]) => mockCreateItem(...args) as unknown,
    updateItem: (...args: unknown[]) => mockUpdateItem(...args) as unknown,
  },
}));

import { MedicalItemFormModal } from './MedicalItemFormModal';

const category: InventoryCategory = {
  id: 'cat-bandages',
  organization_id: 'org-1',
  name: 'Bandages',
  item_type: 'medical',
  requires_assignment: false,
  requires_serial_number: false,
  requires_maintenance: false,
  nfpa_tracking_enabled: false,
  allow_self_checkout: false,
  self_checkout_loan_days: null,
  active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('MedicalItemFormModal', () => {
  beforeEach(() => {
    mockCreateItem.mockReset();
    mockUpdateItem.mockReset();
    mockCreateItem.mockResolvedValue({ id: 'item-1' });
  });

  it('keeps Save and Cancel in the pinned footer, outside the scrolling fields', () => {
    renderWithRouter(
      <MedicalItemFormModal categories={[category]} categoriesError={null} onClose={vi.fn()} onSaved={vi.fn()} />
    );

    expect(screen.getByTestId('modal-panel').tagName).toBe('FORM');
    const footer = screen.getByTestId('modal-footer');
    expect(within(footer).getByRole('button', { name: 'Add supply' })).toHaveAttribute('type', 'submit');
    expect(within(footer).getByRole('button', { name: 'Cancel' })).toHaveAttribute('type', 'button');
  });

  it('submits the form from the footer button', async () => {
    const onSaved = vi.fn();
    renderWithRouter(
      <MedicalItemFormModal categories={[category]} categoriesError={null} onClose={vi.fn()} onSaved={onSaved} />
    );

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^Name/), 'Gauze pads');
    await user.selectOptions(screen.getByLabelText(/^Category/), 'cat-bandages');
    await user.click(screen.getByRole('button', { name: 'Add supply' }));

    expect(mockCreateItem).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Gauze pads', category_id: 'cat-bandages', tracking_type: 'pool' })
    );
    expect(onSaved).toHaveBeenCalled();
  });
});
