/* eslint-disable testing-library/no-node-access, @typescript-eslint/no-unsafe-return */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../../contexts/ConfirmContext';

const getTemplate = vi.fn();
const addCheckItem = vi.fn();
const addCheckItemsBulk = vi.fn();
const deleteCheckItem = vi.fn();
const reorderItems = vi.fn();
const reorderCompartments = vi.fn();
const updateCheckItem = vi.fn();
const updateCompartment = vi.fn();
const updateTemplate = vi.fn();
const unsavedChanges = vi.fn();

vi.mock('@/modules/scheduling', () => ({
  schedulingService: {
    getApparatusOptions: vi.fn().mockResolvedValue({ options: [] }),
    getEquipmentCheckTemplate: (...args: unknown[]) => getTemplate(...args),
    addCheckItem: (...args: unknown[]) => addCheckItem(...args),
    addCheckItemsBulk: (...args: unknown[]) => addCheckItemsBulk(...args),
    deleteCheckItem: (...args: unknown[]) => deleteCheckItem(...args),
    reorderItems: (...args: unknown[]) => reorderItems(...args),
    reorderCompartments: (...args: unknown[]) => reorderCompartments(...args),
    updateCheckItem: (...args: unknown[]) => updateCheckItem(...args),
    updateCompartment: (...args: unknown[]) => updateCompartment(...args),
    updateEquipmentCheckTemplate: (...args: unknown[]) => updateTemplate(...args),
    getCsvSampleUrl: vi.fn().mockReturnValue('/sample.csv'),
  },
}));

vi.mock('@/hooks/useUnsavedChanges', () => ({
  useUnsavedChanges: (...args: unknown[]) => unsavedChanges(...args),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector?: (state: { checkPermission: () => boolean }) => unknown) => {
    const state = { checkPermission: () => false };
    return selector ? selector(state) : state;
  },
}));

// The service and hook mocks must be registered before this import. Vitest
// hoists vi.mock, while keeping this ordering makes the dependency boundary
// explicit and prevents the real API singleton from being captured.
import EquipmentCheckTemplateBuilder from './EquipmentCheckTemplateBuilder';

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

const savedItem = (id: string, name: string) => ({
  id,
  compartmentId: 'cab',
  name,
  sortOrder: 2,
  checkType: 'function',
  isRequired: true,
  hasExpiration: false,
  expirationWarningDays: 30,
});

async function confirmDelete(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: /^Delete(?: \d+)?$/ }));
}

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

describe('EquipmentCheckTemplateBuilder responsive actions', () => {
  beforeEach(() => getTemplate.mockResolvedValue(template));

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

describe('EquipmentCheckTemplateBuilder creation guidance', () => {
  it('preserves preset test instructions and marks the review step ready', async () => {
    const user = userEvent.setup();
    renderNewBuilder();

    await user.selectOptions(screen.getByLabelText('Template Type'), 'vehicle');
    await user.click(screen.getByRole('button', { name: /use a vehicle layout/i }));
    await user.click(screen.getByRole('button', { name: /engine \/ pumper/i }));
    await user.click(screen.getByRole('button', { name: /preview/i }));

    expect(screen.getAllByText('Switch it on and confirm it works.').length).toBeGreaterThan(0);
    expect(screen.getByText('Review').closest('div')).toHaveTextContent(/items/);
    expect(screen.getByText('Review').parentElement?.previousElementSibling).toHaveClass('bg-green-500');
  }, 10_000);
});

describe('EquipmentCheckTemplateBuilder persisted mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addCheckItem.mockReset();
    addCheckItemsBulk.mockReset();
    deleteCheckItem.mockReset();
    getTemplate.mockResolvedValue(template);
    deleteCheckItem.mockResolvedValue(undefined);
    reorderItems.mockResolvedValue(undefined);
    reorderCompartments.mockResolvedValue(undefined);
    updateCheckItem.mockResolvedValue(undefined);
    updateCompartment.mockResolvedValue(undefined);
    updateTemplate.mockResolvedValue(undefined);
    addCheckItem.mockResolvedValue(savedItem('created', 'Created'));
  });

  it('quick-adds with the exact payload, retains input on failure, and permits retry', async () => {
    const user = userEvent.setup();
    addCheckItem.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(savedItem('mask', 'Mask'));
    renderBuilder();
    const input = (await screen.findAllByPlaceholderText('Search inventory or type a new item name…'))[0]!;

    await user.type(input, '  Mask  {Enter}');
    expect(addCheckItem).toHaveBeenNthCalledWith(1, 'cab', { name: 'Mask', sort_order: 2 });
    expect(input).toHaveValue('');
    expect(screen.queryByDisplayValue('Mask')).not.toBeInTheDocument();

    await user.type(input, ' Mask {Enter}');
    expect(addCheckItem).toHaveBeenNthCalledWith(2, 'cab', { name: 'Mask', sort_order: 2 });
    expect(await screen.findByText('Mask')).toBeVisible();
    expect(input).toHaveValue('');
    expect(unsavedChanges).toHaveBeenLastCalledWith(expect.objectContaining({ hasChanges: false }));
  });

  it('coalesces rapid quick-add submissions while the first request is pending', async () => {
    const user = userEvent.setup();
    let resolveRequest!: (item: ReturnType<typeof savedItem>) => void;
    addCheckItem.mockReturnValue(new Promise((resolve) => (resolveRequest = resolve)));
    renderBuilder();
    const input = (await screen.findAllByPlaceholderText('Search inventory or type a new item name…'))[0]!;
    await user.type(input, 'Gloves');
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(addCheckItem).toHaveBeenCalledTimes(1);
    await act(async () => resolveRequest(savedItem('gloves', 'Gloves')));
    await vi.waitFor(() => expect(addCheckItem).toHaveBeenCalledTimes(1));
  });

  it('bulk-pastes atomically and reuses the idempotency key after a failed attempt', async () => {
    const user = userEvent.setup();
    addCheckItemsBulk.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({
      items: [savedItem('mask', 'Mask'), savedItem('gloves', 'Gloves')],
      createdCount: 2,
    });
    renderBuilder();
    await user.click((await screen.findAllByTitle('Switch to bulk paste (one item per line)'))[0]!);
    const textarea = screen.getAllByPlaceholderText(/Paste item names here/)[0]!;
    await user.type(textarea, 'Mask{Enter}Gloves');
    await user.click(screen.getByRole('button', { name: 'Add All' }));
    const firstKey = addCheckItemsBulk.mock.calls[0]?.[2];
    expect(addCheckItemsBulk).toHaveBeenNthCalledWith(1, 'cab', [{ name: 'Mask' }, { name: 'Gloves' }], firstKey);
    expect(textarea).toHaveValue('Mask\nGloves');
    await user.click(screen.getByRole('button', { name: 'Add All' }));
    expect(addCheckItemsBulk).toHaveBeenNthCalledWith(2, 'cab', [{ name: 'Mask' }, { name: 'Gloves' }], firstKey);
    expect(await screen.findByText('Mask')).toBeVisible();
    expect(screen.getByText('Gloves')).toBeVisible();
  });

  it('retains a row when individual deletion fails', async () => {
    const user = userEvent.setup();
    deleteCheckItem.mockRejectedValueOnce(new Error('forbidden'));
    renderBuilder();
    const trigger = await screen.findByLabelText('Actions for Radio');
    await user.click(trigger);
    await user.click(within(trigger.closest('details') as HTMLElement).getByRole('button', { name: 'Delete' }));
    await confirmDelete(user);
    expect(deleteCheckItem).toHaveBeenCalledWith('radio');
    expect(screen.getAllByText('Radio').length).toBeGreaterThan(0);
  });

  it('bulk deletion removes successes but retains and selects failures', async () => {
    const user = userEvent.setup();
    deleteCheckItem.mockImplementation((id: string) =>
      id === 'flashlight' ? Promise.reject(new Error('locked')) : Promise.resolve()
    );
    renderBuilder();
    await user.click(await screen.findByTitle('Select all items'));
    await user.click(screen.getByLabelText('Delete selected items'));
    await confirmDelete(user);
    expect(deleteCheckItem.mock.calls).toEqual([['flashlight'], ['radio']]);
    expect(screen.queryByText('Radio')).not.toBeInTheDocument();
    expect(screen.getAllByText('Flashlight').length).toBeGreaterThan(0);
    expect(screen.getByText('1 selected')).toBeVisible();
  });

  it('persists an edit-mode duplicate only on save and preserves its complete create payload', async () => {
    const user = userEvent.setup();
    renderBuilder();
    const trigger = await screen.findByLabelText('Actions for Radio');
    await user.click(trigger);
    await user.click(within(trigger.closest('details') as HTMLElement).getByRole('button', { name: 'Duplicate' }));
    expect(screen.getAllByText('Radio (copy)').length).toBeGreaterThan(0);
    expect(addCheckItem).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /save/i }));
    const warning = await screen.findByRole('dialog');
    await user.click(within(warning).getByRole('button', { name: 'Save anyway' }));
    await vi.waitFor(() => expect(updateCheckItem).toHaveBeenCalled());
    expect(updateCheckItem).toHaveBeenCalledWith(
      'radio',
      expect.objectContaining({ name: 'Radio', check_type: 'function', is_required: true })
    );
    expect(addCheckItem).toHaveBeenCalledWith(
      'cab',
      expect.objectContaining({ name: 'Radio (copy)', sort_order: 1, check_type: 'function', is_required: true })
    );
  });

  it('rolls back item order when reorder persistence fails', async () => {
    const user = userEvent.setup();
    reorderItems.mockRejectedValueOnce(new Error('offline'));
    renderBuilder();
    const trigger = await screen.findByLabelText('Actions for Flashlight');
    await user.click(trigger);
    await user.click(within(trigger.closest('details') as HTMLElement).getByRole('button', { name: 'Move up' }));
    expect(reorderItems).toHaveBeenCalledWith('cab', ['flashlight', 'radio']);
    await vi.waitFor(() => {
      const names = screen
        .getAllByLabelText(/Actions for (Radio|Flashlight)/)
        .map((button) => button.getAttribute('aria-label'));
      expect(names).toEqual(['Actions for Radio', 'Actions for Flashlight']);
    });
  });

  it('sends draft and publish state explicitly and clears the unsaved prompt after save', async () => {
    const user = userEvent.setup();
    renderBuilder();
    const active = await screen.findByRole('checkbox', { name: 'Active' });
    await user.click(active);
    expect(unsavedChanges).toHaveBeenLastCalledWith(expect.objectContaining({ hasChanges: true }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save anyway' }));
    await vi.waitFor(() =>
      expect(updateTemplate).toHaveBeenCalledWith('template-1', expect.objectContaining({ is_active: false }))
    );
    expect(unsavedChanges).toHaveBeenLastCalledWith(expect.objectContaining({ hasChanges: false }));
  });
});
