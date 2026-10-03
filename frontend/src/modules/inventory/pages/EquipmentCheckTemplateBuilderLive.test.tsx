/**
 * Two things the builder must say before an officer walks away.
 *
 * 1. Editing a published checklist takes it back to draft, and so off every
 *    crew's shift, until it is published again. Autosave then cleared the
 *    unsaved-changes flag, so the only sign was a small "Draft" badge: an
 *    officer who renamed one item and left gave the next day's crew no
 *    checklist.
 * 2. A checklist tied to no vehicle reaches only shifts whose shift template
 *    names it. "Ready to publish" alone let one be published to no shift.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../../../contexts/ConfirmContext';

const {
  getTemplate,
  addCheckItem,
  reorderItems,
  updateCheckItem,
  updateCompartment,
  updateEquipmentCheckTemplate,
  getApparatusOptions,
} = vi.hoisted(() => ({
  getTemplate: vi.fn(),
  addCheckItem: vi.fn(),
  reorderItems: vi.fn(),
  updateCheckItem: vi.fn(),
  updateCompartment: vi.fn(),
  updateEquipmentCheckTemplate: vi.fn(),
  getApparatusOptions: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/modules/scheduling', () => ({
  schedulingService: {
    getApparatusOptions: (...args: unknown[]) => getApparatusOptions(...args) as unknown,
  },
}));

vi.mock('@/modules/inventory/services/equipmentCheckApi', () => ({
  equipmentCheckService: {
    getEquipmentCheckTemplate: (...args: unknown[]) => getTemplate(...args) as unknown,
    addCheckItem: (...args: unknown[]) => addCheckItem(...args) as unknown,
    reorderItems: (...args: unknown[]) => reorderItems(...args) as unknown,
    updateCheckItem: (...args: unknown[]) => updateCheckItem(...args) as unknown,
    updateCompartment: (...args: unknown[]) => updateCompartment(...args) as unknown,
    updateEquipmentCheckTemplate: (...args: unknown[]) => updateEquipmentCheckTemplate(...args) as unknown,
    getCsvSampleUrl: vi.fn().mockReturnValue('/sample.csv'),
    addCheckItemsBulk: vi.fn(),
    deleteCheckItemsBulk: vi.fn(),
    deleteCheckItem: vi.fn(),
    replaceCompartments: vi.fn(),
    addCompartment: vi.fn(),
    deleteCompartment: vi.fn(),
    cloneCompartment: vi.fn(),
    createEquipmentCheckTemplate: vi.fn(),
  },
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector?: (state: { checkPermission: () => boolean }) => unknown) => {
    const state = { checkPermission: () => false };
    return selector ? selector(state) : state;
  },
}));

import EquipmentCheckTemplateBuilder from './EquipmentCheckTemplateBuilder';

const radio = {
  id: 'radio',
  compartmentId: 'cab',
  name: 'Radio',
  sortOrder: 0,
  checkType: 'function',
  isRequired: true,
  hasExpiration: false,
  expirationWarningDays: 30,
};

const makeTemplate = (overrides: Record<string, unknown> = {}) => ({
  id: 'template-1',
  organizationId: 'org-1',
  name: 'Engine Morning Check',
  checkTiming: 'start_of_shift',
  templateType: 'equipment',
  apparatusType: 'engine',
  isActive: true,
  sortOrder: 0,
  compartments: [
    {
      id: 'cab',
      templateId: 'template-1',
      name: 'Cab',
      sortOrder: 0,
      containerType: 'compartment',
      items: [radio],
    },
  ],
  ...overrides,
});

function renderBuilder() {
  return render(
    <MemoryRouter initialEntries={['/list', '/templates/template-1']} initialIndex={1}>
      <ConfirmProvider>
        <Routes>
          <Route path="/list" element={<p>Checklist list</p>} />
          <Route path="/templates/:templateId" element={<EquipmentCheckTemplateBuilder />} />
        </Routes>
      </ConfirmProvider>
    </MemoryRouter>
  );
}

/** Laptop width, so the readiness rail is on screen rather than in a sheet. */
function useLaptopViewport() {
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
}

async function duplicateRadio() {
  const trigger = await screen.findByLabelText('Actions for Radio');
  await userEvent.click(trigger);
  await userEvent.click(
    // eslint-disable-next-line testing-library/no-node-access
    within(trigger.closest('details') as HTMLElement).getByRole('button', { name: 'Duplicate' })
  );
  await screen.findByLabelText('Actions for Radio (copy)');
}

const BANNER = /Crews can.t see this checklist right now/;

beforeEach(() => {
  vi.clearAllMocks();
  useLaptopViewport();
  getApparatusOptions.mockResolvedValue({
    source: 'apparatus',
    options: [{ id: 'e1', name: 'Engine 1', unit_number: 'E1', apparatus_type: 'engine' }],
  });
  addCheckItem.mockResolvedValue({ ...radio, id: 'radio-copy', name: 'Radio (copy)', sortOrder: 1 });
  reorderItems.mockResolvedValue(undefined);
  updateCheckItem.mockResolvedValue({});
  updateCompartment.mockResolvedValue({});
  updateEquipmentCheckTemplate.mockResolvedValue({});
});

describe('EquipmentCheckTemplateBuilder — editing a live checklist', () => {
  it('says plainly that crews lost the checklist once an edit unpublishes it', async () => {
    getTemplate.mockResolvedValue(makeTemplate());
    renderBuilder();

    expect(await screen.findByLabelText('Template status')).toHaveTextContent('Published');
    expect(screen.queryByText(BANNER)).not.toBeInTheDocument();

    await duplicateRadio();

    expect(screen.getByLabelText('Template status')).toHaveTextContent('Draft');
    expect(screen.getByText(BANNER)).toBeInTheDocument();
  });

  it('puts it back on crews’ shifts from the banner', async () => {
    const user = userEvent.setup();
    getTemplate.mockResolvedValue(makeTemplate());
    renderBuilder();
    await duplicateRadio();

    await user.click(screen.getByRole('button', { name: 'Publish now' }));

    await waitFor(() =>
      expect(updateEquipmentCheckTemplate).toHaveBeenLastCalledWith('template-1', { is_active: true })
    );
    await waitFor(() => expect(screen.queryByText(BANNER)).not.toBeInTheDocument());
    expect(screen.getByLabelText('Template status')).toHaveTextContent('Published');
  });

  it('asks before leaving it unpublished, and stays when told to', async () => {
    const user = userEvent.setup();
    getTemplate.mockResolvedValue(makeTemplate());
    renderBuilder();
    await duplicateRadio();

    await user.click(screen.getByRole('button', { name: 'Back to templates' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Leave this checklist unpublished?')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Stay here' }));

    expect(screen.queryByText('Checklist list')).not.toBeInTheDocument();
    expect(screen.getByText(BANNER)).toBeInTheDocument();
  });

  it('leaves when the officer confirms', async () => {
    const user = userEvent.setup();
    getTemplate.mockResolvedValue(makeTemplate());
    renderBuilder();
    await duplicateRadio();

    await user.click(screen.getByRole('button', { name: 'Back to templates' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Leave unpublished' }));

    expect(await screen.findByText('Checklist list')).toBeInTheDocument();
  });

  it('shows no banner for a checklist that was never published', async () => {
    getTemplate.mockResolvedValue(makeTemplate({ isActive: false }));
    renderBuilder();
    await duplicateRadio();

    expect(screen.getByLabelText('Template status')).toHaveTextContent('Draft');
    expect(screen.queryByText(BANNER)).not.toBeInTheDocument();
  });
});

describe('EquipmentCheckTemplateBuilder — which vehicles a checklist reaches', () => {
  it('names the vehicles it will be used on', async () => {
    getTemplate.mockResolvedValue(makeTemplate({ isActive: false }));
    renderBuilder();

    expect(await screen.findByText('Used on every Engine unit')).toBeInTheDocument();
    expect(screen.queryByText(/Not tied to a vehicle/)).not.toBeInTheDocument();
  });

  it('names a single unit when the checklist is for one vehicle', async () => {
    getTemplate.mockResolvedValue(makeTemplate({ isActive: false, apparatusId: 'e1' }));
    renderBuilder();

    expect(await screen.findByText('Used on E1')).toBeInTheDocument();
  });

  it('warns, without blocking publish, when it is tied to no vehicle', async () => {
    getTemplate.mockResolvedValue(makeTemplate({ isActive: false, apparatusType: undefined }));
    renderBuilder();

    expect(await screen.findByText(/Not tied to a vehicle — crews will only see it on shifts/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled());
  });

  it('carries the same caveat in the action bar where the rail does not fit', async () => {
    // Tablet width: past the 640px row layout, short of the 1152px rail, so
    // the bottom bar is the only readiness summary on screen.
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: (() => {
        const minWidth = /min-width:\s*(\d+)px/.exec(query);
        return minWidth ? 900 >= Number(minWidth[1]) : false;
      })(),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    getTemplate.mockResolvedValue(makeTemplate({ isActive: false, apparatusType: undefined }));
    renderBuilder();

    expect(await screen.findByText('Ready to publish · not tied to a vehicle')).toBeInTheDocument();
  });

  it('opens the details drawer to choose one', async () => {
    const user = userEvent.setup();
    getTemplate.mockResolvedValue(makeTemplate({ isActive: false, apparatusType: undefined }));
    renderBuilder();

    await user.click(await screen.findByRole('button', { name: 'Choose a vehicle' }));

    expect(await screen.findByText('Where will it be used?')).toBeInTheDocument();
  });
});
