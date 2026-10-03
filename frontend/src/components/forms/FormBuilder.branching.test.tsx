import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import type { FormField } from '../../services/api';

const getForm = vi.fn();
const updateField = vi.fn();
const addField = vi.fn();
const deleteField = vi.fn();
vi.mock('../../services/api', () => ({
  formsService: {
    getForm: (...a: unknown[]) => getForm(...a) as unknown,
    updateField: (...a: unknown[]) => updateField(...a) as unknown,
    addField: (...a: unknown[]) => addField(...a) as unknown,
    deleteField: (...a: unknown[]) => deleteField(...a) as unknown,
  },
}));

import FormBuilder from './FormBuilder';

const stored = (overrides: Partial<FormField> & Pick<FormField, 'id' | 'label' | 'field_type'>): FormField => ({
  form_id: 'form-1',
  required: false,
  sort_order: 0,
  width: 'full',
  created_at: '2026-10-02T00:00:00Z',
  updated_at: '2026-10-02T00:00:00Z',
  ...overrides,
});

const fields: FormField[] = [
  stored({
    id: 'certified',
    label: 'Certified?',
    field_type: 'radio',
    required: true,
    options: [
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
    ],
  }),
  stored({
    id: 'card',
    label: 'Card number',
    field_type: 'text',
    required: true,
    sort_order: 1,
    placeholder: 'NREMT-…',
    condition_field_id: 'certified',
    condition_operator: 'equals',
    condition_value: 'yes',
  }),
  stored({ id: 'years', label: 'Years of service', field_type: 'number', sort_order: 2, min_value: 0, max_value: 60 }),
];

const editorDialog = () => screen.getByRole('dialog', { name: /Edit Field|Add Field/i });

describe('FormBuilder branching and clearing (workflow review W60)', () => {
  beforeEach(() => {
    getForm.mockReset();
    getForm.mockResolvedValue({ id: 'form-1', fields });
    updateField.mockReset();
    updateField.mockResolvedValue({});
    addField.mockReset();
    addField.mockResolvedValue({});
    deleteField.mockReset();
    deleteField.mockResolvedValue(undefined);
  });

  // Removing a condition reported success and changed nothing: the editor
  // left the key out, and the API reads an absent key as "leave alone".
  it('sends explicit nulls when a condition and a placeholder are removed', async () => {
    const user = userEvent.setup();
    renderWithRouter(<FormBuilder formId="form-1" />);

    await user.click(await screen.findByRole('button', { name: 'Edit Card number' }));
    const dialog = editorDialog();
    await user.selectOptions(within(dialog).getByLabelText('Show when this field...'), '');
    await user.clear(within(dialog).getByLabelText('Placeholder (optional)'));
    await user.click(within(dialog).getByRole('button', { name: 'Update Field' }));

    expect(updateField).toHaveBeenCalledWith(
      'form-1',
      'card',
      expect.objectContaining({
        condition_field_id: null,
        condition_operator: null,
        condition_value: null,
        placeholder: null,
        required: true,
      })
    );
  });

  // Reopening a number field showed its stored limits as blank.
  it('opens a number field with its stored minimum and maximum', async () => {
    const user = userEvent.setup();
    renderWithRouter(<FormBuilder formId="form-1" />);

    await user.click(await screen.findByRole('button', { name: 'Edit Years of service' }));
    const dialog = editorDialog();
    expect(within(dialog).getByRole('radio', { name: /Number/ })).toBeChecked();
    expect(within(dialog).getByLabelText('Min Value')).toHaveValue(0);
    expect(within(dialog).getByLabelText('Max Value')).toHaveValue(60);
  });

  it('keeps a duplicated follow-up on its branch', async () => {
    const user = userEvent.setup();
    renderWithRouter(<FormBuilder formId="form-1" />);

    await user.click(await screen.findByRole('button', { name: 'Duplicate Card number' }));

    expect(addField).toHaveBeenCalledWith(
      'form-1',
      expect.objectContaining({
        label: 'Card number (copy)',
        condition_field_id: 'certified',
        condition_operator: 'equals',
        condition_value: 'yes',
      })
    );
  });

  it('asks before deleting a question and names what branches from it', async () => {
    const user = userEvent.setup();
    renderWithRouter(<FormBuilder formId="form-1" />);

    await user.click(await screen.findByRole('button', { name: 'Delete Certified?' }));
    expect(await screen.findByText(/"Card number"/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(deleteField).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete Certified?' }));
    await user.click(await screen.findByRole('button', { name: 'Delete question' }));
    expect(deleteField).toHaveBeenCalledWith('form-1', 'certified');
  });

  it('does not offer a question that branches from the one being edited', async () => {
    const user = userEvent.setup();
    renderWithRouter(<FormBuilder formId="form-1" />);

    await user.click(await screen.findByRole('button', { name: 'Edit Certified?' }));
    const options = within(within(editorDialog()).getByLabelText('Show when this field...'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(['No condition (always show)', 'Years of service']);
  });

  it('refuses an "equals" rule with no answer to compare against', async () => {
    const user = userEvent.setup();
    renderWithRouter(<FormBuilder formId="form-1" />);

    await user.click(await screen.findByRole('button', { name: 'Edit Years of service' }));
    const dialog = editorDialog();
    await user.selectOptions(within(dialog).getByLabelText('Show when this field...'), 'certified');
    await user.selectOptions(within(dialog).getByLabelText('...meets this condition'), 'equals');
    await user.click(within(dialog).getByRole('button', { name: 'Update Field' }));

    expect(within(dialog).getByText('Enter the answer this condition compares against')).toBeInTheDocument();
    expect(updateField).not.toHaveBeenCalled();
  });
});
