/* eslint-disable testing-library/no-node-access, @typescript-eslint/no-unsafe-return */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../../contexts/ConfirmContext';
import EquipmentCheckTemplateBuilder from './EquipmentCheckTemplateBuilder';

const getTemplate = vi.fn();
const addCheckItem = vi.fn();
const reorderItems = vi.fn();
const cloneCompartment = vi.fn();
const addCheckItemsBulk = vi.fn();
const deleteCheckItemsBulk = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

vi.mock('@/modules/scheduling', () => ({
  schedulingService: {
    getApparatusOptions: vi.fn().mockResolvedValue({ options: [] }),
    getEquipmentCheckTemplate: (...args: unknown[]) => getTemplate(...args),
    addCheckItem: (...args: unknown[]) => addCheckItem(...args),
    reorderItems: (...args: unknown[]) => reorderItems(...args),
    cloneCompartment: (...args: unknown[]) => cloneCompartment(...args),
    addCheckItemsBulk: (...args: unknown[]) => addCheckItemsBulk(...args),
    getCsvSampleUrl: vi.fn().mockReturnValue('/sample.csv'),
    deleteCheckItemsBulk: (...args: unknown[]) => deleteCheckItemsBulk(...args),
  },
}));

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

describe('EquipmentCheckTemplateBuilder responsive actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTemplate.mockResolvedValue(structuredClone(template));
    reorderItems.mockResolvedValue(undefined);
  });

  it('persists a saved item duplicate with its configuration and server id', async () => {
    const user = userEvent.setup();
    addCheckItem.mockResolvedValue({ ...template.compartments[0]?.items[0], id: 'radio-copy', name: 'Radio (copy)' });
    renderBuilder();
    const trigger = await screen.findByLabelText('Actions for Radio');
    await user.click(trigger);
    await user.click(within(trigger.closest('details') as HTMLElement).getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(addCheckItem).toHaveBeenCalled());
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
