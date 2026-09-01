import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
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
    await user.click(screen.getByRole('checkbox', { name: 'Administrative access' }));
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
