/* eslint-disable testing-library/no-node-access, @typescript-eslint/no-unsafe-return */
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../../contexts/ConfirmContext';
import EquipmentCheckTemplateBuilder from './EquipmentCheckTemplateBuilder';

const { getTemplate, updateCheckItem, reorderItems, toastSuccess, toastError } = vi.hoisted(() => ({
  getTemplate: vi.fn(),
  updateCheckItem: vi.fn(),
  reorderItems: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({ default: { success: toastSuccess, error: toastError } }));

vi.mock('@/modules/scheduling', () => ({
  schedulingService: {
    getApparatusOptions: vi.fn().mockResolvedValue({ options: [] }),
    getEquipmentCheckTemplate: (...args: unknown[]) => getTemplate(...args),
    updateCheckItem: (...args: unknown[]) => updateCheckItem(...args),
    reorderItems: (...args: unknown[]) => reorderItems(...args),
    getCsvSampleUrl: vi.fn().mockReturnValue('/sample.csv'),
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
    getTemplate.mockResolvedValue(template);
    updateCheckItem.mockResolvedValue({});
    reorderItems.mockResolvedValue([]);
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
