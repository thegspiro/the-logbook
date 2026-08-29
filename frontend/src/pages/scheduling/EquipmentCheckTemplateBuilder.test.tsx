/* eslint-disable testing-library/no-node-access */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../../contexts/ConfirmContext';

const { service, unsavedStates } = vi.hoisted(() => ({
  service: {
    getApparatusOptions: vi.fn(),
    getEquipmentCheckTemplate: vi.fn(),
    getCsvSampleUrl: vi.fn(),
    addCheckItem: vi.fn(),
    addCheckItemsBulk: vi.fn(),
    deleteCheckItem: vi.fn(),
    reorderItems: vi.fn(),
    reorderCompartments: vi.fn(),
    updateCheckItem: vi.fn(),
    updateEquipmentCheckTemplate: vi.fn(),
    updateCompartment: vi.fn(),
    addCompartment: vi.fn(),
  },
  unsavedStates: [] as boolean[],
}));

vi.mock('@/modules/scheduling', () => ({ schedulingService: service }));
vi.mock('@/hooks/useUnsavedChanges', () => ({
  useUnsavedChanges: ({ hasChanges }: { hasChanges: boolean }) => unsavedStates.push(hasChanges),
}));
vi.mock('@/modules/scheduling/components/CatalogQuickAdd', () => ({
  default: ({
    value,
    onChange,
    onAdd,
  }: {
    value: string;
    onChange: (value: string) => void;
    onAdd: (value: { name: string }) => Promise<void>;
  }) => (
    <input
      aria-label="Quick add item"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') void onAdd({ name: value });
      }}
    />
  ),
}));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (state: { checkPermission: () => boolean }) => unknown) =>
    selector({ checkPermission: () => false }),
}));

// Repository convention: service dependencies above are mocked before this import.
import EquipmentCheckTemplateBuilder from './EquipmentCheckTemplateBuilder';

const item = (id: string, name: string, sortOrder: number) => ({
  id,
  compartmentId: 'cab',
  name,
  sortOrder,
  checkType: 'function' as const,
  isRequired: true,
  hasExpiration: false,
  expirationWarningDays: 30,
});
const template = {
  id: 'template-1',
  organizationId: 'org-1',
  name: 'Engine check',
  checkTiming: 'start_of_shift' as const,
  templateType: 'equipment' as const,
  isActive: true,
  sortOrder: 0,
  compartments: [
    {
      id: 'cab',
      templateId: 'template-1',
      name: 'Cab',
      sortOrder: 0,
      containerType: 'compartment',
      items: [item('radio', 'Radio', 0), item('torch', 'Torch', 1)],
    },
    { id: 'body', templateId: 'template-1', name: 'Body', sortOrder: 1, containerType: 'compartment', items: [] },
  ],
};

function renderBuilder() {
  return render(
    <MemoryRouter initialEntries={['/templates/template-1']}>
      <ConfirmProvider>
        <Routes>
          <Route path="/templates/:templateId" element={<EquipmentCheckTemplateBuilder />} />
        </Routes>
      </ConfirmProvider>
    </MemoryRouter>
  );
}

async function confirm(label: string | RegExp) {
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: label }));
}

async function save() {
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  const warning = await screen.findByRole('heading', { name: 'Save with warnings?' }).catch(() => null);
  if (warning) await confirm('Save anyway');
}

function first(elements: HTMLElement[]): HTMLElement {
  const element = elements[0];
  if (!element) throw new Error('Expected at least one matching element');
  return element;
}

beforeEach(() => {
  vi.clearAllMocks();
  unsavedStates.length = 0;
  service.getApparatusOptions.mockResolvedValue({ options: [] });
  service.getCsvSampleUrl.mockReturnValue('/sample.csv');
  service.getEquipmentCheckTemplate.mockResolvedValue(structuredClone(template));
  service.deleteCheckItem.mockResolvedValue(undefined);
  service.reorderItems.mockResolvedValue(undefined);
  service.reorderCompartments.mockResolvedValue(undefined);
  service.updateCheckItem.mockResolvedValue(item('radio', 'Radio', 0));
  service.updateEquipmentCheckTemplate.mockResolvedValue(template);
  service.updateCompartment.mockResolvedValue(template.compartments[0]);
  service.addCompartment.mockResolvedValue(template.compartments[0]);
});

describe('equipment-check item mutations', () => {
  it('quick-adds with the exact payload and does not submit twice while pending', async () => {
    let finish!: (value: ReturnType<typeof item>) => void;
    service.addCheckItem.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    renderBuilder();
    const input = first(await screen.findAllByLabelText('Quick add item'));
    await userEvent.type(input, '  Nozzle  ');
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(service.addCheckItem).toHaveBeenCalledTimes(1);
    expect(service.addCheckItem).toHaveBeenCalledWith('cab', { name: 'Nozzle', sort_order: 2 });
    finish(item('nozzle', 'Nozzle', 2));
    expect(await screen.findByLabelText('Actions for Nozzle')).toBeVisible();
    expect(unsavedStates).not.toContain(true);
  });

  it('retains quick-add text after failure and permits a retry', async () => {
    service.addCheckItem.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(item('nozzle', 'Nozzle', 2));
    renderBuilder();
    const input = first(await screen.findAllByLabelText('Quick add item'));
    await userEvent.type(input, 'Nozzle{enter}');
    await waitFor(() => expect(service.addCheckItem).toHaveBeenCalledTimes(1));
    expect(input).toHaveValue('Nozzle');
    await userEvent.type(input, '{enter}');
    expect(await screen.findByLabelText('Actions for Nozzle')).toBeVisible();
    expect(service.addCheckItem).toHaveBeenNthCalledWith(2, 'cab', { name: 'Nozzle', sort_order: 2 });
  });

  it('bulk-pastes atomically and reuses the idempotency key on retry', async () => {
    service.addCheckItemsBulk.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({
      items: [item('mask', 'Mask', 2), item('hood', 'Hood', 3)],
      createdCount: 2,
    });
    renderBuilder();
    await userEvent.click(first(await screen.findAllByTitle('Switch to bulk paste (one item per line)')));
    const paste = screen.getByPlaceholderText(/Paste item names here/i);
    await userEvent.type(paste, 'Mask\nHood');
    await userEvent.click(screen.getByRole('button', { name: 'Add All' }));
    await waitFor(() => expect(service.addCheckItemsBulk).toHaveBeenCalledTimes(1));
    expect(paste).toHaveValue('Mask\nHood');
    await userEvent.click(screen.getByRole('button', { name: 'Add All' }));
    expect(await screen.findByLabelText('Actions for Mask')).toBeVisible();
    const [firstCall, secondCall] = service.addCheckItemsBulk.mock.calls;
    expect(firstCall?.slice(0, 2)).toEqual(['cab', [{ name: 'Mask' }, { name: 'Hood' }]]);
    expect(secondCall).toEqual(firstCall);
  });

  it('retains an individually deleted row when the mutation fails', async () => {
    service.deleteCheckItem.mockRejectedValueOnce(new Error('denied'));
    renderBuilder();
    const actions = await screen.findByLabelText('Actions for Radio');
    await userEvent.click(actions);
    await userEvent.click(within(actions.closest('details') as HTMLElement).getByRole('button', { name: 'Delete' }));
    await confirm('Delete');
    await waitFor(() => expect(service.deleteCheckItem).toHaveBeenCalledWith('radio'));
    expect(screen.getByLabelText('Actions for Radio')).toBeVisible();
  });

  async function deleteAllItems() {
    renderBuilder();
    await userEvent.click(await screen.findByTitle('Select all items'));
    await userEvent.click(screen.getByRole('button', { name: 'Delete selected items' }));
    await confirm('Delete 2');
    await waitFor(() => expect(service.deleteCheckItem).toHaveBeenCalledTimes(2));
    expect(service.deleteCheckItem).toHaveBeenCalledWith('radio');
    expect(service.deleteCheckItem).toHaveBeenCalledWith('torch');
  }

  it('removes every row after successful bulk deletion', async () => {
    await deleteAllItems();
    await waitFor(() => expect(screen.queryByLabelText('Actions for Radio')).not.toBeInTheDocument());
    expect(unsavedStates).not.toContain(true);
  });

  it('retains every row after failed bulk deletion', async () => {
    service.deleteCheckItem.mockRejectedValueOnce(new Error('denied'));
    await deleteAllItems();
    expect(screen.getByLabelText('Actions for Radio')).toBeVisible();
    expect(screen.getByLabelText('Actions for Torch')).toBeVisible();
  });

  it('persists a duplicated item in edit mode with its complete create payload', async () => {
    service.addCheckItem.mockResolvedValue(item('copy', 'Radio (copy)', 1));
    renderBuilder();
    const actions = await screen.findByLabelText('Actions for Radio');
    await userEvent.click(actions);
    await userEvent.click(within(actions.closest('details') as HTMLElement).getByRole('button', { name: 'Duplicate' }));
    await save();
    await waitFor(() => expect(service.addCheckItem).toHaveBeenCalled());
    expect(service.addCheckItem).toHaveBeenCalledWith(
      'cab',
      expect.objectContaining({
        name: 'Radio (copy)',
        sort_order: 1,
        check_type: 'function',
        is_required: true,
        has_expiration: false,
      })
    );
  });

  it('rolls item order back when reorder persistence fails', async () => {
    service.reorderItems.mockRejectedValueOnce(new Error('conflict'));
    renderBuilder();
    const actions = await screen.findByLabelText('Actions for Radio');
    await userEvent.click(actions);
    await userEvent.click(within(actions.closest('details') as HTMLElement).getByRole('button', { name: 'Move down' }));
    await waitFor(() => expect(service.reorderItems).toHaveBeenCalledWith('cab', ['torch', 'radio']));
    await waitFor(() => {
      const names = screen
        .getAllByLabelText(/Actions for (Radio|Torch)/)
        .map((node) => node.getAttribute('aria-label'));
      expect(names).toEqual(['Actions for Radio', 'Actions for Torch']);
    });
  });

  it('rolls a cross-compartment movement back when persistence fails', async () => {
    service.updateCheckItem.mockRejectedValueOnce(new Error('conflict'));
    renderBuilder();
    const actions = await screen.findByLabelText('Actions for Radio');
    await userEvent.click(actions);
    await userEvent.selectOptions(
      within(actions.closest('details') as HTMLElement).getByLabelText(/current destination Cab/i),
      '1'
    );
    await waitFor(() =>
      expect(service.updateCheckItem).toHaveBeenCalledWith('radio', { compartment_id: 'body', sort_order: 0 })
    );
    expect(screen.getByLabelText('Actions for Radio')).toBeVisible();
  });
});

describe('draft, publish, and unsaved state', () => {
  it('sends inactive for a draft and active for a published template', async () => {
    renderBuilder();
    const active = await screen.findByRole('checkbox', { name: 'Active' });
    await userEvent.click(active);
    await save();
    await waitFor(() =>
      expect(service.updateEquipmentCheckTemplate).toHaveBeenLastCalledWith(
        'template-1',
        expect.objectContaining({ is_active: false })
      )
    );
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Active' })).toBeChecked());
    await save();
    await waitFor(() =>
      expect(service.updateEquipmentCheckTemplate).toHaveBeenLastCalledWith(
        'template-1',
        expect.objectContaining({ is_active: true })
      )
    );
  });

  it('only marks actual unsaved work for navigation prompting', async () => {
    service.addCheckItem.mockResolvedValue(item('nozzle', 'Nozzle', 2));
    renderBuilder();
    const input = first(await screen.findAllByLabelText('Quick add item'));
    await userEvent.type(input, 'Nozzle{enter}');
    await screen.findByLabelText('Actions for Nozzle');
    expect(unsavedStates).not.toContain(true);
    const name = screen.getByDisplayValue('Engine check');
    await userEvent.clear(name);
    await userEvent.type(name, 'Changed');
    expect(unsavedStates).toContain(true);
    await userEvent.click(screen.getByTitle('Go back'));
    expect(await screen.findByRole('heading', { name: 'Leave without saving?' })).toBeVisible();
  });
});
