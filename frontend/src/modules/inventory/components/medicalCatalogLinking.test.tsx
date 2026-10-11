/**
 * Linking checklist positions to medical supplies from the template builder.
 *
 * The defect these guard: the builder searched only the gear list, which hides
 * medical stock, and its "create" filed new rows with no category — as gear.
 * A rig's gauze either stayed free text or became a second row the EMS supply
 * officer never saw. These assert on what reaches the API and `onAdd`, since
 * a test that only proved "an item was added" passed against the old code.
 */

import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGearItems = vi.fn();
const mockGearItem = vi.fn();
const mockGearLots = vi.fn();
const mockGearCreate = vi.fn();
const mockMedicalItems = vi.fn();
const mockMedicalItem = vi.fn();
const mockMedicalLots = vi.fn();
const mockMedicalCategories = vi.fn();
const mockMedicalCreate = vi.fn();

vi.mock('@/services/inventoryService', () => ({
  inventoryService: {
    getItems: (...a: unknown[]) => mockGearItems(...a) as unknown,
    getItem: (...a: unknown[]) => mockGearItem(...a) as unknown,
    getItemLots: (...a: unknown[]) => mockGearLots(...a) as unknown,
    createItemIfAbsent: (...a: unknown[]) => mockGearCreate(...a) as unknown,
  },
}));

vi.mock('@/services/medicalSuppliesService', () => ({
  medicalSuppliesService: {
    getItems: (...a: unknown[]) => mockMedicalItems(...a) as unknown,
    getItem: (...a: unknown[]) => mockMedicalItem(...a) as unknown,
    getItemLots: (...a: unknown[]) => mockMedicalLots(...a) as unknown,
    getCategories: (...a: unknown[]) => mockMedicalCategories(...a) as unknown,
    createItemIfAbsent: (...a: unknown[]) => mockMedicalCreate(...a) as unknown,
  },
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...a: unknown[]) => mockToastSuccess(...a) as unknown,
    error: (...a: unknown[]) => mockToastError(...a) as unknown,
  },
}));

import CatalogQuickAdd from './CatalogQuickAdd';
import InventoryItemPicker from './InventoryItemPicker';

const empty = { items: [], total: 0, skip: 0, limit: 6 };
const gauze = { id: 'med-1', name: 'Gauze 4x4', tracking_type: 'pool', category_name: 'Trauma' };
const halligan = { id: 'gear-1', name: 'Halligan Bar', tracking_type: 'individual', category_name: 'Tools' };
const categories = [
  { id: 'cat-airway', name: 'Airway' },
  { id: 'cat-trauma', name: 'Trauma' },
];
const BOTH = { gear: true, medical: true };

const resetAll = () => {
  for (const m of [
    mockGearItems,
    mockGearItem,
    mockGearLots,
    mockGearCreate,
    mockMedicalItems,
    mockMedicalItem,
    mockMedicalLots,
    mockMedicalCategories,
    mockMedicalCreate,
    mockToastSuccess,
    mockToastError,
  ]) {
    m.mockReset();
  }
  mockGearItems.mockResolvedValue(empty);
  mockMedicalItems.mockResolvedValue(empty);
  mockGearLots.mockResolvedValue([]);
  mockMedicalLots.mockResolvedValue([]);
  mockMedicalCategories.mockResolvedValue(categories);
  mockMedicalCreate.mockResolvedValue({
    item: { id: 'med-new', name: 'OPA Kit', tracking_type: 'pool' },
    created: true,
  });
};

describe('CatalogQuickAdd with medical stock in scope', () => {
  const onAdd = vi.fn();

  beforeEach(() => {
    resetAll();
    onAdd.mockReset();
    onAdd.mockResolvedValue(undefined);
  });

  const Harness: React.FC<{ canCreateMedical?: boolean; canCreateGear?: boolean }> = ({
    canCreateMedical = true,
    canCreateGear = true,
  }) => {
    const [value, setValue] = useState('');
    return (
      <CatalogQuickAdd
        value={value}
        onChange={setValue}
        onAdd={onAdd}
        canCreateInventory={canCreateGear}
        canCreateMedical={canCreateMedical}
        searchScope={BOTH}
      />
    );
  };

  it('finds a medical supply, labels it, and links it', async () => {
    const user = userEvent.setup();
    mockMedicalItems.mockResolvedValue({ ...empty, items: [gauze] });
    mockGearItems.mockResolvedValue({ ...empty, items: [halligan] });
    render(<Harness />);

    await user.type(screen.getByRole('combobox'), 'a');
    const options = await screen.findAllByRole('option');

    expect(options[0]).toHaveTextContent('Gauze 4x4');
    expect(options[0]).toHaveTextContent('Medical');
    expect(options[1]).toHaveTextContent('Halligan Bar');

    await user.click(options[0] as HTMLElement);

    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledWith({ name: 'Gauze 4x4', inventoryItemId: 'med-1', checkType: 'count' });
    });
    // Lots are read through the endpoint a medical-only officer can reach.
    expect(mockMedicalLots).toHaveBeenCalledWith('med-1');
    expect(mockGearLots).not.toHaveBeenCalled();
  });

  it('creates a new supply in the chosen medical category and links it', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByRole('combobox'), 'OPA Kit');
    await user.click(await screen.findByText('Create “OPA Kit” in Medical Supplies'));
    await user.selectOptions(await screen.findByLabelText('Medical category'), 'cat-airway');
    await user.click(screen.getByRole('button', { name: 'Create & link' }));

    await waitFor(() => {
      expect(mockMedicalCreate).toHaveBeenCalledWith({
        name: 'OPA Kit',
        category_id: 'cat-airway',
        tracking_type: 'pool',
        quantity: 0,
      });
    });
    expect(onAdd).toHaveBeenCalledWith({ name: 'OPA Kit', inventoryItemId: 'med-new', checkType: 'count' });
    expect(mockGearCreate).not.toHaveBeenCalled();
  });

  it('will not create until a category is chosen', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByRole('combobox'), 'OPA Kit');
    await user.click(await screen.findByText('Create “OPA Kit” in Medical Supplies'));
    await screen.findByLabelText('Medical category');

    expect(screen.getByRole('button', { name: 'Create & link' })).toBeDisabled();
  });

  it('keeps the panel open and reports a clash with a gear item', async () => {
    const user = userEvent.setup();
    mockMedicalCreate.mockRejectedValue(new Error('An item with this name already exists outside Medical Supplies.'));
    render(<Harness />);

    await user.type(screen.getByRole('combobox'), 'Tourniquet');
    await user.click(await screen.findByText('Create “Tourniquet” in Medical Supplies'));
    await user.selectOptions(await screen.findByLabelText('Medical category'), 'cat-trauma');
    await user.click(screen.getByRole('button', { name: 'Create & link' }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled();
    });
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Medical category')).toBeInTheDocument();
  });

  it('hands the name back when the medical create is cancelled', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByRole('combobox'), 'OPA Kit');
    await user.click(await screen.findByText('Create “OPA Kit” in Medical Supplies'));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('combobox')).toHaveValue('OPA Kit');
    expect(screen.queryByLabelText('Medical category')).not.toBeInTheDocument();
  });

  it('labels the gear create distinctly when both are offered', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByRole('combobox'), 'OPA Kit');

    expect(await screen.findByText('Create “OPA Kit” as equipment or gear')).toBeInTheDocument();
  });

  it('offers no create of either kind when half the catalog could not be searched', async () => {
    const user = userEvent.setup();
    mockMedicalItems.mockRejectedValue(new Error('offline'));
    mockGearItems.mockResolvedValue({ ...empty, items: [halligan] });
    render(<Harness />);

    await user.type(screen.getByRole('combobox'), 'Tourniquet');

    expect(await screen.findByText(/Part of the catalog couldn’t be searched/)).toBeInTheDocument();
    expect(screen.queryByText(/Create “Tourniquet”/)).not.toBeInTheDocument();
  });

  it('does not offer the medical create without the medical grant', async () => {
    const user = userEvent.setup();
    render(<Harness canCreateMedical={false} />);

    await user.type(screen.getByRole('combobox'), 'OPA Kit');

    expect(await screen.findByText('Create “OPA Kit” in inventory')).toBeInTheDocument();
    expect(screen.queryByText('Create “OPA Kit” in Medical Supplies')).not.toBeInTheDocument();
  });
});

describe('MedicalCreatePanel category choice', () => {
  const onAdd = vi.fn();

  beforeEach(() => {
    resetAll();
    onAdd.mockReset();
    onAdd.mockResolvedValue(undefined);
  });

  const Harness: React.FC = () => {
    const [value, setValue] = useState('');
    return (
      <CatalogQuickAdd
        value={value}
        onChange={setValue}
        onAdd={onAdd}
        canCreateInventory={false}
        canCreateMedical
        searchScope={BOTH}
      />
    );
  };

  it('preselects the only medical category', async () => {
    const user = userEvent.setup();
    mockMedicalCategories.mockResolvedValue([{ id: 'cat-only', name: 'EMS Consumables' }]);
    render(<Harness />);

    await user.type(screen.getByRole('combobox'), 'OPA Kit');
    await user.click(await screen.findByText('Create “OPA Kit” in Medical Supplies'));

    await waitFor(() => {
      expect(screen.getByLabelText('Medical category')).toHaveValue('cat-only');
    });
  });

  it('says so when no medical category exists yet', async () => {
    const user = userEvent.setup();
    mockMedicalCategories.mockResolvedValue([]);
    render(<Harness />);

    await user.type(screen.getByRole('combobox'), 'OPA Kit');
    await user.click(await screen.findByText('Create “OPA Kit” in Medical Supplies'));

    expect(await screen.findByText(/no medical categories yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create & link' })).toBeDisabled();
  });
});

describe('InventoryItemPicker with medical stock in scope', () => {
  const onChange = vi.fn();

  beforeEach(() => {
    resetAll();
    onChange.mockReset();
  });

  it('resolves a linked medical item for a viewer without the gear grant', async () => {
    mockMedicalItem.mockResolvedValue(gauze);

    render(<InventoryItemPicker value="med-1" onChange={onChange} searchScope={{ gear: false, medical: true }} />);

    expect(await screen.findByText('Gauze 4x4')).toBeInTheDocument();
    expect(mockGearItem).not.toHaveBeenCalled();
  });

  it('falls back to the medical endpoint when the gear one refuses', async () => {
    mockGearItem.mockRejectedValue(new Error('not found'));
    mockMedicalItem.mockResolvedValue(gauze);

    render(<InventoryItemPicker value="med-1" onChange={onChange} searchScope={BOTH} />);

    expect(await screen.findByText('Gauze 4x4')).toBeInTheDocument();
    expect(mockMedicalItem).toHaveBeenCalledWith('med-1');
  });

  it('creates in Medical Supplies and links the new row', async () => {
    const user = userEvent.setup();
    render(<InventoryItemPicker onChange={onChange} searchScope={BOTH} canCreateMedical />);

    await user.type(screen.getByPlaceholderText('Search inventory to link…'), 'OPA Kit');
    await user.click(await screen.findByText('Create “OPA Kit” in Medical Supplies'));
    await user.selectOptions(await screen.findByLabelText('Medical category'), 'cat-airway');
    await user.click(screen.getByRole('button', { name: 'Create & link' }));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('med-new', 'OPA Kit');
    });
    expect(mockMedicalCreate).toHaveBeenCalledWith({
      name: 'OPA Kit',
      category_id: 'cat-airway',
      tracking_type: 'pool',
      quantity: 0,
    });
  });

  it('labels medical results', async () => {
    const user = userEvent.setup();
    mockMedicalItems.mockResolvedValue({ ...empty, items: [gauze] });
    render(<InventoryItemPicker onChange={onChange} searchScope={BOTH} />);

    await user.type(screen.getByPlaceholderText('Search inventory to link…'), 'gauze');

    const result = await screen.findByRole('button', { name: /Gauze 4x4/ });
    expect(result).toHaveTextContent('Medical');
  });
});
