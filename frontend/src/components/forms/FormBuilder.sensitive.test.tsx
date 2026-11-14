/**
 * FormBuilder — the Sensitive flag survives an edit and a duplicate.
 *
 * The builder copies a stored field's settings into the editor key by key, so
 * a setting missing from that copy opens as its default. For `is_sensitive`
 * the default is "off", which made every edit of a sensitive field — even a
 * rename — un-mark it, or be refused once its answers were sealed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import type { FormField } from '../../services/api';

const getForm = vi.fn();
const updateField = vi.fn();
const addField = vi.fn();
vi.mock('../../services/api', () => ({
  formsService: {
    getForm: (...a: unknown[]) => getForm(...a) as unknown,
    updateField: (...a: unknown[]) => updateField(...a) as unknown,
    addField: (...a: unknown[]) => addField(...a) as unknown,
  },
}));

import FormBuilder from './FormBuilder';

const stored = (overrides: Partial<FormField> & Pick<FormField, 'id' | 'label' | 'field_type'>): FormField => ({
  form_id: 'form-1',
  required: false,
  sort_order: 0,
  width: 'full',
  created_at: '2026-10-25T00:00:00Z',
  updated_at: '2026-10-25T00:00:00Z',
  ...overrides,
});

const fields: FormField[] = [
  stored({ id: 'name', label: 'Full name', field_type: 'text' }),
  stored({ id: 'street', label: 'Street', field_type: 'text', sort_order: 2, applicant_field: 'address_street' }),
  stored({ id: 'history', label: 'Criminal history', field_type: 'textarea', sort_order: 1, is_sensitive: true }),
];

const editorDialog = () => screen.getByRole('dialog', { name: /Edit Field|Add Field/i });

describe('FormBuilder sensitive fields', () => {
  beforeEach(() => {
    getForm.mockReset();
    getForm.mockResolvedValue({ id: 'form-1', fields });
    updateField.mockReset();
    updateField.mockResolvedValue({});
    addField.mockReset();
    addField.mockResolvedValue({});
  });

  it('badges a sensitive field in the list', async () => {
    renderWithRouter(<FormBuilder formId="form-1" />);

    await screen.findByRole('button', { name: 'Edit Criminal history' });
    expect(screen.getAllByText('Sensitive')).toHaveLength(1);
  });

  it('opens a sensitive field ticked and keeps it sensitive through a rename', async () => {
    const user = userEvent.setup();
    renderWithRouter(<FormBuilder formId="form-1" />);

    await user.click(await screen.findByRole('button', { name: 'Edit Criminal history' }));
    const dialog = editorDialog();
    const box = within(dialog).getByRole('checkbox', { name: 'Sensitive' });
    expect(box).toBeChecked();
    const label = within(dialog).getByDisplayValue('Criminal history');
    await user.clear(label);
    await user.type(label, 'Convictions');
    await user.click(within(dialog).getByRole('button', { name: 'Update Field' }));

    expect(updateField).toHaveBeenCalledWith(
      'form-1',
      'history',
      expect.objectContaining({ label: 'Convictions', is_sensitive: true })
    );
  });

  it('marks an ordinary field sensitive when the box is ticked', async () => {
    const user = userEvent.setup();
    renderWithRouter(<FormBuilder formId="form-1" />);

    await user.click(await screen.findByRole('button', { name: 'Edit Full name' }));
    const dialog = editorDialog();
    const box = within(dialog).getByRole('checkbox', { name: 'Sensitive' });
    expect(box).not.toBeChecked();
    await user.click(box);
    await user.click(within(dialog).getByRole('button', { name: 'Update Field' }));

    expect(updateField).toHaveBeenCalledWith('form-1', 'name', expect.objectContaining({ is_sensitive: true }));
  });

  it('keeps a duplicated sensitive field sensitive', async () => {
    const user = userEvent.setup();
    renderWithRouter(<FormBuilder formId="form-1" />);

    await user.click(await screen.findByRole('button', { name: 'Duplicate Criminal history' }));

    expect(addField).toHaveBeenCalledWith(
      'form-1',
      expect.objectContaining({ label: 'Criminal history (copy)', is_sensitive: true })
    );
  });

  it('badges a pre-filled field with the applicant field it reads', async () => {
    renderWithRouter(<FormBuilder formId="form-1" />);

    expect(await screen.findByText('Pre-fills: Street address')).toBeInTheDocument();
  });

  it('keeps the pre-fill through a rename, and sends null when it is removed', async () => {
    const user = userEvent.setup();
    renderWithRouter(<FormBuilder formId="form-1" />);

    await user.click(await screen.findByRole('button', { name: 'Edit Street' }));
    let dialog = editorDialog();
    expect(within(dialog).getByLabelText(/Pre-fill from applicant/)).toHaveValue('address_street');
    await user.click(within(dialog).getByRole('button', { name: 'Update Field' }));
    expect(updateField).toHaveBeenLastCalledWith(
      'form-1',
      'street',
      expect.objectContaining({ applicant_field: 'address_street' })
    );

    await user.click(await screen.findByRole('button', { name: 'Edit Street' }));
    dialog = editorDialog();
    await user.selectOptions(within(dialog).getByLabelText(/Pre-fill from applicant/), '');
    await user.click(within(dialog).getByRole('button', { name: 'Update Field' }));
    expect(updateField).toHaveBeenLastCalledWith(
      'form-1',
      'street',
      expect.objectContaining({ applicant_field: null })
    );
  });

  it('will not let one field both pre-fill and be sensitive', async () => {
    const user = userEvent.setup();
    renderWithRouter(<FormBuilder formId="form-1" />);

    await user.click(await screen.findByRole('button', { name: 'Edit Street' }));
    expect(within(editorDialog()).getByRole('checkbox', { name: 'Sensitive' })).toBeDisabled();
    await user.click(within(editorDialog()).getByRole('button', { name: 'Cancel' }));

    await user.click(await screen.findByRole('button', { name: 'Edit Criminal history' }));
    expect(within(editorDialog()).getByLabelText(/Pre-fill from applicant/)).toBeDisabled();
  });
});
