import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import type { ShiftEvaluationTemplate, ShiftEvaluationTemplateWrite } from '../../types/training';

const mockList = vi.fn();
const mockGetSettings = vi.fn();
const mockUpdateSettings = vi.fn();
const mockGetExample = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockRemove = vi.fn();
vi.mock('../../services/api', () => ({
  shiftEvaluationTemplateService: {
    list: (...a: unknown[]) => mockList(...a) as unknown,
    getSettings: (...a: unknown[]) => mockGetSettings(...a) as unknown,
    updateSettings: (...a: unknown[]) => mockUpdateSettings(...a) as unknown,
    getExample: (...a: unknown[]) => mockGetExample(...a) as unknown,
    create: (...a: unknown[]) => mockCreate(...a) as unknown,
    update: (...a: unknown[]) => mockUpdate(...a) as unknown,
    remove: (...a: unknown[]) => mockRemove(...a) as unknown,
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import ShiftEvaluationSettingsPanel from './ShiftEvaluationSettingsPanel';

const example: ShiftEvaluationTemplateWrite = {
  name: 'EMT Shift Evaluation',
  description: null,
  is_active: true,
  scale: [
    { value: 1, label: 'Unsatisfactory' },
    { value: 2, label: 'Needs Improvement' },
    { value: 3, label: 'Meets Expectations' },
    { value: 4, label: 'Exceeds Expectations' },
  ],
  allow_not_applicable: true,
  not_applicable_label: 'Not Observed',
  comment_required_at_or_below: 2,
  header_fields: [
    { key: 'platoon', label: 'Shift (A, B, C)', type: 'choice', options: ['A', 'B', 'C'], required: true },
  ],
  statistics: ['calls', 'transports', 'refusals'],
  sections: [
    {
      key: 'clinical',
      title: 'Clinical Performance',
      column_heading: 'Skill Area',
      items: [{ key: 'vital_signs', label: 'Vital Signs', comment_always_required: false }],
    },
  ],
  closing_comments_label: 'Preceptor Comments',
  closing_comments_hint: null,
  evaluator_rule: 'shift_officer',
  evaluated_seats: ['ems'],
};

const saved = (overrides: Partial<ShiftEvaluationTemplate> = {}): ShiftEvaluationTemplate => ({
  ...example,
  id: 'tpl-emt',
  organization_id: 'org-1',
  version: 3,
  program_names: [],
  is_general_form: false,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  ...overrides,
});

const offSettings = {
  general_shift_evaluation_template_id: null,
  general_shift_evaluation_mode: 'off',
  one_shift_evaluation_for_multiple_programs: false,
};

describe('ShiftEvaluationSettingsPanel — templates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockReset();
    mockList.mockResolvedValue([]);
    mockGetSettings.mockReset();
    mockGetSettings.mockResolvedValue(offSettings);
    mockGetExample.mockReset();
    mockGetExample.mockResolvedValue(example);
    mockCreate.mockReset();
    mockCreate.mockResolvedValue(saved());
    mockUpdate.mockReset();
    mockUpdate.mockResolvedValue(saved());
    mockRemove.mockReset();
    mockRemove.mockResolvedValue(undefined);
  });

  it('says the forms are not in use on shifts yet', async () => {
    renderWithRouter(<ShiftEvaluationSettingsPanel />);

    expect(await screen.findByText('Not in use on shifts yet.')).toBeInTheDocument();
    expect(screen.getByText(/No evaluation templates yet/)).toBeInTheDocument();
  });

  it('starts from the example and creates it', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ShiftEvaluationSettingsPanel />);

    await user.click(await screen.findByRole('button', { name: 'Start from example' }));
    expect(await screen.findByLabelText('Name')).toHaveValue('EMT Shift Evaluation');
    await user.click(screen.getAllByRole('button', { name: 'Save template' })[0] ?? document.body);

    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith(example));
  });

  it('renames the example when the department already has one by that name', async () => {
    mockList.mockResolvedValue([saved()]);
    const user = userEvent.setup();
    renderWithRouter(<ShiftEvaluationSettingsPanel />);

    await user.click(await screen.findByRole('button', { name: 'Start from example' }));

    expect(await screen.findByLabelText('Name')).toHaveValue('EMT Shift Evaluation (2)');
  });

  it('edits a saved template, sending its keys back', async () => {
    mockList.mockResolvedValue([saved()]);
    const user = userEvent.setup();
    renderWithRouter(<ShiftEvaluationSettingsPanel />);

    await user.click(await screen.findByRole('button', { name: 'Edit EMT Shift Evaluation' }));
    const item = screen.getByLabelText('Clinical Performance item 1 name');
    await user.clear(item);
    await user.type(item, 'Vital Signs (accuracy)');
    await user.click(screen.getAllByRole('button', { name: 'Save template' })[0] ?? document.body);

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const [id, body] = mockUpdate.mock.calls[0] as [string, ShiftEvaluationTemplateWrite];
    expect(id).toBe('tpl-emt');
    expect(body.sections[0]?.key).toBe('clinical');
    expect(body.sections[0]?.items[0]).toEqual({
      key: 'vital_signs',
      label: 'Vital Signs (accuracy)',
      comment_always_required: false,
    });
  });

  it('refuses to save a template with no name, saying why', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ShiftEvaluationSettingsPanel />);

    await user.click(await screen.findByRole('button', { name: 'New template' }));
    await user.click(screen.getAllByRole('button', { name: 'Save template' })[0] ?? document.body);

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Give the template a name.')).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('names what a delete clears before deleting', async () => {
    mockList.mockResolvedValue([saved({ program_names: ['EMT Field Internship'], is_general_form: true })]);
    const user = userEvent.setup();
    renderWithRouter(<ShiftEvaluationSettingsPanel />);

    await user.click(await screen.findByRole('button', { name: 'Delete EMT Shift Evaluation' }));
    expect(await screen.findByText('EMT Field Internship will have no evaluation form.')).toBeInTheDocument();
    expect(screen.getByText('The general shift evaluation will be turned off.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete template' }));

    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('tpl-emt'));
  });

  it('deletes nothing when the officer keeps the template', async () => {
    mockList.mockResolvedValue([saved()]);
    const user = userEvent.setup();
    renderWithRouter(<ShiftEvaluationSettingsPanel />);

    await user.click(await screen.findByRole('button', { name: 'Delete EMT Shift Evaluation' }));
    await user.click(await screen.findByRole('button', { name: 'Keep it' }));

    expect(mockRemove).not.toHaveBeenCalled();
  });
});

describe('ShiftEvaluationSettingsPanel — general form settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockReset();
    mockList.mockResolvedValue([saved(), saved({ id: 'tpl-old', name: 'Old Form', is_active: false })]);
    mockGetSettings.mockReset();
    mockGetSettings.mockResolvedValue(offSettings);
    mockUpdateSettings.mockReset();
    mockUpdateSettings.mockResolvedValue({
      general_shift_evaluation_template_id: 'tpl-emt',
      general_shift_evaluation_mode: 'required',
      one_shift_evaluation_for_multiple_programs: true,
    });
  });

  it('offers no mode until a form is chosen, and no inactive form', async () => {
    renderWithRouter(<ShiftEvaluationSettingsPanel />);

    const form = await screen.findByLabelText('General form');
    expect(within(form).queryByRole('option', { name: /Old Form/ })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Required/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled();
  });

  it('saves the form, its mode and the multi-program choice', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ShiftEvaluationSettingsPanel />);

    await user.selectOptions(await screen.findByLabelText('General form'), 'EMT Shift Evaluation');
    await user.click(screen.getByRole('radio', { name: /Required/ }));
    await user.click(screen.getByRole('checkbox', { name: /One evaluation counts for every program/ }));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() =>
      expect(mockUpdateSettings).toHaveBeenCalledWith({
        general_shift_evaluation_template_id: 'tpl-emt',
        general_shift_evaluation_mode: 'required',
        one_shift_evaluation_for_multiple_programs: true,
      })
    );
  });

  it('turns the mode off when the form is removed', async () => {
    mockGetSettings.mockResolvedValue({
      general_shift_evaluation_template_id: 'tpl-emt',
      general_shift_evaluation_mode: 'optional',
      one_shift_evaluation_for_multiple_programs: false,
    });
    const user = userEvent.setup();
    renderWithRouter(<ShiftEvaluationSettingsPanel />);

    await user.selectOptions(await screen.findByLabelText('General form'), 'No general form');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() =>
      expect(mockUpdateSettings).toHaveBeenCalledWith({
        general_shift_evaluation_template_id: null,
        general_shift_evaluation_mode: 'off',
        one_shift_evaluation_for_multiple_programs: false,
      })
    );
  });
});

describe('ShiftEvaluationSettingsPanel — unsaved settings survive template edits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockReset();
    mockList.mockResolvedValue([saved(), saved({ id: 'tpl-2', name: 'Driver Evaluation' })]);
    mockGetSettings.mockReset();
    mockGetSettings.mockResolvedValue(offSettings);
    mockUpdate.mockReset();
    mockUpdate.mockResolvedValue(saved());
    mockRemove.mockReset();
    mockRemove.mockResolvedValue(undefined);
  });

  it('keeps a chosen general form and mode after a template is saved', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ShiftEvaluationSettingsPanel />);

    await user.selectOptions(await screen.findByLabelText('General form'), 'EMT Shift Evaluation');
    await user.click(screen.getByRole('radio', { name: /Required/ }));
    await user.click(screen.getByRole('button', { name: 'Edit Driver Evaluation' }));
    await user.click(screen.getAllByRole('button', { name: 'Save template' })[0] ?? document.body);

    expect(await screen.findByLabelText('General form')).toHaveValue('tpl-emt');
    expect(screen.getByRole('radio', { name: /Required/ })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeEnabled();
  });

  it('drops an unsaved choice of a template that is then deleted, and keeps the rest', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ShiftEvaluationSettingsPanel />);

    await user.selectOptions(await screen.findByLabelText('General form'), 'Driver Evaluation');
    await user.click(screen.getByRole('checkbox', { name: /One evaluation counts for every program/ }));
    mockList.mockResolvedValue([saved()]);
    await user.click(screen.getByRole('button', { name: 'Delete Driver Evaluation' }));
    await user.click(await screen.findByRole('button', { name: 'Delete template' }));

    await waitFor(() => expect(screen.getByLabelText('General form')).toHaveValue(''));
    expect(screen.getByRole('checkbox', { name: /One evaluation counts for every program/ })).toBeChecked();
  });
});
