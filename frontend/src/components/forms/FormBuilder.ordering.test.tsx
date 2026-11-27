/**
 * Field order on a saved form. Deleting a field does not reindex on the
 * server, so stored orders have gaps and can tie. Moving, adding and
 * duplicating must work by position, and a refused reorder must not leave
 * the screen showing an order the server never saved.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import type { FormField } from '../../services/api';

const getForm = vi.fn();
const addField = vi.fn();
const updateField = vi.fn();
const reorderFields = vi.fn();
vi.mock('../../services/api', () => ({
  formsService: {
    getForm: (...a: unknown[]) => getForm(...a) as unknown,
    addField: (...a: unknown[]) => addField(...a) as unknown,
    updateField: (...a: unknown[]) => updateField(...a) as unknown,
    reorderFields: (...a: unknown[]) => reorderFields(...a) as unknown,
  },
}));

import FormBuilder from './FormBuilder';

const stored = (id: string, label: string, sort_order: number): FormField => ({
  id,
  form_id: 'form-1',
  label,
  field_type: 'text',
  required: false,
  sort_order,
  width: 'full',
  created_at: '2026-10-02T00:00:00Z',
  updated_at: '2026-10-02T00:00:00Z',
});

// "Phone" and "Email" tie at 2, as after a delete and an add.
const fields = [stored('name', 'Name', 0), stored('phone', 'Phone', 2), stored('email', 'Email', 2)];

const labelsInOrder = () =>
  screen.getAllByRole('button', { name: /^Edit / }).map((b) => b.getAttribute('aria-label') ?? '');

describe('FormBuilder field order', () => {
  beforeEach(() => {
    getForm.mockReset();
    getForm.mockResolvedValue({ id: 'form-1', fields });
    addField.mockReset();
    addField.mockResolvedValue(stored('new', 'Name (copy)', 3));
    updateField.mockReset();
    updateField.mockResolvedValue({});
    reorderFields.mockReset();
    reorderFields.mockResolvedValue(undefined);
  });

  it('moves a field past one it ties with', async () => {
    const user = userEvent.setup();
    renderWithRouter(<FormBuilder formId="form-1" />);

    await user.click(await screen.findByRole('button', { name: 'Move Email up' }));

    await waitFor(() => expect(reorderFields).toHaveBeenCalledWith('form-1', ['name', 'email', 'phone']));
  });

  it('puts a duplicate directly under its original', async () => {
    const user = userEvent.setup();
    renderWithRouter(<FormBuilder formId="form-1" />);

    await user.click(await screen.findByRole('button', { name: 'Duplicate Name' }));

    await waitFor(() => expect(reorderFields).toHaveBeenCalledWith('form-1', ['name', 'new', 'phone', 'email']));
    expect(addField.mock.calls[0]?.[1]).not.toHaveProperty('sort_order');
  });

  it('lets the server place a new field rather than guessing an order that is taken', async () => {
    const user = userEvent.setup();
    renderWithRouter(<FormBuilder formId="form-1" />);

    await user.click(await screen.findByRole('button', { name: 'Add Field' }));
    const dialog = screen.getByRole('dialog', { name: 'Add Field' });
    await user.type(within(dialog).getByLabelText(/Label/), 'Address');
    await user.click(within(dialog).getByRole('button', { name: 'Add Field' }));

    await waitFor(() => expect(addField).toHaveBeenCalled());
    expect(addField.mock.calls[0]?.[1]).not.toHaveProperty('sort_order');
  });

  it('shows the saved order again when a reorder is refused', async () => {
    reorderFields.mockRejectedValue(new Error('refused'));
    const user = userEvent.setup();
    renderWithRouter(<FormBuilder formId="form-1" />);
    await screen.findByRole('button', { name: 'Move Name down' });
    const before = labelsInOrder();

    await user.click(screen.getByRole('button', { name: 'Move Name down' }));

    expect(await screen.findByText('Failed to reorder fields.')).toBeInTheDocument();
    expect(labelsInOrder()).toEqual(before);
  });
});
