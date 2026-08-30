/* eslint-disable testing-library/no-node-access, @typescript-eslint/no-unsafe-return */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../../contexts/ConfirmContext';

const {
  getTemplate,
  updateCheckItem,
  addCheckItem,
  reorderItems,
  cloneCompartment,
  updateCompartment,
  addCheckItemsBulk,
  deleteCheckItemsBulk,
  deleteCheckItem,
  createEquipmentCheckTemplate,
  updateEquipmentCheckTemplate,
  toastSuccess,
  toastError,
} = vi.hoisted(() => ({
  getTemplate: vi.fn(),
  updateCheckItem: vi.fn(),
  addCheckItem: vi.fn(),
  reorderItems: vi.fn(),
  cloneCompartment: vi.fn(),
  updateCompartment: vi.fn(),
  addCheckItemsBulk: vi.fn(),
  deleteCheckItemsBulk: vi.fn(),
  deleteCheckItem: vi.fn(),
  createEquipmentCheckTemplate: vi.fn(),
  updateEquipmentCheckTemplate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({ default: { success: toastSuccess, error: toastError } }));

vi.mock('@/modules/scheduling', () => ({
  schedulingService: {
    getApparatusOptions: vi.fn().mockResolvedValue({ options: [] }),
    getEquipmentCheckTemplate: (...args: unknown[]) => getTemplate(...args),
    updateCheckItem: (...args: unknown[]) => updateCheckItem(...args),
    addCheckItem: (...args: unknown[]) => addCheckItem(...args),
    reorderItems: (...args: unknown[]) => reorderItems(...args),
    cloneCompartment: (...args: unknown[]) => cloneCompartment(...args),
    updateCompartment: (...args: unknown[]) => updateCompartment(...args),
    addCheckItemsBulk: (...args: unknown[]) => addCheckItemsBulk(...args),
    getCsvSampleUrl: vi.fn().mockReturnValue('/sample.csv'),
    deleteCheckItemsBulk: (...args: unknown[]) => deleteCheckItemsBulk(...args),
    deleteCheckItem: (...args: unknown[]) => deleteCheckItem(...args),
    createEquipmentCheckTemplate: (...args: unknown[]) => createEquipmentCheckTemplate(...args),
    updateEquipmentCheckTemplate: (...args: unknown[]) => updateEquipmentCheckTemplate(...args),
  },
}));

// Repository convention: service dependencies above are mocked before this import.
import EquipmentCheckTemplateBuilder from './EquipmentCheckTemplateBuilder';

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector?: (state: { checkPermission: () => boolean }) => unknown) => {
    const state = { checkPermission: () => false };
    return selector ? selector(state) : state;
  },
}));

const template = {
  id: 'template-1',
  organizationId: 'org-1',
  name: 'Engine check',
  checkTiming: 'start_of_shift',
  templateType: 'equipment',
  isActive: true,
  sortOrder: 0,
  compartments: [
    {
      id: 'cab',
      templateId: 'template-1',
      name: 'Cab',
      sortOrder: 0,
      containerType: 'compartment',
      items: [
        {
          id: 'radio',
          compartmentId: 'cab',
          name: 'Radio',
          sortOrder: 0,
          checkType: 'function',
          isRequired: true,
          hasExpiration: false,
          expirationWarningDays: 30,
        },
        {
          id: 'flashlight',
          compartmentId: 'cab',
          name: 'Flashlight',
          sortOrder: 1,
          checkType: 'function',
          isRequired: true,
          hasExpiration: false,
          expirationWarningDays: 30,
        },
      ],
    },
    {
      id: 'bag',
      templateId: 'template-1',
      name: 'Medical bag',
      sortOrder: 1,
      containerType: 'bag',
      parentCompartmentId: 'cab',
      items: [],
    },
    {
      id: 'section',
      templateId: 'template-1',
      name: 'Supplies',
      sortOrder: 2,
      containerType: 'compartment',
      isHeader: true,
      items: [],
    },
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

function renderNewBuilder() {
  return render(
    <MemoryRouter initialEntries={['/templates/new']}>
      <ConfirmProvider>
        <Routes>
          <Route path="/templates/new" element={<EquipmentCheckTemplateBuilder />} />
        </Routes>
      </ConfirmProvider>
    </MemoryRouter>
  );
}

async function confirm(label: string | RegExp) {
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: label }));
}

describe('EquipmentCheckTemplateBuilder responsive actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTemplate.mockResolvedValue(structuredClone(template));
    updateCheckItem.mockResolvedValue({});
    reorderItems.mockResolvedValue(undefined);
    updateCompartment.mockResolvedValue({});
    createEquipmentCheckTemplate.mockResolvedValue({ ...template, id: 'draft-1', isActive: false });
    updateEquipmentCheckTemplate.mockResolvedValue(template);
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  it('renders a 375px summary row and exposes selection only after Select items', async () => {
    const user = userEvent.setup();
    renderBuilder();

    const radioSummary = await screen.findByRole('button', { name: 'Edit Radio' });
    expect(radioSummary).toHaveClass('min-h-[44px]');
    expect(within(radioSummary).getByText('Function · Required')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Select Radio' })).not.toBeInTheDocument();
    expect(screen.getAllByLabelText('Actions for Radio')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Select items' }));
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select Radio' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Radio selection checkbox' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Radio' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Select Radio' }));
    expect(screen.getByRole('button', { name: 'Deselect Radio' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('button', { name: 'Select Radio' })).not.toBeInTheDocument();
  });

  it('opens a full-height progressive item editor and reviews adjacent items on phones', async () => {
    const user = userEvent.setup();
    renderBuilder();

    const radioRow = await screen.findByRole('button', { name: 'Edit Radio' });
    await user.click(radioRow);

    const editor = screen.getByRole('dialog', { name: 'Radio' });
    expect(within(editor).getByText('Cab')).toBeVisible();
    expect(within(editor).getByText('Item 1/2')).toBeVisible();
    expect(within(editor).getByText('Essentials')).toBeVisible();
    expect(within(editor).getByText('Inventory and expiration')).toBeVisible();
    expect(within(editor).getByText('Optional details')).toBeVisible();
    expect(within(editor).queryByLabelText('Expected Qty')).not.toBeInTheDocument();
    expect(editor.firstElementChild).toHaveClass('h-[100dvh]');

    await user.click(within(editor).getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('dialog', { name: 'Flashlight' })).toHaveTextContent('Item 2/2');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Flashlight' }).closest('[id="item-row-flashlight"]')).toHaveFocus();
  });

  it('retains bulk selection, drag handles, badges, and dense actions at 1024px', async () => {
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: query === '(min-width: 640px)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    renderBuilder();

    await screen.findByRole('button', { name: 'Expand Radio' });
    expect(screen.getByRole('button', { name: 'Radio selection checkbox' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Drag to reorder' })).not.toHaveLength(0);
    expect(screen.getAllByText('Function')).not.toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Move Radio down' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Select items' })).not.toBeInTheDocument();
  });

  it('saves an incomplete new template as an inactive draft', async () => {
    const user = userEvent.setup();
    renderNewBuilder();
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(createEquipmentCheckTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ name: '', is_active: false, compartments: [] })
    );
  });

  it('does not allow an invalid template to be published', () => {
    renderNewBuilder();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
    expect(screen.getByLabelText('Template readiness')).toHaveTextContent('! Setup');
  });

  it('does not treat structural-only items as a publishable operational compartment', async () => {
    getTemplate.mockResolvedValue({
      ...template,
      isActive: false,
      compartments: [
        {
          ...template.compartments[0],
          items: [{ ...template.compartments[0]?.items[0], id: 'note', name: 'Instructions', checkType: 'text' }],
        },
      ],
    });

    renderBuilder();

    expect(await screen.findByRole('button', { name: 'Publish' })).toBeDisabled();
    expect(screen.getByLabelText('Template readiness')).toHaveTextContent('! Locations');
  });

  it('publishes after the blocking structure issues are fixed', async () => {
    const user = userEvent.setup();
    getTemplate.mockResolvedValue({
      ...template,
      isActive: false,
      compartments: template.compartments.filter((compartment) => compartment.id !== 'bag'),
    });
    renderBuilder();
    const publish = await screen.findByRole('button', { name: 'Publish' });
    await waitFor(() => expect(publish).toBeEnabled());
    await user.click(publish);
    await waitFor(() =>
      expect(updateEquipmentCheckTemplate).toHaveBeenLastCalledWith('template-1', { is_active: true })
    );
  });

  it('persists a saved item duplicate with its configuration and server id', async () => {
    const user = userEvent.setup();
    addCheckItem.mockResolvedValue({ ...template.compartments[0]?.items[0], id: 'radio-copy', name: 'Radio (copy)' });
    renderBuilder();
    const trigger = await screen.findByLabelText('Actions for Radio');
    await user.click(trigger);
    await user.click(within(trigger.closest('details') as HTMLElement).getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(addCheckItem).toHaveBeenCalled());
    expect(updateEquipmentCheckTemplate).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Template status')).toHaveTextContent('Draft');
    expect(addCheckItem).toHaveBeenCalledWith(
      'cab',
      expect.objectContaining({ name: 'Radio (copy)', sort_order: 1, check_type: 'function', is_required: true })
    );
    expect(reorderItems).toHaveBeenCalledWith('cab', ['radio', 'radio-copy', 'flashlight']);
    expect(await screen.findByLabelText('Actions for Radio (copy)')).toBeInTheDocument();
  });

  it('allows the returned duplicate to be edited immediately without replacing it', async () => {
    const user = userEvent.setup();
    addCheckItem.mockResolvedValue({ ...template.compartments[0]?.items[0], id: 'radio-copy', name: 'Radio (copy)' });
    renderBuilder();
    const original = await screen.findByLabelText('Actions for Radio');
    await user.click(original);
    await user.click(within(original.closest('details') as HTMLElement).getByRole('button', { name: 'Duplicate' }));
    const duplicate = await screen.findByLabelText('Actions for Radio (copy)');
    await user.click(duplicate);
    await user.click(within(duplicate.closest('details') as HTMLElement).getByRole('button', { name: 'Rename' }));
    const input = await screen.findByDisplayValue('Radio (copy)');
    await user.clear(input);
    await user.type(input, 'Portable radio copy');
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('Actions for Portable radio copy')).toBeInTheDocument();
    expect(screen.getByLabelText('Actions for Radio')).toBeInTheDocument();
  });

  it('retains a successful duplicate when the page is reloaded', async () => {
    const persisted = {
      ...template,
      compartments: [
        {
          ...template.compartments[0],
          items: [
            template.compartments[0]?.items[0],
            { ...template.compartments[0]?.items[0], id: 'radio-copy', name: 'Radio (copy)', sortOrder: 1 },
          ],
        },
        ...template.compartments.slice(1),
      ],
    };
    getTemplate.mockResolvedValue(persisted);
    const view = renderBuilder();
    expect(await screen.findByLabelText('Actions for Radio (copy)')).toBeInTheDocument();
    view.unmount();
    renderBuilder();
    expect(await screen.findByLabelText('Actions for Radio (copy)')).toBeInTheDocument();
    expect(getTemplate).toHaveBeenCalledTimes(2);
  });

  it('leaves item state unchanged when persistence fails', async () => {
    const user = userEvent.setup();
    addCheckItem.mockRejectedValue(new Error('clone failed'));
    renderBuilder();
    const trigger = await screen.findByLabelText('Actions for Radio');
    await user.click(trigger);
    await user.click(within(trigger.closest('details') as HTMLElement).getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(addCheckItem).toHaveBeenCalled());
    expect(screen.queryByLabelText('Actions for Radio (copy)')).not.toBeInTheDocument();
    expect(reorderItems).not.toHaveBeenCalled();
  });

  it('clones a saved compartment with the returned child ids', async () => {
    const user = userEvent.setup();
    cloneCompartment.mockResolvedValue({
      ...template.compartments[0],
      id: 'cab-copy',
      name: 'Cab (copy)',
      items: [{ ...template.compartments[0]?.items[0], id: 'radio-copy' }],
    });
    renderBuilder();
    const trigger = await screen.findByLabelText('Actions for Cab');
    await user.click(trigger);
    await user.click(within(trigger.closest('details') as HTMLElement).getByRole('button', { name: 'Duplicate' }));
    expect(await screen.findByLabelText('Actions for Cab (copy)')).toBeInTheDocument();
    expect(cloneCompartment).toHaveBeenCalledWith('cab', 1);
  });

  it('leaves compartment state unchanged when the transactional clone fails', async () => {
    const user = userEvent.setup();
    cloneCompartment.mockRejectedValue(new Error('clone failed'));
    renderBuilder();
    const trigger = await screen.findByLabelText('Actions for Cab');
    await user.click(trigger);
    await user.click(within(trigger.closest('details') as HTMLElement).getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(cloneCompartment).toHaveBeenCalledWith('cab', 1));
    expect(screen.queryByLabelText('Actions for Cab (copy)')).not.toBeInTheDocument();
  });

  it('exposes every item action from the phone overflow without drag and drop', async () => {
    const user = userEvent.setup();
    renderBuilder();
    const trigger = await screen.findByLabelText('Actions for Radio');
    expect(trigger.closest('details')).toHaveClass('sm:hidden');
    await user.click(trigger);
    const menu = trigger.closest('details') as HTMLElement;
    expect(within(menu).getByRole('button', { name: 'Rename' })).toBeVisible();
    expect(within(menu).getByRole('button', { name: 'Move up' })).toBeVisible();
    expect(within(menu).getByRole('button', { name: 'Move down' })).toBeVisible();
    expect(within(menu).getByRole('button', { name: 'Duplicate' })).toBeVisible();
    expect(within(menu).getByLabelText(/current destination Cab/i)).toHaveTextContent('Cab / Medical bag');
    expect(within(menu).getByRole('button', { name: 'Delete' })).toHaveClass('text-red-600');
    await user.click(within(menu).getByRole('button', { name: 'Duplicate' }));
    expect(menu).not.toHaveAttribute('open');
  });

  it('offers hierarchy-aware compartment movement and omits section headers', async () => {
    const user = userEvent.setup();
    renderBuilder();
    const trigger = await screen.findByLabelText('Actions for Medical bag');
    await user.click(trigger);
    const menu = trigger.closest('details') as HTMLElement;
    expect(within(menu).getByRole('button', { name: 'Rename' })).toBeVisible();
    expect(within(menu).getByRole('button', { name: 'Duplicate' })).toBeVisible();
    const destination = within(menu).getByLabelText(/current destination Cab/i);
    expect(destination).toHaveTextContent('Cab (current)');
    expect(destination).not.toHaveTextContent('Supplies');
    expect(within(menu).getByRole('button', { name: 'Move up' })).toBeDisabled();
    expect(within(menu).getByRole('button', { name: 'Move down' })).toBeDisabled();
    expect(within(menu).getByRole('button', { name: 'Delete' })).toBeVisible();
  });
});

describe('EquipmentCheckTemplateBuilder movement persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTemplate.mockResolvedValue({
      ...template,
      compartments: [
        {
          ...template.compartments[0],
          items: [
            template.compartments[0]?.items[0],
            { ...template.compartments[0]?.items[0], id: 'mask', name: 'Oxygen mask', sortOrder: 1 },
          ],
        },
        template.compartments[1],
      ],
    });
    updateCheckItem.mockResolvedValue({});
    reorderItems.mockResolvedValue([]);
  });

  const moveSelect = async (name: string) => {
    const selects = await screen.findAllByLabelText(new RegExp(`Move ${name} to compartment`));
    return selects[selects.length - 1] as HTMLSelectElement;
  };

  it('moves an item across compartments only after persistence succeeds', async () => {
    const user = userEvent.setup();
    renderBuilder();
    await user.selectOptions(await moveSelect('Oxygen mask'), '1');
    expect(updateCheckItem).toHaveBeenCalledWith('mask', { compartment_id: 'bag', sort_order: 0 });
    expect(await screen.findByLabelText('Actions for Oxygen mask')).toBeInTheDocument();
    expect(toastSuccess).toHaveBeenCalledWith('Moved "Oxygen mask" to Medical bag');
  });

  it('keeps a rejected item in its source and does not show a success toast', async () => {
    updateCheckItem.mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    renderBuilder();
    await user.selectOptions(await moveSelect('Oxygen mask'), '1');
    expect(await screen.findByLabelText('Actions for Oxygen mask')).toBeInTheDocument();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('Could not move “Oxygen mask.” Its original location was restored.');
  });

  it('restores the prior item order when reorder persistence is rejected', async () => {
    reorderItems.mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    renderBuilder();
    const maskActions = await screen.findByLabelText('Actions for Oxygen mask');
    await user.click(maskActions);
    await user.click(within(maskActions.closest('details') as HTMLElement).getByRole('button', { name: 'Move up' }));
    expect(reorderItems).toHaveBeenCalledWith('cab', ['mask', 'radio']);
    const names = screen
      .getAllByLabelText(/Actions for (Radio|Oxygen mask)/)
      .map((node) => node.getAttribute('aria-label'));
    expect(names.indexOf('Actions for Radio')).toBeLessThan(names.indexOf('Actions for Oxygen mask'));
    expect(toastError).toHaveBeenCalledWith('Could not reorder “Oxygen mask.” Its original order was restored.');
  });

  it('reconciles rapid successful moves by stable item identity', async () => {
    const user = userEvent.setup();
    renderBuilder();
    const radio = await moveSelect('Radio');
    const mask = await moveSelect('Oxygen mask');
    await Promise.all([user.selectOptions(radio, '1'), user.selectOptions(mask, '1')]);
    expect(updateCheckItem).toHaveBeenCalledTimes(2);
    expect(await screen.findByLabelText('Actions for Radio')).toBeInTheDocument();
    expect(await screen.findByLabelText('Actions for Oxygen mask')).toBeInTheDocument();
  });
});

describe('EquipmentCheckTemplateBuilder quick add queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTemplate.mockResolvedValue(structuredClone(template));
  });

  const savedItem = (name: string, id: string) => ({
    ...template.compartments[0]?.items[0],
    id,
    name,
  });

  it('shows several rapid additions immediately, keeps focus, and serializes a slow compartment', async () => {
    const user = userEvent.setup();
    let resolveFirst!: (value: unknown) => void;
    addCheckItemsBulk
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce({ items: [savedItem('Spare batteries', 'batteries')], createdCount: 1 });
    renderBuilder();
    const input = await screen.findAllByPlaceholderText(/search inventory/i).then((inputs) => inputs[0] as HTMLElement);

    await user.type(input, 'Lantern{Enter}');
    await user.type(input, 'Spare batteries{Enter}');

    expect(screen.getByLabelText('Lantern Saving')).toBeVisible();
    expect(screen.getByLabelText('Spare batteries Saving')).toBeVisible();
    expect(input).toHaveFocus();
    expect(addCheckItemsBulk).toHaveBeenCalledTimes(1);

    resolveFirst({ items: [savedItem('Lantern', 'lantern')], createdCount: 1 });
    await waitFor(() => expect(screen.queryByLabelText('Lantern Saving')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByLabelText('Spare batteries Saving')).not.toBeInTheDocument());
    expect(screen.getByText('Lantern')).toBeVisible();
    expect(screen.getByText('Spare batteries')).toBeVisible();
    expect(addCheckItemsBulk).toHaveBeenCalledTimes(2);
  });

  it('retains a failed row, retries with the same idempotency key, and keeps successful siblings', async () => {
    const user = userEvent.setup();
    addCheckItemsBulk
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce({ items: [savedItem('Gloves', 'gloves')], createdCount: 1 })
      .mockResolvedValueOnce({ items: [savedItem('Safety vest', 'vest')], createdCount: 0, replayed: true });
    renderBuilder();
    const input = (await screen.findAllByPlaceholderText(/search inventory/i))[0] as HTMLElement;
    await user.type(input, 'Safety vest{Enter}');
    await user.type(input, 'Gloves{Enter}');

    const failed = await screen.findByLabelText('Safety vest Not saved');
    await waitFor(() => expect(screen.queryByLabelText('Gloves Saving')).not.toBeInTheDocument());
    expect(screen.getByText('Gloves')).toBeVisible();
    const firstKey = String(addCheckItemsBulk.mock.calls[0]?.[2]);
    await user.click(within(failed).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByLabelText('Safety vest Saving')).not.toBeInTheDocument());
    expect(screen.getByText('Safety vest')).toBeVisible();
    expect(addCheckItemsBulk.mock.calls[2]?.[2]).toBe(firstKey);
  });

  it('does not submit the same value again when Enter repeats', async () => {
    const user = userEvent.setup();
    addCheckItemsBulk.mockResolvedValue({ items: [savedItem('Lantern', 'lantern')], createdCount: 1 });
    renderBuilder();
    const input = (await screen.findAllByPlaceholderText(/search inventory/i))[0] as HTMLElement;
    await user.type(input, 'Lantern{Enter}{Enter}');
    expect(addCheckItemsBulk).toHaveBeenCalledTimes(1);
  });
});

describe('EquipmentCheckTemplateBuilder bulk deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTemplate.mockResolvedValue(structuredClone(template));
  });

  async function selectAndDelete() {
    const user = userEvent.setup();
    renderBuilder();
    await screen.findByText('Radio');
    await user.click(screen.getByTitle('Select all items'));
    await user.click(screen.getByRole('button', { name: 'Delete selected items' }));
    await user.click(screen.getByRole('button', { name: 'Delete 2' }));
  }

  it('removes only IDs confirmed by a completely successful response', async () => {
    deleteCheckItemsBulk.mockResolvedValue({ deletedItemIds: ['radio', 'flashlight'], replayed: false });
    await selectAndDelete();
    await waitFor(() => expect(screen.queryByText('Radio')).not.toBeInTheDocument());
    expect(screen.getAllByText(/No items yet/).length).toBeGreaterThan(0);
    expect(deleteCheckItemsBulk).toHaveBeenCalledWith('cab', ['radio', 'flashlight'], expect.any(String));
    expect(toastSuccess).toHaveBeenCalledWith('Deleted 2 items');
    expect(toastError).not.toHaveBeenCalled();
  });

  it('retains visible selected rows and never shows success after failure', async () => {
    deleteCheckItemsBulk.mockRejectedValue(new Error('Database unavailable'));
    await selectAndDelete();
    expect(await screen.findByText('Radio')).toBeVisible();
    expect(screen.getByText('Flashlight')).toBeVisible();
    expect(screen.getByText('2 selected')).toBeVisible();
    expect(toastError).toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('reuses the idempotency key when the same selected deletion is retried', async () => {
    deleteCheckItemsBulk
      .mockRejectedValueOnce(new Error('Response lost'))
      .mockResolvedValueOnce({ deletedItemIds: ['radio', 'flashlight'], replayed: true });
    const user = userEvent.setup();
    renderBuilder();
    await screen.findByText('Radio');
    await user.click(screen.getByTitle('Select all items'));

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await user.click(screen.getByRole('button', { name: 'Delete selected items' }));
      await user.click(screen.getByRole('button', { name: 'Delete 2' }));
      await waitFor(() => expect(deleteCheckItemsBulk).toHaveBeenCalledTimes(attempt + 1));
    }

    expect(deleteCheckItemsBulk.mock.calls[0]?.[2]).toBe(deleteCheckItemsBulk.mock.calls[1]?.[2]);
    await waitFor(() => expect(screen.queryByText('Radio')).not.toBeInTheDocument());
    expect(toastSuccess).toHaveBeenCalledWith('Deleted 2 items');
  });
});

describe('EquipmentCheckTemplateBuilder remaining mutation regressions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTemplate.mockResolvedValue(structuredClone(template));
    deleteCheckItem.mockResolvedValue(undefined);
    updateEquipmentCheckTemplate.mockImplementation((_id: string, payload: { is_active: boolean }) =>
      Promise.resolve({ ...structuredClone(template), isActive: payload.is_active })
    );
  });

  it('bulk-pastes atomically and reuses the idempotency key after a failed attempt', async () => {
    const user = userEvent.setup();
    addCheckItemsBulk.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({
      items: [
        { ...template.compartments[0]?.items[0], id: 'mask', name: 'Mask', sortOrder: 2 },
        { ...template.compartments[0]?.items[0], id: 'hood', name: 'Hood', sortOrder: 3 },
      ],
      createdCount: 2,
    });
    renderBuilder();
    await user.click((await screen.findAllByTitle('Switch to bulk paste (one item per line)'))[0] as HTMLElement);
    const paste = screen.getByPlaceholderText(/Paste item names here/i);
    await user.type(paste, 'Mask\nHood');
    await user.click(screen.getByRole('button', { name: 'Add All' }));
    await waitFor(() => expect(addCheckItemsBulk).toHaveBeenCalledTimes(1));
    expect(paste).toHaveValue('Mask\nHood');
    await user.click(screen.getByRole('button', { name: 'Add All' }));
    expect(await screen.findByLabelText('Actions for Mask')).toBeVisible();
    expect(addCheckItemsBulk.mock.calls[0]?.[2]).toBe(addCheckItemsBulk.mock.calls[1]?.[2]);
  });

  it('retains an individually deleted row when persistence fails', async () => {
    deleteCheckItem.mockRejectedValueOnce(new Error('denied'));
    renderBuilder();
    const actions = await screen.findByLabelText('Actions for Radio');
    await userEvent.click(actions);
    await userEvent.click(within(actions.closest('details') as HTMLElement).getByRole('button', { name: 'Delete' }));
    await confirm('Delete');
    await waitFor(() => expect(deleteCheckItem).toHaveBeenCalledWith('radio'));
    expect(screen.getByLabelText('Actions for Radio')).toBeVisible();
  });

  it('sends draft and publish state explicitly', async () => {
    const user = userEvent.setup();
    getTemplate.mockResolvedValue({
      ...template,
      isActive: false,
      compartments: template.compartments.filter((compartment) => compartment.id !== 'bag'),
    });
    renderBuilder();
    await user.click(await screen.findByRole('button', { name: 'Save draft' }));
    await waitFor(() =>
      expect(updateEquipmentCheckTemplate).toHaveBeenLastCalledWith(
        'template-1',
        expect.objectContaining({ is_active: false })
      )
    );
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() =>
      expect(updateEquipmentCheckTemplate).toHaveBeenLastCalledWith('template-1', { is_active: true })
    );
  });
});

describe('EquipmentCheckTemplateBuilder creation guidance', () => {
  it('preserves preset test instructions and marks the review step ready', async () => {
    renderNewBuilder();

    fireEvent.change(screen.getByLabelText('Template Type'), { target: { value: 'vehicle' } });
    fireEvent.click(screen.getByRole('button', { name: /use a vehicle layout/i }));
    fireEvent.click(screen.getByRole('button', { name: /engine \/ pumper/i }));
    fireEvent.click(screen.getByRole('button', { name: /preview/i }));

    expect(screen.getAllByText('Switch it on and confirm it works.').length).toBeGreaterThan(0);
    expect(screen.getByText('Review').closest('div')).toHaveTextContent(/items/);
    expect(screen.getByText('Review').parentElement?.previousElementSibling).toHaveClass('bg-green-500');
  }, 10_000);
});
