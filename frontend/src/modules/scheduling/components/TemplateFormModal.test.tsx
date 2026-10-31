import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

const mockGetEquipmentCheckTemplates = vi.fn();
vi.mock('../../inventory/services/equipmentCheckApi', () => ({
  equipmentCheckService: {
    // `as unknown` is the documented store-mock shape (CLAUDE.md, Frontend
    // Test Patterns): a bare vi.fn() returns `any`, which trips
    // @typescript-eslint/no-unsafe-return and spends one of the ten warnings
    // the lint budget allows.
    getEquipmentCheckTemplates: (...a: unknown[]) => mockGetEquipmentCheckTemplates(...a) as unknown,
  },
}));

const mockGetBasicApparatus = vi.fn();
vi.mock('../services/api', async () => {
  const actual = await vi.importActual<typeof import('../services/api')>('../services/api');
  return {
    ...actual,
    schedulingService: {
      getBasicApparatus: (...a: unknown[]) => mockGetBasicApparatus(...a) as unknown,
    },
  };
});

// The department settings are read through the real accessor unless a test
// installs its own; the resource-defaults block below is the one that does.
const mockCachedSettings = vi.hoisted(() => ({ override: null as Record<string, unknown> | null }));
vi.mock('../services/shiftSettingsApi', async () => {
  const actual = await vi.importActual<typeof import('../services/shiftSettingsApi')>('../services/shiftSettingsApi');
  return {
    ...actual,
    getCachedShiftSettings: () =>
      mockCachedSettings.override
        ? { ...actual.getCachedShiftSettings(), ...mockCachedSettings.override }
        : actual.getCachedShiftSettings(),
  };
});

const mockIsModuleOn = vi.fn((_key: string) => true);
vi.mock('../../../hooks/useEnabledModules', () => ({
  useEnabledModules: () => ({
    isModuleOn: (key: string) => mockIsModuleOn(key),
    enabledModules: null,
    isLoading: false,
  }),
}));

import TemplateFormModal from './TemplateFormModal';
import { emptyTemplateForm } from './shiftTemplateTypes';

const CHECKLISTS = [
  { id: 'chk-1', name: 'Engine Daily', checkTiming: 'start_of_shift' },
  { id: 'chk-2', name: 'Engine Close-out', checkTiming: 'end_of_shift' },
];

// mockReset before installing the default, so a per-test override cannot leak
// into the next block (CLAUDE.md pitfall #28).
beforeEach(() => {
  mockGetEquipmentCheckTemplates.mockReset();
  mockGetEquipmentCheckTemplates.mockResolvedValue(CHECKLISTS);
  mockIsModuleOn.mockReset();
  mockIsModuleOn.mockImplementation(() => true);
  mockGetBasicApparatus.mockReset();
  mockGetBasicApparatus.mockResolvedValue([]);
  mockCachedSettings.override = null;
});

describe('TemplateFormModal equipment checklists', () => {
  const render = (initial = {}) =>
    renderWithRouter(
      <TemplateFormModal
        isOpen
        onClose={vi.fn()}
        onSubmit={vi.fn<(data: Record<string, unknown>) => Promise<void>>().mockResolvedValue(undefined)}
        title="Edit template"
        apparatusOptions={[]}
        apparatusSource="default"
        initialData={{ ...emptyTemplateForm, name: 'Day Shift', ...initial }}
      />
    );

  it('lists the checklists an officer can name', async () => {
    render();
    expect(await screen.findByText('Engine Daily')).toBeInTheDocument();
    expect(screen.getByText('Engine Close-out')).toBeInTheDocument();
  });

  it('preselects the checklists the template already names', async () => {
    render({ equipment_check_template_ids: ['chk-2'] });
    await screen.findByText('Engine Close-out');
    const boxes = screen.getAllByRole('checkbox');
    const checked = boxes.filter((b) => (b as HTMLInputElement).checked);
    expect(checked).toHaveLength(1);
  });

  it('sends the ids the officer ticked', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(data: Record<string, unknown>) => Promise<void>>().mockResolvedValue(undefined);
    renderWithRouter(
      <TemplateFormModal
        isOpen
        onClose={vi.fn()}
        onSubmit={onSubmit}
        title="Edit template"
        apparatusOptions={[]}
        apparatusSource="default"
        initialData={{ ...emptyTemplateForm, name: 'Day Shift' }}
      />
    );
    await screen.findByText('Engine Daily');
    await user.click(screen.getByRole('checkbox', { name: /Engine Daily/ }));
    await user.click(screen.getByRole('button', { name: 'Save Template' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ equipment_check_template_ids: ['chk-1'] }));
  });

  it('sends an empty array when every checklist is unticked', async () => {
    // The clear has to reach the server. An omitted key means "leave them
    // alone", so the officer would get a success toast and keep them.
    const user = userEvent.setup();
    const onSubmit = vi.fn<(data: Record<string, unknown>) => Promise<void>>().mockResolvedValue(undefined);
    renderWithRouter(
      <TemplateFormModal
        isOpen
        onClose={vi.fn()}
        onSubmit={onSubmit}
        title="Edit template"
        apparatusOptions={[]}
        apparatusSource="default"
        initialData={{ ...emptyTemplateForm, name: 'Day Shift', equipment_check_template_ids: ['chk-1'] }}
      />
    );
    await screen.findByText('Engine Daily');
    await user.click(screen.getByRole('checkbox', { name: /Engine Daily/ }));
    await user.click(screen.getByRole('button', { name: 'Save Template' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ equipment_check_template_ids: [] }));
  });

  it('hides the picker when the Inventory module is off', async () => {
    mockIsModuleOn.mockImplementation((key: string) => key !== 'inventory');
    render();
    // Wait for the modal itself, so "not rendered" is a real absence rather
    // than an assertion that ran before anything had mounted.
    await screen.findByRole('button', { name: 'Save Template' });
    expect(screen.queryByText('Equipment checklists')).not.toBeInTheDocument();
    expect(screen.queryByText('Engine Daily')).not.toBeInTheDocument();
    expect(mockGetEquipmentCheckTemplates).not.toHaveBeenCalled();
  });

  it('still sends existing links when the picker is hidden', async () => {
    // The trap: the block is hidden, but the form owns the field and sends it
    // on every save. Dropping it would delete a template's checklist links the
    // first time anyone edited it with Inventory switched off.
    mockIsModuleOn.mockImplementation((key: string) => key !== 'inventory');
    const user = userEvent.setup();
    const onSubmit = vi.fn<(data: Record<string, unknown>) => Promise<void>>().mockResolvedValue(undefined);
    renderWithRouter(
      <TemplateFormModal
        isOpen
        onClose={vi.fn()}
        onSubmit={onSubmit}
        title="Edit template"
        apparatusOptions={[]}
        apparatusSource="default"
        initialData={{ ...emptyTemplateForm, name: 'Day Shift', equipment_check_template_ids: ['chk-1'] }}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Save Template' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ equipment_check_template_ids: ['chk-1'] }));
  });

  it('keeps the stored ids when the checklist list cannot be loaded', async () => {
    mockGetEquipmentCheckTemplates.mockRejectedValue(new Error('403'));
    const user = userEvent.setup();
    const onSubmit = vi.fn<(data: Record<string, unknown>) => Promise<void>>().mockResolvedValue(undefined);
    renderWithRouter(
      <TemplateFormModal
        isOpen
        onClose={vi.fn()}
        onSubmit={onSubmit}
        title="Edit template"
        apparatusOptions={[]}
        apparatusSource="default"
        initialData={{ ...emptyTemplateForm, name: 'Day Shift', equipment_check_template_ids: ['chk-1'] }}
      />
    );
    expect(await screen.findByText(/1 checklist\(s\) configured/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save Template' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ equipment_check_template_ids: ['chk-1'] }));
  });
});

describe('TemplateFormModal administrative position access', () => {
  it('edits, displays, and saves the per-position option', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(data: Record<string, unknown>) => Promise<void>>().mockResolvedValue(undefined);
    renderWithRouter(
      <TemplateFormModal
        isOpen
        onClose={vi.fn()}
        onSubmit={onSubmit}
        title="Edit template"
        apparatusOptions={[]}
        apparatusSource="default"
        initialData={{
          ...emptyTemplateForm,
          name: 'Support shift',
          positions: [{ position: 'other', required: true, allow_administrative_members: false }],
        }}
      />
    );

    expect(screen.getByText(/Administrative members can only use positions/)).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Administrative access, position 1' }));
    await user.click(screen.getByRole('button', { name: 'Save Template' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        positions: [expect.objectContaining({ position: 'other', allow_administrative_members: true })],
      })
    );
  });

  it('preserves administrative access on event resource seats', async () => {
    const user = userEvent.setup();
    let submitted: Record<string, unknown> | undefined;
    const onSubmit = vi.fn(async (data: Record<string, unknown>) => {
      submitted = data;
    });
    renderWithRouter(
      <TemplateFormModal
        isOpen
        onClose={vi.fn()}
        onSubmit={onSubmit}
        title="Edit event template"
        apparatusOptions={[]}
        apparatusSource="default"
        initialData={{
          ...emptyTemplateForm,
          name: 'Community event',
          category: 'event',
          resources: [{ type: 'utility_vehicle', label: 'Support', quantity: 1, positions: ['other'] }],
        }}
      />
    );

    await user.click(screen.getByRole('checkbox', { name: 'Allow administrative members for other' }));
    await user.click(screen.getByRole('button', { name: 'Save Template' }));

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(submitted?.positions).toEqual(
      expect.objectContaining({
        resources: [
          expect.objectContaining({
            positions: [expect.objectContaining({ position: 'other', allow_administrative_members: true })],
          }),
        ],
        flat_positions: [expect.objectContaining({ position: 'other', allow_administrative_members: true })],
      })
    );
  });
});

describe('TemplateFormModal field names', () => {
  it('tells the start and end pickers apart, and names each crew seat and the chosen category', () => {
    renderWithRouter(
      <TemplateFormModal
        isOpen
        onClose={vi.fn()}
        onSubmit={vi.fn<(data: Record<string, unknown>) => Promise<void>>().mockResolvedValue(undefined)}
        title="Create Template"
        apparatusOptions={[]}
        apparatusSource="default"
        initialData={{
          ...emptyTemplateForm,
          name: 'Day Shift A',
          positions: [
            { position: 'officer', required: true, allow_administrative_members: false },
            { position: 'driver', required: true, allow_administrative_members: false },
          ],
        }}
      />
    );

    expect(screen.getByRole('combobox', { name: 'Starts at hour' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Ends at hour' })).toBeInTheDocument();

    const category = screen.getByRole('group', { name: 'Category' });
    expect(category).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Standard/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Event \/ Special/ })).toHaveAttribute('aria-pressed', 'false');

    expect(screen.getByRole('combobox', { name: 'Position 1' })).toHaveValue('officer');
    expect(screen.getByRole('combobox', { name: 'Position 2' })).toHaveValue('driver');
    expect(screen.getByRole('checkbox', { name: 'Administrative access, position 2' })).not.toBeChecked();
  });
});

describe('TemplateFormModal clearing fields on edit', () => {
  const vehicles = [
    { id: 'app-1', name: 'Engine 1', unit_number: 'E1', apparatus_type: 'engine', source: 'apparatus' as const },
  ];
  const stored = {
    ...emptyTemplateForm,
    name: 'Day Shift',
    description: 'Station 1 day crew',
    apparatus_type: 'engine',
    apparatus_id: 'app-1',
  };
  const onSubmit = vi.fn<(data: Record<string, unknown>) => Promise<void>>();

  beforeEach(() => {
    onSubmit.mockReset();
    onSubmit.mockResolvedValue(undefined);
  });

  const renderEdit = () =>
    renderWithRouter(
      <TemplateFormModal
        isOpen
        onClose={vi.fn()}
        onSubmit={onSubmit}
        title="Edit Template"
        apparatusOptions={vehicles}
        apparatusSource="apparatus"
        initialData={stored}
      />
    );

  it('sends null for a cleared description and vehicle, so the clear persists', async () => {
    // The update endpoint reads exclude_unset: an omitted key keeps the stored
    // value, so a template unlinked from its rig stayed linked after save.
    const user = userEvent.setup();
    renderEdit();

    await user.clear(screen.getByLabelText('Description'));
    await user.selectOptions(screen.getByLabelText(/^Vehicle/), '');
    await user.click(screen.getByRole('button', { name: 'Save Template' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ description: null, apparatus_type: null, apparatus_id: null })
    );
  });

  it('drops the vehicle id as well as the type when the category becomes Event', async () => {
    // The event category hides the vehicle picker and used to blank only the
    // type, leaving the event template bound to Engine 1 by id.
    const user = userEvent.setup();
    renderEdit();

    await user.click(screen.getByRole('button', { name: /Event \/ Special/ }));
    await user.click(screen.getByRole('button', { name: 'Save Template' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ category: 'event', apparatus_type: null, apparatus_id: null })
    );
  });

  it('omits blank optional fields when creating', async () => {
    const user = userEvent.setup();
    renderWithRouter(
      <TemplateFormModal
        isOpen
        onClose={vi.fn()}
        onSubmit={onSubmit}
        title="Create Template"
        apparatusOptions={vehicles}
        apparatusSource="apparatus"
      />
    );

    await user.type(screen.getByLabelText(/^Name/), 'Night Shift');
    await user.click(screen.getByRole('button', { name: 'Save Template' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0]?.[0] ?? {};
    expect(payload.description).toBeUndefined();
    expect(payload.apparatus_type).toBeUndefined();
    expect(payload.apparatus_id).toBeUndefined();
  });
});

// A vehicle that templates or shifts still name is deactivated rather than
// deleted, so it drops out of `apparatusOptions` (active vehicles only). The
// select used to show a blank while the stale id went back on save.
describe('TemplateFormModal with a deactivated vehicle', () => {
  const active = [
    { id: 'app-1', name: 'Engine 1', unit_number: 'E1', apparatus_type: 'engine', source: 'basic' as const },
  ];
  const onSubmit = vi.fn<(data: Record<string, unknown>) => Promise<void>>();

  beforeEach(() => {
    onSubmit.mockReset();
    onSubmit.mockResolvedValue(undefined);
    mockGetBasicApparatus.mockResolvedValue([
      { id: 'app-old', unit_number: 'E9', name: 'Old Engine', apparatus_type: 'engine', is_active: false },
    ]);
  });

  const renderWith = (apparatusId: string) =>
    renderWithRouter(
      <TemplateFormModal
        isOpen
        onClose={vi.fn()}
        onSubmit={onSubmit}
        title="Edit Template"
        apparatusOptions={active}
        apparatusSource="basic"
        initialData={{ ...emptyTemplateForm, name: 'Day Shift', apparatus_type: 'engine', apparatus_id: apparatusId }}
      />
    );

  it('keeps the stored vehicle selected and named, and saves it unchanged', async () => {
    const user = userEvent.setup();
    renderWith('app-old');

    expect(await screen.findByRole('option', { name: 'E9 — Old Engine (inactive)' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Vehicle/)).toHaveValue('app-old');
    expect(mockGetBasicApparatus).toHaveBeenCalledWith({ is_active: false });

    await user.click(screen.getByRole('button', { name: 'Save Template' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ apparatus_id: 'app-old' }));
  });

  it('offers no inactive vehicle to a template that does not already name one', () => {
    renderWith('app-1');

    expect(screen.queryByRole('option', { name: /inactive/ })).not.toBeInTheDocument();
    expect(mockGetBasicApparatus).not.toHaveBeenCalled();
  });
});

describe('TemplateFormModal event resource defaults', () => {
  const renderEventForm = (onSubmit: (data: Record<string, unknown>) => Promise<void>) =>
    renderWithRouter(
      <TemplateFormModal
        isOpen
        onClose={vi.fn()}
        onSubmit={onSubmit}
        title="New event template"
        apparatusOptions={[]}
        apparatusSource="default"
        initialData={{ ...emptyTemplateForm, name: 'Fair day', category: 'event' }}
      />
    );

  const submittedResourceSeats = (data: Record<string, unknown> | undefined): string[] => {
    const positions = data?.positions as { resources?: { positions: (string | { position: string })[] }[] } | undefined;
    return (positions?.resources?.[0]?.positions ?? []).map((p) => (typeof p === 'string' ? p : p.position));
  };

  it('staffs an added resource from the department’s Event Resource Defaults', async () => {
    // The settings card promised this and nothing read it: the hardcoded crew
    // was used whatever the department saved.
    mockCachedSettings.override = {
      resourceTypeDefaults: {
        first_aid_station: { label: 'First Aid Station', positions: ['paramedic', 'ems', 'ems'] },
      },
    };
    const user = userEvent.setup();
    let submitted: Record<string, unknown> | undefined;
    renderEventForm(async (data) => {
      submitted = data;
    });

    await user.click(screen.getByRole('button', { name: 'First Aid Station' }));
    await user.click(screen.getByRole('button', { name: 'Save Template' }));

    await waitFor(() => expect(submitted).toBeDefined());
    expect(submittedResourceSeats(submitted)).toEqual(['paramedic', 'ems', 'ems']);
  });

  it('keeps the built-in crew for a type the defaults do not list', async () => {
    mockCachedSettings.override = { resourceTypeDefaults: {} };
    const user = userEvent.setup();
    let submitted: Record<string, unknown> | undefined;
    renderEventForm(async (data) => {
      submitted = data;
    });

    await user.click(screen.getByRole('button', { name: 'First Aid Station' }));
    await user.click(screen.getByRole('button', { name: 'Save Template' }));

    await waitFor(() => expect(submitted).toBeDefined());
    expect(submittedResourceSeats(submitted)).toEqual(['ems', 'ems']);
  });
});

describe('TemplateFormModal — a new template starts from the department defaults', () => {
  // Scheduling Settings → Department Defaults was stored and read by nothing
  // until 2026-10-31.
  it('takes its length and minimum staffing from the settings', async () => {
    mockCachedSettings.override = { defaultDurationHours: 10, defaultMinStaffing: 3 };
    const user = userEvent.setup();
    const onSubmit = vi.fn<(data: Record<string, unknown>) => Promise<void>>().mockResolvedValue(undefined);
    renderWithRouter(
      <TemplateFormModal
        isOpen
        onClose={vi.fn()}
        onSubmit={onSubmit}
        title="New template"
        apparatusOptions={[]}
        apparatusSource="default"
      />
    );

    await user.type(screen.getByLabelText(/^Name/), 'Day Shift');
    await user.click(screen.getByRole('button', { name: 'Save Template' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        start_time_of_day: '08:00',
        end_time_of_day: '18:00',
        duration_hours: 10,
        min_staffing: 3,
      })
    );
  });
});
