/* eslint-disable testing-library/no-node-access, @typescript-eslint/no-unsafe-return */
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../../contexts/ConfirmContext';
import EquipmentCheckTemplateBuilder from './EquipmentCheckTemplateBuilder';

const getTemplate = vi.fn();
const addCheckItem = vi.fn();
const reorderItems = vi.fn();
const cloneCompartment = vi.fn();

vi.mock('@/modules/scheduling', () => ({
  schedulingService: {
    getApparatusOptions: vi.fn().mockResolvedValue({ options: [] }),
    getEquipmentCheckTemplate: (...args: unknown[]) => getTemplate(...args),
    addCheckItem: (...args: unknown[]) => addCheckItem(...args),
    reorderItems: (...args: unknown[]) => reorderItems(...args),
    cloneCompartment: (...args: unknown[]) => cloneCompartment(...args),
    updateCheckItem: vi.fn().mockResolvedValue(undefined),
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
    getTemplate.mockResolvedValue(template);
    addCheckItem.mockResolvedValue({
      ...template.compartments[0]?.items[0],
      id: 'radio-copy',
      name: 'Radio (copy)',
      sortOrder: 1,
    });
    reorderItems.mockResolvedValue(undefined);
    cloneCompartment.mockResolvedValue({
      ...template.compartments[0],
      id: 'cab-copy',
      name: 'Cab (copy)',
      sortOrder: 1,
      items: [{ ...template.compartments[0]?.items[0], id: 'radio-in-cab-copy', compartmentId: 'cab-copy' }],
    });
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

  it('persists a complete saved item duplicate and keeps its returned ID editable', async () => {
    const user = userEvent.setup();
    renderBuilder();
    await user.click(await screen.findByLabelText('Duplicate Radio'));

    expect(addCheckItem).toHaveBeenCalledWith(
      'cab',
      expect.objectContaining({ name: 'Radio (copy)', sort_order: 1, check_type: 'function', is_required: true })
    );
    await user.click(await screen.findByLabelText('Expand Radio (copy)'));
    const names = screen.getAllByPlaceholderText('Item name');
    const duplicateName = names.find((input) => (input as HTMLInputElement).value === 'Radio (copy)');
    expect(duplicateName).toBeDefined();
    await user.clear(duplicateName as HTMLInputElement);
    await user.type(duplicateName as HTMLInputElement, 'Portable radio copy');
    expect(duplicateName).toHaveValue('Portable radio copy');
  });

  it('persists a compartment duplicate with saved child IDs', async () => {
    const user = userEvent.setup();
    renderBuilder();
    await user.click(await screen.findByLabelText('Duplicate Cab'));
    expect(cloneCompartment).toHaveBeenCalledWith('cab');
    expect((await screen.findAllByText('Cab (copy)')).length).toBeGreaterThan(0);
    expect((await cloneCompartment.mock.results[0]!.value).items[0].id).toBe('radio-in-cab-copy');
  });

  it('leaves the compartment list unchanged when cloning fails', async () => {
    cloneCompartment.mockRejectedValueOnce(new Error('clone failed'));
    const user = userEvent.setup();
    renderBuilder();
    await user.click(await screen.findByLabelText('Duplicate Cab'));
    expect(screen.queryByText('Cab (copy)')).not.toBeInTheDocument();
  });

  it('shows successful server duplicates again after a reload', async () => {
    const user = userEvent.setup();
    const view = renderBuilder();
    await user.click(await screen.findByLabelText('Duplicate Radio'));
    view.unmount();
    getTemplate.mockResolvedValueOnce({
      ...template,
      compartments: [
        {
          ...template.compartments[0],
          items: [...template.compartments[0]!.items, await addCheckItem.mock.results[0]!.value],
        },
        ...template.compartments.slice(1),
      ],
    });
    renderBuilder();
    expect(await screen.findByText('Radio (copy)')).toBeInTheDocument();
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
