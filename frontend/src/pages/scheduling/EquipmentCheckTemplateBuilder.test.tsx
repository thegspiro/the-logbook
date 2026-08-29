/* eslint-disable testing-library/no-node-access, @typescript-eslint/no-unsafe-return */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../../contexts/ConfirmContext';
import EquipmentCheckTemplateBuilder from './EquipmentCheckTemplateBuilder';

const getTemplate = vi.fn();
const updateCheckItem = vi.fn();
const reorderItems = vi.fn();
const successToast = vi.fn();
const errorToast = vi.fn();

vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => successToast(...args),
    error: (...args: unknown[]) => errorToast(...args),
  },
}));

vi.mock('@/modules/scheduling', () => ({
  schedulingService: {
    getApparatusOptions: vi.fn().mockResolvedValue({ options: [] }),
    getEquipmentCheckTemplate: (...args: unknown[]) => getTemplate(...args),
    getCsvSampleUrl: vi.fn().mockReturnValue('/sample.csv'),
    updateCheckItem: (...args: unknown[]) => updateCheckItem(...args),
    reorderItems: (...args: unknown[]) => reorderItems(...args),
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
          id: 'oxygen-mask',
          compartmentId: 'cab',
          name: 'Oxygen mask',
          sortOrder: 0,
          checkType: 'quantity',
          isRequired: true,
          hasExpiration: false,
          expirationWarningDays: 30,
        },
        {
          id: 'radio',
          compartmentId: 'cab',
          name: 'Radio',
          sortOrder: 1,
          checkType: 'function',
          isRequired: true,
          hasExpiration: false,
          expirationWarningDays: 30,
        },
      ],
    },
    {
      id: 'rear',
      templateId: 'template-1',
      name: 'Rear shelf',
      sortOrder: 2,
      containerType: 'compartment',
      items: [],
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
    getTemplate.mockResolvedValue(template);
    updateCheckItem.mockReset().mockResolvedValue(undefined);
    reorderItems.mockReset().mockResolvedValue(undefined);
    successToast.mockReset();
    errorToast.mockReset();
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
    getTemplate.mockResolvedValue(template);
    updateCheckItem.mockReset().mockResolvedValue(undefined);
    reorderItems.mockReset().mockResolvedValue(undefined);
    successToast.mockReset();
    errorToast.mockReset();
  });

  it('moves an item across compartments only after persistence succeeds', async () => {
    const user = userEvent.setup();
    renderBuilder();
    const move = await screen.findByLabelText('Move Oxygen mask to another compartment');
    await user.selectOptions(move, '2');

    await waitFor(() =>
      expect(updateCheckItem).toHaveBeenCalledWith('oxygen-mask', expect.objectContaining({ compartment_id: 'bag' }))
    );
    expect(successToast).toHaveBeenCalledWith('Moved "Oxygen mask" to Medical bag');
    expect(
      screen.getByLabelText(/Move Oxygen mask to compartment; current destination Cab \/ Medical bag/)
    ).toBeInTheDocument();
  });

  it('keeps a rejected move at its source, expanded, and does not show success', async () => {
    updateCheckItem.mockRejectedValueOnce(new Error('network unavailable'));
    const user = userEvent.setup();
    renderBuilder();
    await user.selectOptions(await screen.findByLabelText('Move Oxygen mask to another compartment'), '2');

    await waitFor(() => expect(errorToast).toHaveBeenCalled());
    expect(successToast).not.toHaveBeenCalled();
    expect(errorToast).toHaveBeenCalledWith('Could not move “Oxygen mask.” Its original location was restored.');
    expect(screen.getByLabelText('Collapse Oxygen mask')).toBeInTheDocument();
    expect(screen.getByLabelText(/Move Oxygen mask to compartment; current destination Cab$/)).toBeInTheDocument();
  });

  it('keeps the prior item order when reorder persistence is rejected', async () => {
    reorderItems.mockRejectedValueOnce(new Error('network unavailable'));
    const user = userEvent.setup();
    renderBuilder();
    await user.click(await screen.findByLabelText('Move Oxygen mask down'));

    await waitFor(() => expect(errorToast).toHaveBeenCalled());
    const names = screen.getAllByText(/^(Oxygen mask|Radio)$/).map((node) => node.textContent);
    expect(names.slice(0, 2)).toEqual(['Oxygen mask', 'Radio']);
  });

  it('serializes rapid moves and reconciles each one by stable item id', async () => {
    let resolveFirst: (() => void) | undefined;
    updateCheckItem
      .mockImplementationOnce(() => new Promise<void>((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    renderBuilder();
    const move = await screen.findByLabelText('Move Oxygen mask to another compartment');
    await user.selectOptions(move, '2');
    await user.selectOptions(move, '1');
    expect(updateCheckItem).toHaveBeenCalledTimes(1);

    resolveFirst?.();
    await waitFor(() => expect(updateCheckItem).toHaveBeenCalledTimes(2));
    expect(updateCheckItem.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ compartment_id: 'rear' }));
    expect(
      screen.getByLabelText(/Move Oxygen mask to compartment; current destination Rear shelf/)
    ).toBeInTheDocument();
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
