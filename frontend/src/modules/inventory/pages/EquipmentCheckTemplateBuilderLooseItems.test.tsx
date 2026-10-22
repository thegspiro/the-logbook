/* eslint-disable @typescript-eslint/no-unsafe-return */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../../../contexts/ConfirmContext';

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
  replaceCompartments,
  addCompartment,
  deleteCompartment,
  createEquipmentCheckTemplate,
  updateEquipmentCheckTemplate,
  toastSuccess,
  toastError,
  getApparatusOptions,
  reorderCompartments,
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
  replaceCompartments: vi.fn(),
  addCompartment: vi.fn(),
  deleteCompartment: vi.fn(),
  createEquipmentCheckTemplate: vi.fn(),
  updateEquipmentCheckTemplate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  getApparatusOptions: vi.fn().mockResolvedValue({ source: 'default', options: [] }),
  reorderCompartments: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({ default: { success: toastSuccess, error: toastError } }));

vi.mock('@/modules/scheduling', () => ({
  schedulingService: {
    getApparatusOptions: (...args: unknown[]) => getApparatusOptions(...args) as unknown,
  },
}));

// Equipment-check calls moved to modules/inventory when checklists
// became an Inventory feature; the scheduling service re-exports it.
vi.mock('@/modules/inventory/services/equipmentCheckApi', () => ({
  equipmentCheckService: {
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
    replaceCompartments: (...args: unknown[]) => replaceCompartments(...args),
    addCompartment: (...args: unknown[]) => addCompartment(...args),
    deleteCompartment: (...args: unknown[]) => deleteCompartment(...args),
    createEquipmentCheckTemplate: (...args: unknown[]) => createEquipmentCheckTemplate(...args),
    updateEquipmentCheckTemplate: (...args: unknown[]) => updateEquipmentCheckTemplate(...args),
    reorderCompartments: (...args: unknown[]) => reorderCompartments(...args),
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

/**
 * Items placed directly on the checklist, the Present type, and Date lines
 * that must carry their date.
 */

const AUTOSAVE_DEBOUNCE_MS = 1500;

const line = (overrides: Record<string, unknown>) => ({
  compartmentId: 'cab',
  sortOrder: 0,
  checkType: 'function',
  isRequired: true,
  hasExpiration: false,
  expirationWarningDays: 30,
  ...overrides,
});

const template = (compartments: Array<Record<string, unknown>>) => ({
  id: 'template-1',
  organizationId: 'org-1',
  name: 'Engine check',
  checkTiming: 'start_of_shift',
  templateType: 'equipment',
  isActive: false,
  sortOrder: 0,
  compartments,
});

const cab = (items: Array<Record<string, unknown>> = [line({ id: 'radio', name: 'Radio' })]) => ({
  id: 'cab',
  templateId: 'template-1',
  name: 'Cab',
  sortOrder: 0,
  containerType: 'compartment',
  items,
});

const rear = () => ({
  id: 'rear',
  templateId: 'template-1',
  name: 'Rear compartment',
  sortOrder: 1,
  containerType: 'compartment',
  items: [line({ id: 'cones', compartmentId: 'rear', name: 'Traffic cones' })],
});

const loose = (items: Array<Record<string, unknown>> = []) => ({
  id: 'loose',
  templateId: 'template-1',
  name: '',
  sortOrder: 2,
  containerType: 'compartment',
  isInline: true,
  items,
});

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

const laptop = () => {
  vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
    matches: (() => {
      const minWidth = /min-width:\s*(\d+)px/.exec(query);
      return minWidth ? 1440 >= Number(minWidth[1]) : false;
    })(),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of [
    getTemplate,
    updateCheckItem,
    updateCompartment,
    addCompartment,
    deleteCompartment,
    reorderCompartments,
    updateEquipmentCheckTemplate,
    getApparatusOptions,
  ])
    mock.mockReset();
  getApparatusOptions.mockResolvedValue({ options: [], source: 'default' });
  updateCheckItem.mockResolvedValue({});
  updateCompartment.mockResolvedValue({});
  deleteCompartment.mockResolvedValue(undefined);
  reorderCompartments.mockResolvedValue(undefined);
  updateEquipmentCheckTemplate.mockResolvedValue(template([]));
  getTemplate.mockResolvedValue(template([cab(), rear()]));
  laptop();
});

describe('the Present type', () => {
  it('is one of the answer types a row offers', async () => {
    const user = userEvent.setup();
    renderBuilder();

    const types = await screen.findByRole('group', { name: 'Check type for Radio' });
    await user.click(within(types).getByRole('button', { name: /Present/ }));

    await waitFor(
      () => expect(updateCheckItem).toHaveBeenCalledWith('radio', expect.objectContaining({ check_type: 'presence' })),
      { timeout: AUTOSAVE_DEBOUNCE_MS + 2000 }
    );
  });
});

describe('a Date line', () => {
  it('turns expiration on when Date is chosen', async () => {
    const user = userEvent.setup();
    renderBuilder();

    const types = await screen.findByRole('group', { name: 'Check type for Radio' });
    await user.click(within(types).getByRole('button', { name: /Date/ }));

    await waitFor(
      () =>
        expect(updateCheckItem).toHaveBeenCalledWith(
          'radio',
          expect.objectContaining({ check_type: 'expiry', has_expiration: true })
        ),
      { timeout: AUTOSAVE_DEBOUNCE_MS + 2000 }
    );
  });

  it('blocks publishing without a date, and the blocker goes to the date', async () => {
    const user = userEvent.setup();
    getTemplate.mockResolvedValue(
      template([cab([line({ id: 'pads', name: 'AED pads', checkType: 'expiry', hasExpiration: true })])])
    );
    renderBuilder();

    await user.click(await screen.findByRole('button', { name: /AED pads needs an expiration date/ }));
    expect(screen.getByLabelText('Expiration date for AED pads')).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
  });

  it('leaves a linked Date line to the lots aboard', async () => {
    getTemplate.mockResolvedValue(
      template([
        cab([
          line({ id: 'pads', name: 'AED pads', checkType: 'expiry', hasExpiration: true, inventoryItemId: 'inv-1' }),
        ]),
      ])
    );
    renderBuilder();

    await screen.findByRole('group', { name: 'Check type for AED pads' });
    expect(screen.queryByRole('button', { name: /AED pads needs an expiration date/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Expiration date for AED pads')).not.toBeInTheDocument();
  });
});

describe('items placed directly on the checklist', () => {
  it('shows them without a heading, and asks for no name', async () => {
    getTemplate.mockResolvedValue(
      template([cab(), loose([line({ id: 'chocks', compartmentId: 'loose', name: 'Wheel chocks' })])])
    );
    renderBuilder();

    const group = await screen.findByTestId('inline-group-loose');
    expect(within(group).getByText(/Directly on the checklist/)).toBeInTheDocument();
    expect(within(group).queryByLabelText('Location name')).not.toBeInTheDocument();
    expect(await screen.findByRole('group', { name: 'Check type for Wheel chocks' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /has no name/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled();
  });

  it('adds a place for them between two locations', async () => {
    const user = userEvent.setup();
    addCompartment.mockResolvedValue({ id: 'new-loose', templateId: 'template-1', name: '', sortOrder: 2, items: [] });
    renderBuilder();

    // Spot 0 is above Cab, spot 1 between Cab and the rear compartment.
    await user.click(await screen.findByTestId('add-item-here-1'));

    await waitFor(() =>
      expect(addCompartment).toHaveBeenCalledWith('template-1', expect.objectContaining({ name: '', is_inline: true }))
    );
    await waitFor(() => expect(reorderCompartments).toHaveBeenCalledWith('template-1', ['cab', 'new-loose', 'rear']));
    expect(await screen.findByTestId('inline-group-new-loose')).toBeInTheDocument();
  });

  it('uses the group already beside a spot rather than adding a second', async () => {
    const user = userEvent.setup();
    getTemplate.mockResolvedValue(
      template([cab(), loose([line({ id: 'chocks', compartmentId: 'loose', name: 'Chocks' })])])
    );
    renderBuilder();

    // Spot 2 is below the loose group, the last top-level row.
    await user.click(await screen.findByTestId('add-item-here-2'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(addCompartment).not.toHaveBeenCalled();
  });

  it('removes an emptied group on save instead of flagging it', async () => {
    const user = userEvent.setup();
    getTemplate.mockResolvedValue(template([cab(), loose()]));
    renderBuilder();

    await screen.findByTestId('inline-group-loose');
    expect(screen.queryByRole('button', { name: /is empty/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled();

    // Any edit, so there is something to save.
    fireEvent.change(screen.getByLabelText('Location name'), { target: { value: 'Cab interior' } });
    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(deleteCompartment).toHaveBeenCalledWith('loose'));
    expect(updateCompartment).not.toHaveBeenCalledWith('loose', expect.anything());
  });
});

describe('an emptied group of checklist items', () => {
  // Item edits autosave, so an author may never press Save; a headingless
  // group left empty would have nothing to find it by.
  it('is removed as soon as its last item is deleted', async () => {
    const user = userEvent.setup();
    deleteCheckItem.mockReset();
    deleteCheckItem.mockResolvedValue(undefined);
    getTemplate.mockResolvedValue(
      template([cab(), loose([line({ id: 'chocks', compartmentId: 'loose', name: 'Wheel chocks' })])])
    );
    renderBuilder();

    await user.click(await screen.findByRole('button', { name: 'Delete Wheel chocks' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteCheckItem).toHaveBeenCalledWith('chocks'));
    await waitFor(() => expect(deleteCompartment).toHaveBeenCalledWith('loose'));
    await waitFor(() => expect(screen.queryByTestId('inline-group-loose')).not.toBeInTheDocument());
  });

  it('is removed when its last item is moved into a location', async () => {
    const user = userEvent.setup();
    getTemplate.mockResolvedValue(
      template([cab(), loose([line({ id: 'chocks', compartmentId: 'loose', name: 'Wheel chocks' })])])
    );
    renderBuilder();

    await user.click(await screen.findByLabelText('Actions for Wheel chocks'));
    const selects = await screen.findAllByLabelText(/Move Wheel chocks to compartment/);
    // Index 0 is Cab in this template.
    await user.selectOptions(selects[selects.length - 1] as HTMLSelectElement, '0');

    await waitFor(() =>
      expect(updateCheckItem).toHaveBeenCalledWith('chocks', expect.objectContaining({ compartment_id: 'cab' }))
    );
    await waitFor(() => expect(deleteCompartment).toHaveBeenCalledWith('loose'));
  });

  it('stays while it still holds an item', async () => {
    const user = userEvent.setup();
    deleteCheckItem.mockReset();
    deleteCheckItem.mockResolvedValue(undefined);
    getTemplate.mockResolvedValue(
      template([
        cab(),
        loose([
          line({ id: 'chocks', compartmentId: 'loose', name: 'Wheel chocks' }),
          line({ id: 'maps', compartmentId: 'loose', name: 'Map book', sortOrder: 1 }),
        ]),
      ])
    );
    renderBuilder();

    await user.click(await screen.findByRole('button', { name: 'Delete Wheel chocks' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteCheckItem).toHaveBeenCalledWith('chocks'));
    expect(deleteCompartment).not.toHaveBeenCalled();
    expect(screen.getByTestId('inline-group-loose')).toBeInTheDocument();
  });

  it('stays on screen when the server refuses the delete, for Save to drop later', async () => {
    const user = userEvent.setup();
    deleteCheckItem.mockReset();
    deleteCheckItem.mockResolvedValue(undefined);
    deleteCompartment.mockRejectedValue(new Error('offline'));
    getTemplate.mockResolvedValue(
      template([cab(), loose([line({ id: 'chocks', compartmentId: 'loose', name: 'Wheel chocks' })])])
    );
    renderBuilder();

    await user.click(await screen.findByRole('button', { name: 'Delete Wheel chocks' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteCompartment).toHaveBeenCalledWith('loose'));
    expect(screen.getByTestId('inline-group-loose')).toBeInTheDocument();
  });
});

describe('switching "in place" checks to Present', () => {
  const inPlace = (id: string, name: string, sortOrder = 0) =>
    line({ id, name, sortOrder, description: 'Confirm the item is in place.' });

  it('switches every marked Works line in one step, and nothing else', async () => {
    const user = userEvent.setup();
    getTemplate.mockResolvedValue(
      template([
        cab([inPlace('scba', 'SCBA mounted'), line({ id: 'radio', name: 'Radio', sortOrder: 1 })]),
        {
          ...rear(),
          items: [{ ...inPlace('cones', 'Traffic cones'), compartmentId: 'rear' }],
        },
      ])
    );
    renderBuilder();

    await user.click(await screen.findByRole('button', { name: /Switch .in place. checks to Present \(2\)/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('SCBA mounted');
    expect(dialog).toHaveTextContent('Traffic cones');
    expect(dialog).not.toHaveTextContent('Radio');
    await user.click(within(dialog).getByRole('button', { name: 'Switch to Present' }));

    await waitFor(
      () => expect(updateCheckItem).toHaveBeenCalledWith('scba', expect.objectContaining({ check_type: 'presence' })),
      { timeout: AUTOSAVE_DEBOUNCE_MS + 2000 }
    );
    await waitFor(() =>
      expect(updateCheckItem).toHaveBeenCalledWith('cones', expect.objectContaining({ check_type: 'presence' }))
    );
    expect(updateCheckItem).not.toHaveBeenCalledWith('radio', expect.anything());
    expect(screen.queryByRole('button', { name: /Switch .in place. checks/ })).not.toBeInTheDocument();
  });

  it('changes nothing when the author keeps them', async () => {
    const user = userEvent.setup();
    getTemplate.mockResolvedValue(template([cab([inPlace('scba', 'SCBA mounted')])]));
    renderBuilder();

    await user.click(await screen.findByRole('button', { name: /Switch .in place. checks to Present \(1\)/ }));
    await user.click(await screen.findByRole('button', { name: 'Leave them' }));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, AUTOSAVE_DEBOUNCE_MS + 200));
    });
    expect(updateCheckItem).not.toHaveBeenCalled();
  });

  it('is not offered when no line carries the old instruction', async () => {
    renderBuilder();
    await screen.findByRole('group', { name: 'Check type for Radio' });
    expect(screen.queryByRole('button', { name: /Switch .in place. checks/ })).not.toBeInTheDocument();
  });
});
