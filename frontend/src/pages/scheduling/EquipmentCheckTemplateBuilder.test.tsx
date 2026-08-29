/* eslint-disable testing-library/no-node-access, @typescript-eslint/no-unsafe-return */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../../contexts/ConfirmContext';
import EquipmentCheckTemplateBuilder from './EquipmentCheckTemplateBuilder';

const getTemplate = vi.fn();
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
