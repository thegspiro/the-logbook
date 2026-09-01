/* eslint-disable testing-library/no-node-access, @typescript-eslint/no-unsafe-return */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  deleteCompartmentsBulk,
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
  deleteCompartmentsBulk: vi.fn(),
  createEquipmentCheckTemplate: vi.fn(),
  updateEquipmentCheckTemplate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({ default: { success: toastSuccess, error: toastError } }));

vi.mock('@/modules/scheduling', () => ({
  schedulingService: {
    getApparatusOptions: vi.fn().mockResolvedValue({ options: [] }),
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
    deleteCompartmentsBulk: (...args: unknown[]) => deleteCompartmentsBulk(...args),
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
          <Route path="/inventory/admin/checklists/templates/:templateId" element={null} />
        </Routes>
      </ConfirmProvider>
    </MemoryRouter>
  );
}

async function confirm(label: string | RegExp) {
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: label }));
}

/**
 * Point the mocked `matchMedia` at a viewport. The global mock in
 * `src/test/setup.ts` answers `false` to every query, i.e. phone width, and
 * `vi.clearAllMocks()` clears recorded calls but keeps implementations — so a
 * viewport set by one `describe` survives into the next one unless it is set
 * again. Tests that depend on a width should say which one they mean.
 */
const VIEWPORT_WIDTHS = { phone: 390, tablet: 900, laptop: 1440 } as const;

const mockViewport = (width: keyof typeof VIEWPORT_WIDTHS) => {
  vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
    // Resolve against a real pixel width rather than one hard-coded query: the
    // page asks about 640px for the row layout and 1152px for the rail, and
    // matching only the first would leave the rail off at every width.
    matches: (() => {
      const minWidth = /min-width:\s*(\d+)px/.exec(query);
      return minWidth ? VIEWPORT_WIDTHS[width] >= Number(minWidth[1]) : false;
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
    renderBuilder();

    const radioSummary = await screen.findByRole('button', { name: 'Edit Radio' });
    expect(radioSummary).toHaveClass('min-h-[44px]');
    expect(within(radioSummary).getByText('Function · Required')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Select Radio' })).not.toBeInTheDocument();
    expect(screen.getAllByLabelText('Actions for Radio')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Select items' }));
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select Radio' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Radio selection checkbox' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Radio' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Select Radio' }));
    expect(screen.getByRole('button', { name: 'Deselect Radio' })).toBeInTheDocument();
    const actionBar = screen.getByLabelText('Checklist action bar');
    expect(actionBar).toHaveClass('action-bar-safe');
    expect(within(actionBar).getByText('1 selected')).toBeInTheDocument();
    expect(within(actionBar).getByLabelText('Move selected items')).toBeInTheDocument();
    expect(within(actionBar).getByRole('button', { name: 'Delete' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('button', { name: 'Select Radio' })).not.toBeInTheDocument();
  }, 10_000);

  it('bulk-sets check type and toggles required from the phone selection bar', async () => {
    renderBuilder();

    // Radio is seeded Required; selecting it alone means "all selected are
    // required", so the toggle must offer the inverse.
    fireEvent.click(await screen.findByRole('button', { name: 'Select items' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select Radio' }));

    const actionBar = screen.getByLabelText('Checklist action bar');
    expect(within(actionBar).getByRole('button', { name: 'Optional' })).toBeEnabled();
    // 44px minimum touch target — the select otherwise collapses to its
    // native text-line height, and the bar's min-h-11 does not reach it
    // because the controls are centre-aligned.
    expect(within(actionBar).getByLabelText('Set type for selected items')).toHaveClass('min-h-11');

    fireEvent.change(within(actionBar).getByLabelText('Set type for selected items'), {
      target: { value: 'count' },
    });
    expect(
      within(screen.getByRole('button', { name: 'Deselect Radio' })).getByText('Needs quantity')
    ).toBeInTheDocument();

    fireEvent.click(within(actionBar).getByRole('button', { name: 'Optional' }));
    expect(within(actionBar).getByRole('button', { name: 'Required' })).toBeInTheDocument();
  }, 10_000);

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

  it('opens a focused mobile add flow from the location header and keeps a safe-area action visible', async () => {
    const user = userEvent.setup();
    renderBuilder();

    await user.click(await screen.findByRole('button', { name: 'Add item to Cab' }));

    const input = screen.getByPlaceholderText('Add or search items…');
    expect(input).toHaveFocus();
    expect(screen.getByText(/Choose a result to link inventory/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add several' })).toBeVisible();
    expect(screen.getByTestId('mobile-add-action-cab')).toHaveClass('pb-[max(0.75rem,env(safe-area-inset-bottom))]');
  });

  it('adds plain text to an empty mobile location and retains focus for rapid entry', async () => {
    const user = userEvent.setup();
    getTemplate.mockResolvedValue({
      ...structuredClone(template),
      compartments: [{ ...structuredClone(template.compartments[0]), items: [] }],
    });
    addCheckItemsBulk.mockResolvedValue({
      items: [{ ...template.compartments[0]?.items[0], id: 'task-1', name: 'Clean windshield' }],
      createdCount: 1,
    });
    renderBuilder();

    await user.click(await screen.findByRole('button', { name: 'Add item to Cab' }));
    const input = screen.getByPlaceholderText('Add or search items…');
    await user.type(input, 'Clean windshield{Enter}');

    expect(addCheckItemsBulk).toHaveBeenCalledWith(
      'cab',
      [expect.objectContaining({ name: 'Clean windshield' })],
      expect.any(String)
    );
    await waitFor(() => expect(screen.getByText('Clean windshield')).toBeVisible());
    expect(input).toHaveFocus();
  });

  it('persists every selected item when a bulk action is applied, not just the last', async () => {
    // A shared autosave debounce made each scheduled item cancel the one before
    // it, so a bulk action reported success for the whole selection and sent a
    // single request. Both rows must reach the server.
    mockViewport('laptop');
    renderBuilder();

    fireEvent.click(await screen.findByRole('button', { name: 'Radio selection checkbox' }));
    fireEvent.click(screen.getByRole('button', { name: 'Flashlight selection checkbox' }));
    fireEvent.click(screen.getByRole('button', { name: /^Set (Required|Optional)$/ }));

    await waitFor(
      () => {
        const ids = updateCheckItem.mock.calls.map((call) => call[0]);
        expect(ids).toEqual(expect.arrayContaining(['radio', 'flashlight']));
      },
      { timeout: 6000 }
    );
  }, 15_000);

  it('reports a failed pre-save flush instead of dropping the edits silently', async () => {
    // Save overtakes the 1.5s autosave debounce by cancelling those timers and
    // sending the patches itself. That flush ran before handleSave's try/catch,
    // so a failure escaped as an unhandled rejection — no toast, no error
    // state, and the cancelled edits gone — while the indicator stayed on
    // "Saving…" for the rest of the session because the timer that would have
    // cleared it had been cancelled.
    mockViewport('laptop');
    updateCheckItem.mockRejectedValue({ response: { data: { detail: 'Item is locked' } } });
    const user = userEvent.setup();
    renderBuilder();

    fireEvent.click(await screen.findByRole('button', { name: 'Radio selection checkbox' }));
    fireEvent.click(screen.getByRole('button', { name: /^Set (Required|Optional)$/ }));
    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0]?.[0])).toContain('Item is locked');
    // The template write never ran: saving stopped at the failed flush rather
    // than committing a payload built from edits the server had rejected.
    expect(updateEquipmentCheckTemplate).not.toHaveBeenCalled();
  }, 15_000);

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

    // The name, the check type and the required flag are all edited in the row
    // itself; only the rarely-set fields sit behind the disclosure.
    expect(await screen.findByRole('button', { name: 'Show more settings for Radio' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Radio selection checkbox' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Drag Radio to reorder' })).not.toHaveLength(0);
    expect(screen.getAllByRole('button', { name: 'Works' })).not.toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Delete Radio' })).toBeInTheDocument();
    const actions = screen.getByLabelText('Actions for Radio');
    expect(within(actions.closest('details') as HTMLElement).getByRole('button', { name: 'Move down' })).toBeEnabled();
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

  it('does not allow an invalid template to be published', async () => {
    renderNewBuilder();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
    // Two blockers on a blank template: the details, and the empty checklist.
    expect(screen.getByRole('button', { name: '2 to fix' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled());
  });

  it('does not treat structural-only items as a publishable operational compartment', async () => {
    // The blocker rail only renders beside the canvas, so this asserts at the
    // width where the reason is actually shown.
    mockViewport('laptop');
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
    expect(screen.getByText('Cab is empty')).toBeVisible();
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

  it('exposes every item action from the row overflow without drag and drop', async () => {
    const user = userEvent.setup();
    renderBuilder();
    const trigger = await screen.findByLabelText('Actions for Radio');
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

describe('EquipmentCheckTemplateBuilder clearing a field on save', () => {
  // Update payloads are dumped with exclude_unset on the backend, so an
  // omitted key means "leave this alone". handleSave omitted every blank
  // field, so clearing one reported success and changed nothing — while the
  // auto-save path in the same component already sent explicit nulls.
  beforeEach(() => {
    vi.clearAllMocks();
    getTemplate.mockResolvedValue(structuredClone(template));
    updateCheckItem.mockResolvedValue({});
    updateCompartment.mockResolvedValue({});
    createEquipmentCheckTemplate.mockResolvedValue({ ...template, id: 'draft-1', isActive: false });
    updateEquipmentCheckTemplate.mockResolvedValue(template);
    reorderItems.mockResolvedValue(undefined);
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

  it('sends explicit nulls rather than omitting the fields it cleared', async () => {
    const user = userEvent.setup();
    renderBuilder();
    await screen.findByRole('button', { name: 'Edit Radio' });

    await user.click(screen.getByRole('button', { name: /Save draft/ }));

    // The values must be null, not undefined. `{ a: undefined }` still HAS
    // property 'a' in JS — it is JSON.stringify that drops the key — so an
    // existence check cannot tell the two apart and passes against the bug.
    await waitFor(() =>
      expect(updateEquipmentCheckTemplate).toHaveBeenLastCalledWith(
        'template-1',
        expect.objectContaining({
          apparatus_id: null,
          apparatus_type: null,
          description: null,
          // An empty array is meaningful here: "no position restriction".
          assigned_positions: [],
        })
      )
    );
  });

  it('sends compartment and item clears explicitly too', async () => {
    const user = userEvent.setup();
    renderBuilder();
    await screen.findByRole('button', { name: 'Edit Radio' });

    await user.click(screen.getByRole('button', { name: /Save draft/ }));

    await waitFor(() =>
      expect(updateCompartment).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({ parent_compartment_id: null, description: null })
      )
    );
    expect(updateCheckItem).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ serial_number: null, lot_number: null })
    );
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
    mockViewport('phone');
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
    // The re-expand-on-failure behaviour this asserts only exists at laptop
    // width: below 640px the row opens the mobile editor sheet instead of the
    // inline disclosure, so no "Hide more settings …" toggle is ever rendered.
    mockViewport('laptop');
    updateCheckItem.mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    renderBuilder();
    await user.selectOptions(await moveSelect('Oxygen mask'), '1');
    expect(await screen.findByLabelText('Actions for Oxygen mask')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Hide more settings for Oxygen mask' })).toBeInTheDocument();
    await waitFor(() => expect(document.getElementById('item-row-mask')).toHaveFocus());
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
    let resolveFirst!: (value: object) => void;
    updateCheckItem
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce({});
    renderBuilder();
    const radio = await moveSelect('Radio');
    const mask = await moveSelect('Oxygen mask');
    fireEvent.change(radio, { target: { value: '1' } });
    fireEvent.change(mask, { target: { value: '1' } });

    await waitFor(() => expect(updateCheckItem).toHaveBeenCalledTimes(1));
    expect(updateCheckItem).toHaveBeenNthCalledWith(1, 'radio', { compartment_id: 'bag', sort_order: 0 });
    resolveFirst({});
    await waitFor(() => expect(updateCheckItem).toHaveBeenCalledTimes(2));
    expect(updateCheckItem).toHaveBeenNthCalledWith(2, 'mask', { compartment_id: 'bag', sort_order: 1 });
    expect(await screen.findByLabelText('Actions for Radio')).toBeInTheDocument();
    expect(await screen.findByLabelText('Actions for Oxygen mask')).toBeInTheDocument();
    expect(toastSuccess).toHaveBeenCalledTimes(2);
  });
});

describe('EquipmentCheckTemplateBuilder quick add queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTemplate.mockResolvedValue(structuredClone(template));
    // The composer these tests drive is the laptop add path; below 640px the
    // catalog sheet is the add surface instead.
    mockViewport('laptop');
  });

  const composer = async (index = 0) => (await screen.findAllByPlaceholderText(/press Enter/i))[index] as HTMLElement;

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
    const input = await composer();

    await user.type(input, 'Lantern{Enter}');
    await user.type(input, 'Spare batteries{Enter}');

    expect(screen.getByLabelText('Lantern Saving')).toBeVisible();
    expect(screen.getByLabelText('Spare batteries Saving')).toBeVisible();
    expect(input).toHaveFocus();
    expect(addCheckItemsBulk).toHaveBeenCalledTimes(1);

    resolveFirst({ items: [savedItem('Lantern', 'lantern')], createdCount: 1 });
    await waitFor(() => expect(screen.queryByLabelText('Lantern Saving')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByLabelText('Spare batteries Saving')).not.toBeInTheDocument());
    expect(screen.getByDisplayValue('Lantern')).toBeVisible();
    expect(screen.getByDisplayValue('Spare batteries')).toBeVisible();
    expect(addCheckItemsBulk).toHaveBeenCalledTimes(2);
  });

  it("does not make one compartment wait for another compartment's slow response", async () => {
    const user = userEvent.setup();
    let resolveCab!: (value: unknown) => void;
    addCheckItemsBulk.mockImplementation((compartmentId: string) => {
      if (compartmentId === 'cab') return new Promise((resolve) => (resolveCab = resolve));
      return Promise.resolve({ items: [savedItem('Trauma shears', 'shears')], createdCount: 1 });
    });
    renderBuilder();
    const cabInput = await composer(0);
    const bagInput = await composer(1);

    await user.type(cabInput, 'Lantern{Enter}');
    await user.type(bagInput, 'Trauma shears{Enter}');

    expect(screen.getByLabelText('Lantern Saving')).toBeVisible();
    await waitFor(() => expect(screen.queryByLabelText('Trauma shears Saving')).not.toBeInTheDocument());
    expect(screen.getByDisplayValue('Trauma shears')).toBeVisible();
    expect(addCheckItemsBulk).toHaveBeenCalledTimes(2);

    resolveCab({ items: [savedItem('Lantern', 'lantern')], createdCount: 1 });
    await waitFor(() => expect(screen.queryByLabelText('Lantern Saving')).not.toBeInTheDocument());
  });

  it('retains a failed row, retries with the same idempotency key, and keeps successful siblings', async () => {
    const user = userEvent.setup();
    addCheckItemsBulk
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce({ items: [savedItem('Gloves', 'gloves')], createdCount: 1 })
      .mockResolvedValueOnce({ items: [savedItem('Safety vest', 'vest')], createdCount: 0, replayed: true });
    renderBuilder();
    const input = await composer();
    await user.type(input, 'Safety vest{Enter}');
    await user.type(input, 'Gloves{Enter}');

    const failed = await screen.findByLabelText('Safety vest Not saved');
    await waitFor(() => expect(screen.queryByLabelText('Gloves Saving')).not.toBeInTheDocument());
    expect(screen.getByDisplayValue('Gloves')).toBeVisible();
    const firstKey = String(addCheckItemsBulk.mock.calls[0]?.[2]);
    await user.click(within(failed).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByLabelText('Safety vest Saving')).not.toBeInTheDocument());
    expect(screen.getByDisplayValue('Safety vest')).toBeVisible();
    expect(addCheckItemsBulk.mock.calls[2]?.[2]).toBe(firstKey);
  }, 10_000);

  it('does not submit the same value again when Enter repeats', async () => {
    const user = userEvent.setup();
    addCheckItemsBulk.mockResolvedValue({ items: [savedItem('Lantern', 'lantern')], createdCount: 1 });
    renderBuilder();
    const input = await composer();
    await user.type(input, 'Lantern{Enter}{Enter}');
    expect(addCheckItemsBulk).toHaveBeenCalledTimes(1);
    expect(addCheckItemsBulk).toHaveBeenCalledWith(
      'cab',
      [
        {
          name: 'Lantern',
          sort_order: 2,
        },
      ],
      expect.any(String)
    );
  });
});

describe('EquipmentCheckTemplateBuilder bulk deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTemplate.mockResolvedValue(structuredClone(template));
    // Row checkboxes and the bulk bar are the laptop selection surface; the
    // phone reaches the same actions through "Select items".
    mockViewport('laptop');
  });

  async function selectAndDelete() {
    const user = userEvent.setup();
    renderBuilder();
    await screen.findByDisplayValue('Radio');
    await user.click(screen.getByTitle('Select all items'));
    await user.click(screen.getByRole('button', { name: 'Delete selected items' }));
    await user.click(screen.getByRole('button', { name: 'Delete 2' }));
  }

  it('removes only IDs confirmed by a completely successful response', async () => {
    deleteCheckItemsBulk.mockResolvedValue({ deletedItemIds: ['radio', 'flashlight'], replayed: false });
    await selectAndDelete();
    await waitFor(() => expect(screen.queryByDisplayValue('Radio')).not.toBeInTheDocument());
    expect(screen.getAllByText('Add at least one item to publish').length).toBeGreaterThan(0);
    expect(deleteCheckItemsBulk).toHaveBeenCalledWith('cab', ['radio', 'flashlight'], expect.any(String));
    expect(toastSuccess).toHaveBeenCalledWith('Deleted 2 items');
    expect(toastError).not.toHaveBeenCalled();
  });

  it('retains visible selected rows and never shows success after failure', async () => {
    deleteCheckItemsBulk.mockRejectedValue(new Error('Database unavailable'));
    await selectAndDelete();
    expect(await screen.findByDisplayValue('Radio')).toBeVisible();
    expect(screen.getByDisplayValue('Flashlight')).toBeVisible();
    expect(screen.getByText('2 selected')).toBeVisible();
    expect(toastError).toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('removes only confirmed IDs and retains an unconfirmed row selected', async () => {
    deleteCheckItemsBulk.mockResolvedValue({ deletedItemIds: ['radio'], replayed: false });
    await selectAndDelete();
    await waitFor(() => expect(screen.queryByDisplayValue('Radio')).not.toBeInTheDocument());
    expect(screen.getByDisplayValue('Flashlight')).toBeVisible();
    expect(screen.getByText('1 selected')).toBeVisible();
    expect(toastError).toHaveBeenCalledWith('1 item was deleted; 1 could not be deleted');
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('reuses the idempotency key when the same selected deletion is retried', async () => {
    deleteCheckItemsBulk
      .mockRejectedValueOnce(new Error('Response lost'))
      .mockResolvedValueOnce({ deletedItemIds: ['radio', 'flashlight'], replayed: true });
    const user = userEvent.setup();
    renderBuilder();
    await screen.findByDisplayValue('Radio');
    await user.click(screen.getByTitle('Select all items'));

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await user.click(screen.getByRole('button', { name: 'Delete selected items' }));
      await user.click(screen.getByRole('button', { name: 'Delete 2' }));
      await waitFor(() => expect(deleteCheckItemsBulk).toHaveBeenCalledTimes(attempt + 1));
    }

    expect(deleteCheckItemsBulk.mock.calls[0]?.[2]).toBe(deleteCheckItemsBulk.mock.calls[1]?.[2]);
    await waitFor(() => expect(screen.queryByDisplayValue('Radio')).not.toBeInTheDocument());
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
    mockViewport('laptop');
    renderBuilder();
    const paste = (await screen.findAllByPlaceholderText(/press Enter/i))[0] as HTMLElement;
    // Two lines is what turns the composer into a paste: there is no mode to
    // pick, so a shift-Enter newline is the whole gesture.
    await user.type(paste, 'Mask{Shift>}{Enter}{/Shift}Hood');
    expect(screen.getByText('2 items ready to add')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Add all' }));
    await waitFor(() => expect(addCheckItemsBulk).toHaveBeenCalledTimes(1));
    expect(addCheckItemsBulk).toHaveBeenNthCalledWith(
      1,
      'cab',
      [{ name: 'Mask' }, { name: 'Hood' }],
      expect.any(String)
    );
    expect(paste).toHaveValue('Mask\nHood');
    await user.click(screen.getByRole('button', { name: 'Add all' }));
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

describe('EquipmentCheckTemplateBuilder unsaved-change prompts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTemplate.mockResolvedValue(structuredClone(template));
    updateEquipmentCheckTemplate.mockResolvedValue(structuredClone(template));
  });

  it('does not prompt when leaving an unchanged loaded template', async () => {
    renderBuilder();
    await screen.findByDisplayValue('Engine check');
    await userEvent.click(screen.getByTitle('Back to templates'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('prompts for a real edit, then stops prompting after that edit is saved', async () => {
    const user = userEvent.setup();
    renderBuilder();
    const name = await screen.findByDisplayValue('Engine check');
    await user.clear(name);
    await user.type(name, 'Engine daily check');

    await user.click(screen.getByTitle('Back to templates'));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Leave without saving?');
    await user.click(screen.getByRole('button', { name: 'Stay here' }));

    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() =>
      expect(updateEquipmentCheckTemplate).toHaveBeenCalledWith(
        'template-1',
        expect.objectContaining({ name: 'Engine daily check', is_active: false })
      )
    );
    await user.click(screen.getByTitle('Back to templates'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('EquipmentCheckTemplateBuilder creation guidance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockViewport('laptop');
  });

  it('preserves preset test instructions and reports the loaded locations', async () => {
    renderNewBuilder();
    // Settle the mount-time apparatus-options fetch, as above.
    await screen.findByRole('button', { name: 'Details' });

    // Template type lives in the details drawer now.
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    fireEvent.change(screen.getByLabelText('Template Type'), { target: { value: 'vehicle' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close template details' }));
    fireEvent.click(screen.getByRole('button', { name: /use a vehicle layout/i }));
    fireEvent.click(screen.getByRole('button', { name: /engine \/ pumper/i }));

    // The crew view is docked in the rail rather than behind a modal.
    fireEvent.click(screen.getByRole('button', { name: 'Crew view' }));
    expect(screen.getAllByText('Switch it on and confirm it works.').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Before publishing' }));
    expect(screen.getByText(/locations, \d+ with items/)).toBeVisible();
  }, 20_000);

  it('swaps the start card for the vehicle layout list rather than stacking both', async () => {
    renderNewBuilder();
    // Mount starts an apparatus-options fetch that setStates when it resolves.
    // The rest of this test is synchronous, so settle that update first rather
    // than racing it — otherwise the assertions run against a render React has
    // already scheduled to replace.
    await screen.findByRole('button', { name: 'Details' });

    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    fireEvent.change(screen.getByLabelText('Template Type'), { target: { value: 'vehicle' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close template details' }));

    expect(screen.getByText('How would you like to start?')).toBeVisible();
    expect(screen.getByRole('button', { name: /build from scratch/i })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: /use a vehicle layout/i }));

    // Both surfaces are the same card now, so the row the user just tapped
    // must not still be sitting under the list it opened.
    expect(screen.getByText('Start from a vehicle layout')).toBeVisible();
    expect(screen.queryByText('How would you like to start?')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close vehicle layouts' }));
    expect(screen.getByText('How would you like to start?')).toBeVisible();
  });

  it('carries focus across the preset swap in both directions', async () => {
    renderNewBuilder();
    await screen.findByRole('button', { name: 'Details' });

    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    fireEvent.change(screen.getByLabelText('Template Type'), { target: { value: 'vehicle' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close template details' }));

    const opener = screen.getByRole('button', { name: /use a vehicle layout/i });
    opener.focus();
    fireEvent.click(opener);

    // The picker replaces the start card, so the activated button is gone. With
    // nothing moving focus it lands on the body and the next Tab restarts from
    // the top of the document, with no sign the content arrived.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close vehicle layouts' })).toHaveFocus());

    fireEvent.click(screen.getByRole('button', { name: 'Close vehicle layouts' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /use a vehicle layout/i })).toHaveFocus());
  });

  it('uses the opaque themed page canvas for the checklist preview', async () => {
    mockViewport('phone');
    // renderBuilder always mounts at /templates/template-1, so the preview has
    // nothing to draw until getTemplate resolves. This describe has no
    // beforeEach, so without a local mock the test only passes on the value a
    // preceding block happened to leave behind — and fails under any focused
    // run. The sibling test above does not need one: it drives the preset
    // creation flow and never reads the loaded template.
    getTemplate.mockResolvedValue(structuredClone(template));
    renderBuilder();

    fireEvent.click(await screen.findByRole('button', { name: /preview/i }));

    const preview = screen.getByLabelText('Mobile checklist preview');
    expect(preview).toHaveClass('bg-theme-bg', 'text-theme-text-primary');
    expect(within(preview).getAllByText('Engine check').length).toBeGreaterThan(0);
    expect(preview.querySelectorAll('.bg-theme-bg').length).toBeGreaterThanOrEqual(3);
  });
});

describe('EquipmentCheckTemplateBuilder single-canvas editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // `clearAllMocks` clears calls but keeps implementations, and an unconsumed
    // `…Once` queued by an earlier block is handed out before any default set
    // here — so the mocks this block relies on are reset, not just cleared.
    getTemplate.mockReset();
    addCheckItemsBulk.mockReset();
    updateCheckItem.mockReset();
    updateCompartment.mockReset();
    updateEquipmentCheckTemplate.mockReset();
    getTemplate.mockResolvedValue(structuredClone(template));
    updateCheckItem.mockResolvedValue({});
    updateCompartment.mockResolvedValue({});
    updateEquipmentCheckTemplate.mockResolvedValue(structuredClone(template));
    // The canvas, the rail and the composer are all laptop-and-wider surfaces.
    mockViewport('laptop');
  });

  it('edits the name, the check type and the required flag from the row itself', async () => {
    const user = userEvent.setup();
    renderBuilder();

    const row = (await screen.findByDisplayValue('Radio')).closest('[id="item-row-radio"]') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Count' }));
    // Switching type swaps the settings slot in place rather than opening one.
    expect(within(row).getByLabelText('Par quantity for Radio')).toBeVisible();

    await user.click(within(row).getByRole('button', { name: 'Required' }));
    expect(within(row).getByRole('button', { name: 'Optional' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps the par and minimum fields labelled once they hold values', async () => {
    const user = userEvent.setup();
    renderBuilder();

    const row = (await screen.findByDisplayValue('Radio')).closest('[id="item-row-radio"]') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Count' }));

    const par = within(row).getByLabelText('Par quantity for Radio');
    const minimum = within(row).getByLabelText('Minimum quantity for Radio');
    await user.type(par, '4');
    await user.type(minimum, '2');

    // A placeholder would be gone by now, leaving two adjacent bare numbers
    // with nothing to say which threshold is which. The name sits inside the
    // field's box so it survives the value.
    expect(par).toHaveValue(4);
    expect(minimum).toHaveValue(2);
    expect(par.parentElement).toHaveTextContent('par');
    expect(minimum.parentElement).toHaveTextContent('min');
  });

  it('names each publish blocker and jumps to the row that causes it', async () => {
    const user = userEvent.setup();
    renderBuilder();

    // Medical bag ships with no items, which is exactly the gate on Publish.
    const blocker = await screen.findByRole('button', { name: /Medical bag is empty/ });
    expect(within(blocker).getByText('Add an item or delete the location')).toBeVisible();
    expect(screen.getByRole('button', { name: '1 to fix' })).toBeInTheDocument();

    // The jump lands on what the author has to change. For an empty location
    // that is the add surface, not the name field, which is already correct.
    await user.click(blocker);
    await waitFor(() => expect(screen.getByLabelText('Add items to Medical bag')).toHaveFocus());
  });

  it('opens the details drawer from a chip and closes it on Escape', async () => {
    const user = userEvent.setup();
    renderBuilder();

    await user.click(await screen.findByRole('button', { name: /Start of shift/ }));
    const drawer = screen.getByRole('dialog', { name: 'Template details' });
    expect(within(drawer).getByLabelText('Template Type')).toHaveValue('equipment');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Template details' })).not.toBeInTheDocument();
  });

  it('nests a location under the one above it and moves it back out', async () => {
    const user = userEvent.setup();
    getTemplate.mockResolvedValue({
      ...structuredClone(template),
      compartments: structuredClone(template).compartments.map((compartment) =>
        compartment.id === 'bag' ? { ...compartment, parentCompartmentId: undefined } : compartment
      ),
    });
    renderBuilder();

    const outdent = await screen.findByRole('button', { name: 'Move Medical bag out one level' });
    expect(outdent).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Nest Medical bag inside the location above' }));
    expect(await screen.findByText('inside Cab')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Move Medical bag out one level' }));
    await waitFor(() => expect(screen.queryByText('inside Cab')).not.toBeInTheDocument());
  });

  it('sets the check type for every pasted line in one request', async () => {
    const user = userEvent.setup();
    addCheckItemsBulk.mockResolvedValue({
      items: [
        { ...template.compartments[0]?.items[0], id: 'gauze', name: 'Gauze' },
        { ...template.compartments[0]?.items[0], id: 'tape', name: 'Tape' },
      ],
      createdCount: 2,
    });
    renderBuilder();

    const composer = (await screen.findAllByPlaceholderText(/press Enter/i))[0] as HTMLElement;
    await user.type(composer, 'Gauze{Shift>}{Enter}{/Shift}Tape');
    await user.selectOptions(screen.getByLabelText('Check type for pasted items'), 'Count');
    await user.click(screen.getByRole('button', { name: 'Add all' }));

    await waitFor(() => expect(addCheckItemsBulk).toHaveBeenCalledTimes(1));
    expect(addCheckItemsBulk).toHaveBeenCalledWith(
      'cab',
      [
        { name: 'Gauze', check_type: 'count' },
        { name: 'Tape', check_type: 'count' },
      ],
      expect.any(String)
    );
    expect(composer).toHaveValue('');
  });
});

describe('EquipmentCheckTemplateBuilder canvas affordances reach both widths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTemplate.mockReset();
    updateCheckItem.mockReset();
    updateCompartment.mockReset();
    getTemplate.mockResolvedValue(structuredClone(template));
    updateCheckItem.mockResolvedValue({});
    updateCompartment.mockResolvedValue({});
  });

  it('focuses the setting a blocker names, not the row it sits in', async () => {
    const user = userEvent.setup();
    mockViewport('laptop');
    getTemplate.mockResolvedValue({
      ...structuredClone(template),
      compartments: [
        {
          ...structuredClone(template.compartments[0]),
          items: [
            {
              ...template.compartments[0]?.items[0],
              id: 'foam',
              name: 'Foam tank level',
              checkType: 'level',
            },
          ],
        },
      ],
    });
    renderBuilder();

    // The item name is the first control in the row and is already correct;
    // landing there would say nothing about what to fix.
    await user.click(await screen.findByRole('button', { name: /Foam tank level needs a minimum/ }));
    expect(screen.getByLabelText('Minimum level for Foam tank level')).toHaveFocus();
  });

  it('takes a phone straight to the first blocker, where there is no rail', async () => {
    const user = userEvent.setup();
    mockViewport('phone');
    getTemplate.mockResolvedValue({
      ...structuredClone(template),
      compartments: [{ ...structuredClone(template.compartments[0]), name: '' }],
    });
    renderBuilder();

    // An unnamed location does have a field that is wrong, so the jump focuses
    // it rather than opening the add sheet.
    await user.click(await screen.findByRole('button', { name: '1 to fix' }));
    expect(screen.getByLabelText('Location name')).toHaveFocus();
  });

  it('opens the add surface when a blocker says a location is empty', async () => {
    const user = userEvent.setup();
    mockViewport('laptop');
    renderBuilder();

    // The only field on an empty location's row is its name, which is already
    // correct; what is missing is an item.
    await user.click(await screen.findByRole('button', { name: /Medical bag is empty/ }));
    await waitFor(() => expect(screen.getByLabelText('Add items to Medical bag')).toHaveFocus());
  });

  it('opens the phone add sheet when that same blocker is tapped', async () => {
    const user = userEvent.setup();
    mockViewport('phone');
    renderBuilder();

    await user.click(await screen.findByRole('button', { name: '1 to fix' }));
    expect(await screen.findByPlaceholderText('Add or search items…')).toBeInTheDocument();
  });

  it('opens the item editor when a phone blocker names a setting the row does not hold', async () => {
    const user = userEvent.setup();
    mockViewport('phone');
    getTemplate.mockResolvedValue({
      ...structuredClone(template),
      compartments: [
        {
          ...structuredClone(template.compartments[0]),
          items: [{ ...template.compartments[0]?.items[0], id: 'foam', name: 'Foam tank level', checkType: 'level' }],
        },
      ],
    });
    renderBuilder();

    // The compact phone row holds no input at all, so scrolling to it would
    // leave the author looking at the problem with no way to fix it.
    await user.click(await screen.findByRole('button', { name: '1 to fix' }));
    expect(await screen.findByRole('dialog', { name: 'Foam tank level' })).toBeVisible();
  });

  it('opens the phone add sheet from an empty location instead of a missing composer', async () => {
    const user = userEvent.setup();
    mockViewport('phone');
    renderBuilder();

    // Medical bag loads expanded and empty, so expanding it again is a no-op —
    // the button has to reach the sheet that phones actually add through.
    await user.click(await screen.findByRole('button', { name: 'Add items' }));
    expect(screen.getByPlaceholderText('Add or search items…')).toBeInTheDocument();
  });

  it('keeps a location description and image editable from the row overflow', async () => {
    const user = userEvent.setup();
    mockViewport('laptop');
    renderBuilder();

    const trigger = await screen.findByLabelText('Actions for Cab');
    await user.click(trigger);
    const menu = trigger.closest('details') as HTMLElement;
    await user.type(within(menu).getByLabelText('Description for Cab'), 'Front of the rig');
    expect(within(menu).getByLabelText('Description for Cab')).toHaveValue('Front of the rig');
    expect(within(menu).getByLabelText('Image URL for Cab')).toBeInTheDocument();
  });

  it('keeps section actions at a phone-sized target', async () => {
    mockViewport('phone');
    renderBuilder();

    expect(await screen.findByRole('button', { name: 'Delete section header' })).toHaveClass('mobile-touch-target');
    expect(screen.getByRole('button', { name: 'Move section up' })).toHaveClass('mobile-touch-target');
  });
});

describe('EquipmentCheckTemplateBuilder narrow widths and assistive tech', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTemplate.mockReset();
    updateCheckItem.mockReset();
    updateCompartment.mockReset();
    getTemplate.mockResolvedValue(structuredClone(template));
    updateCheckItem.mockResolvedValue({});
    updateCompartment.mockResolvedValue({});
  });

  it('names the toolbar controls where their labels are hidden', async () => {
    mockViewport('phone');
    renderBuilder();

    // Below 640px the label span leaves the accessibility tree and the icon is
    // aria-hidden, so without these the three read as unnamed buttons.
    expect(await screen.findByRole('button', { name: 'Details' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeInTheDocument();
    expect(screen.getByLabelText('Tools')).toBeInTheDocument();
  });

  it('locks the page and takes focus while the details drawer is open', async () => {
    const user = userEvent.setup();
    mockViewport('laptop');
    renderBuilder();

    await user.click(await screen.findByRole('button', { name: 'Details' }));
    const drawer = screen.getByRole('dialog', { name: 'Template details' });
    expect(drawer.contains(document.activeElement)).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');

    await user.click(within(drawer).getByRole('button', { name: 'Close template details' }));
    await waitFor(() => expect(document.body.style.overflow).not.toBe('hidden'));
  });
});

describe('EquipmentCheckTemplateBuilder tablet keeps the preview reachable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTemplate.mockReset();
    getTemplate.mockResolvedValue(structuredClone(template));
  });

  it('gives the blockers and the crew view a bottom bar where the rail does not fit', async () => {
    const user = userEvent.setup();
    // 900px clears the 640px row layout but not the width the rail needs beside
    // the canvas. Rendering the rail here would starve the checklist; leaving
    // it out entirely would put the blockers out of reach.
    mockViewport('tablet');
    renderBuilder();

    const bar = await screen.findByLabelText('Checklist action bar');
    expect(within(bar).getByText(/thing.* to fix before publishing/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Before publishing' })).not.toBeInTheDocument();

    await user.click(within(bar).getByRole('button', { name: 'Review' }));
    const sheet = screen.getByRole('dialog', { name: 'Before publishing' });
    expect(within(sheet).getByRole('button', { name: /Medical bag is empty/ })).toBeVisible();
  });

  it('closes the sheet when a blocker takes you to the row', async () => {
    const user = userEvent.setup();
    mockViewport('tablet');
    renderBuilder();

    const bar = await screen.findByLabelText('Checklist action bar');
    await user.click(within(bar).getByRole('button', { name: 'Review' }));
    const sheet = screen.getByRole('dialog', { name: 'Before publishing' });
    await user.click(within(sheet).getByRole('button', { name: /Medical bag is empty/ }));

    // The sheet covers the row it just sent the author to.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Before publishing' })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByLabelText('Add items to Medical bag')).toHaveFocus());
  });

  it('leaves the cursor in the field a sheet blocker names, not back in the bar', async () => {
    const user = userEvent.setup();
    mockViewport('tablet');
    renderBuilder();

    // A count item with no par is a blocker that names a field, in a location
    // that is already open — the one path where nothing else defers the focus.
    const radioRow = (await screen.findByDisplayValue('Radio')).closest('[id="item-row-radio"]') as HTMLElement;
    await user.click(within(radioRow).getByRole('button', { name: 'Count' }));

    const bar = screen.getByLabelText('Checklist action bar');
    const review = within(bar).getByRole('button', { name: 'Review' });
    await user.click(review);
    const sheet = screen.getByRole('dialog', { name: 'Before publishing' });
    await user.click(within(sheet).getByRole('button', { name: /Radio needs a quantity/ }));

    // Closing the sheet unmounts DialogPanel, whose focus trap restores focus
    // to whatever opened it. A focus set synchronously in the handler is undone
    // by that restore, landing the cursor back on Review.
    await waitFor(() => expect(screen.getByLabelText('Par quantity for Radio')).toHaveFocus());
    expect(review).not.toHaveFocus();
  });

  it('shows the rail instead of the modal once it fits beside the canvas', async () => {
    mockViewport('laptop');
    renderBuilder();

    expect(await screen.findByRole('button', { name: 'Before publishing' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /preview/i })).not.toBeInTheDocument();
  });
});

describe('EquipmentCheckTemplateBuilder replacing a saved template’s contents', () => {
  // All three bulk-replacement paths — vehicle preset, JSON import, CSV
  // import — promise "discards every compartment and item currently on this
  // template", and all three delivered that to local state only. handleSave
  // creates the new compartments and updates the ones still listed; nothing
  // deleted the rows no longer mentioned, so a saved template ended up
  // holding both sets and the next crew got a doubled checklist.
  const vehicleTemplate = { ...template, templateType: 'vehicle' };

  beforeEach(() => {
    vi.clearAllMocks();
    getTemplate.mockResolvedValue(structuredClone(vehicleTemplate));
    deleteCompartmentsBulk.mockResolvedValue(['cab', 'bag', 'section']);
    updateEquipmentCheckTemplate.mockResolvedValue(vehicleTemplate);
    mockViewport('phone');
  });

  const loadEnginePreset = async (user: ReturnType<typeof userEvent.setup>) => {
    await screen.findByRole('button', { name: 'Edit Radio' });
    await user.click(screen.getByRole('button', { name: /Vehicle preset/ }));
    await user.click(await screen.findByRole('button', { name: /Engine \/ Pumper/ }));
    await user.click(await screen.findByRole('button', { name: 'Load preset' }));
  };

  it('deletes the compartments it says it discards', async () => {
    const user = userEvent.setup();
    renderBuilder();

    await loadEnginePreset(user);

    // One request, not one per compartment: a loop commits each delete
    // separately and a failure on the third leaves the first two gone.
    await waitFor(() => expect(deleteCompartmentsBulk).toHaveBeenCalledWith('template-1', ['cab', 'bag', 'section']));
  });

  it('marks the template unsaved so the preset is not lost on navigation', async () => {
    // The JSON and CSV import branches marked it; the vehicle preset did not.
    // On a published template that is masked, because
    // ensureDraftBeforeStructureEdit demotes it to a draft and marks dirty on
    // the way — so this starts from a template that is ALREADY a draft, where
    // that helper returns early and nothing else marks anything. The old
    // compartments are deleted by this point, so navigating away after the
    // success toast left the server-side template empty and discarded the
    // preset on screen, with the guard never firing.
    getTemplate.mockResolvedValue({ ...structuredClone(vehicleTemplate), isActive: false });
    const user = userEvent.setup();
    renderBuilder();

    await loadEnginePreset(user);
    await screen.findByRole('button', { name: /Vehicle preset/ });

    await user.click(screen.getByRole('button', { name: 'Back to templates' }));

    expect(await screen.findByText('Leave without saving?')).toBeInTheDocument();
  });

  it('keeps the template intact when the discard fails', async () => {
    // Deleted before the swap, so a failure leaves the template as it was
    // rather than half-replaced with no way back.
    deleteCompartmentsBulk.mockRejectedValue({ response: { data: { detail: 'Compartment is in use' } } });
    const user = userEvent.setup();
    renderBuilder();

    await loadEnginePreset(user);

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0]?.[0])).toContain('Compartment is in use');
    expect(await screen.findByRole('button', { name: 'Edit Radio' })).toBeInTheDocument();
  });
});

describe('EquipmentCheckTemplateBuilder crew preview identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTemplate.mockReset();
    mockViewport('laptop');
  });

  it("does not hand a deleted item's preview answer to the one that replaces it", async () => {
    const user = userEvent.setup();
    renderNewBuilder();

    await user.click(screen.getByRole('button', { name: 'Location' }));
    const composer = (await screen.findAllByPlaceholderText(/press Enter/i))[0] as HTMLElement;
    await user.type(composer, 'First item{Enter}');
    await user.type(composer, 'Second item{Enter}');

    await user.click(screen.getByRole('button', { name: 'Crew view' }));
    const preview = () => within(screen.getByLabelText('Crew preview'));
    await user.click(preview().getByRole('button', { name: 'First item works' }));
    expect(preview().getByRole('button', { name: 'First item works' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Delete First item' }));
    await confirm('Delete');

    // An unsaved item's array index is not its identity. Keyed on the index,
    // the surviving item inherits both the deleted one's preview id and the
    // answer recorded against it.
    await waitFor(() => expect(screen.queryByDisplayValue('First item')).not.toBeInTheDocument());
    expect(preview().queryByRole('button', { name: 'First item works' })).not.toBeInTheDocument();
    expect(preview().getByRole('button', { name: 'Second item works' })).toHaveAttribute('aria-pressed', 'false');
  }, 15_000);

  it('anchors the crew preview so the sweep fills the phone rather than the page', async () => {
    // The sweep renders `absolute inset-0` under previewMode. With no
    // positioned ancestor it resolves against the sticky rail — a 268px device
    // mock whose contents cover the builder around it. jsdom cannot lay that
    // out, so the containing block is asserted directly.
    const user = userEvent.setup();
    renderNewBuilder();
    await user.click(screen.getByRole('button', { name: 'Crew view' }));
    expect(screen.getByLabelText('Crew preview')).toHaveClass('relative');
  });

  it('expands a location added to an unsaved template, so its composer is reachable', async () => {
    const user = userEvent.setup();
    renderNewBuilder();

    // The expansion set was keyed by the array index while addCompartment
    // recorded the clientKey, so the two never matched and a brand-new
    // location opened collapsed with nowhere to type.
    await user.click(screen.getByRole('button', { name: 'Location' }));
    expect((await screen.findAllByPlaceholderText(/press Enter/i)).length).toBeGreaterThan(0);
  });

  it('keeps the phone location disclosure at a tappable size', async () => {
    mockViewport('phone');
    getTemplate.mockResolvedValue(structuredClone(template));
    renderBuilder();

    expect(await screen.findByRole('button', { name: 'Collapse Cab' })).toHaveClass('mobile-touch-target');
  });
});

describe('EquipmentCheckTemplateBuilder duplication identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTemplate.mockReset();
    cloneCompartment.mockReset();
    mockViewport('laptop');
  });

  it('keeps preview answers while items are added, and drops them when a type changes', async () => {
    const user = userEvent.setup();
    renderNewBuilder();

    await user.click(screen.getByRole('button', { name: 'Location' }));
    const composer = (await screen.findAllByPlaceholderText(/press Enter/i))[0] as HTMLElement;
    await user.type(composer, 'First item{Enter}');

    await user.click(screen.getByRole('button', { name: 'Crew view' }));
    const preview = () => within(screen.getByLabelText('Crew preview'));
    await user.click(preview().getByRole('button', { name: 'First item works' }));
    expect(preview().getByRole('button', { name: 'First item works' })).toHaveAttribute('aria-pressed', 'true');

    // Adding an item cannot mis-assign an existing answer, so it must not
    // discard one the author was in the middle of looking at.
    await user.type(composer, 'Second item{Enter}');
    await waitFor(() => expect(screen.getAllByDisplayValue(/item$/)).toHaveLength(2));
    expect(preview().getByRole('button', { name: 'First item works' })).toHaveAttribute('aria-pressed', 'true');

    // Changing the type leaves a pass/fail recorded against a counter, so the
    // answer goes with it — the verdict pair is replaced by a tally row.
    const firstRow = screen.getByDisplayValue('First item').closest('[id^="item-row-"]') as HTMLElement;
    await user.click(within(firstRow).getByRole('button', { name: 'Count' }));
    await waitFor(() => expect(preview().queryByRole('button', { name: 'First item works' })).not.toBeInTheDocument());
    expect(preview().getByRole('button', { name: 'Second item works' })).toHaveAttribute('aria-pressed', 'false');
  }, 20_000);

  it('gives a duplicated location its own item identities', async () => {
    const user = userEvent.setup();
    renderNewBuilder();

    await user.click(screen.getByRole('button', { name: 'Location' }));
    const composer = (await screen.findAllByPlaceholderText(/press Enter/i))[0] as HTMLElement;
    await user.type(composer, 'Shared item{Enter}');

    const trigger = await screen.findByLabelText('Actions for compartment');
    await user.click(trigger);
    await user.click(within(trigger.closest('details') as HTMLElement).getByRole('button', { name: 'Duplicate' }));

    // clientKey is the identity for the highlight set, the inline-edit target,
    // the phone editor and the preview's item ids. Copying it hands the
    // duplicate's items the originals'.
    await waitFor(() => expect(screen.getAllByDisplayValue('Shared item')).toHaveLength(2));
    const rowIds = screen
      .getAllByDisplayValue('Shared item')
      .map((input) => input.closest('[id^="item-row-"]')?.id ?? '');
    expect(new Set(rowIds).size).toBe(2);
  }, 15_000);
});

describe('EquipmentCheckTemplateBuilder flushing debounced edits on save', () => {
  // The flush of the 1.5s auto-save window used to run before setSaving and
  // outside the try/catch, so a failure escaped as an unhandled rejection:
  // no error toast, and the pending edits had already been consumed on the
  // way out with nothing left to retry.
  beforeEach(() => {
    vi.clearAllMocks();
    getTemplate.mockReset();
    getTemplate.mockResolvedValue(structuredClone(template));
    updateCheckItem.mockReset();
    updateCheckItem.mockResolvedValue({});
    updateCompartment.mockReset();
    updateCompartment.mockResolvedValue({});
    createEquipmentCheckTemplate.mockResolvedValue({ ...template, id: 'draft-1', isActive: false });
    updateEquipmentCheckTemplate.mockReset();
    updateEquipmentCheckTemplate.mockResolvedValue(template);
    reorderItems.mockResolvedValue(undefined);
  });

  /** Queue a debounced item edit, then press Save inside the debounce window. */
  const editThenSaveImmediately = async () => {
    mockViewport('laptop');
    renderBuilder();
    fireEvent.click(await screen.findByRole('button', { name: 'Radio selection checkbox' }));
    fireEvent.click(screen.getByRole('button', { name: /^Set (Required|Optional)$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Save draft/ }));
  };

  it('sends the pending edit rather than letting Save race it', async () => {
    await editThenSaveImmediately();

    await waitFor(() =>
      expect(updateCheckItem).toHaveBeenCalledWith('radio', { is_required: false })
    );
  });

  it('reports a failed flush through the save error toast', async () => {
    updateCheckItem.mockRejectedValue(new Error('Network Error'));

    await editThenSaveImmediately();

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    // The bulk action raises a success toast of its own; the save must not.
    expect(toastSuccess).not.toHaveBeenCalledWith('Draft saved');
  });

  it('leaves the save button usable again after a failed flush', async () => {
    updateCheckItem.mockRejectedValue(new Error('Network Error'));

    await editThenSaveImmediately();

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: /Save draft/ })).toBeEnabled());
  });

  it('does not save the template when the flush failed', async () => {
    // The flush is the first thing inside the try, so a failure there must
    // abort the save rather than persisting a template built from state the
    // server never received.
    updateCheckItem.mockRejectedValue(new Error('Network Error'));

    await editThenSaveImmediately();

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(updateEquipmentCheckTemplate).not.toHaveBeenCalled();
  });
});
