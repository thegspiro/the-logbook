/**
 * FieldEditor — a number field's min and max are whole numbers.
 *
 * The backend stores min_value / max_value as integers, so a fractional bound
 * such as 2.5 came back as a 422 the builder showed as a generic failure. The
 * editor now refuses it with a message and never sends it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FieldEditor from './FieldEditor';
import type { FormFieldCreate } from '../../services/api';

const numberField: FormFieldCreate = {
  label: 'Years of service',
  field_type: 'number',
  sort_order: 0,
  width: 'full',
};

describe('FieldEditor number bounds', () => {
  const onSave = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    onSave.mockReset();
    onClose.mockReset();
  });

  it('refuses a fractional minimum and explains why', async () => {
    const user = userEvent.setup();
    render(<FieldEditor field={numberField} onSave={onSave} onClose={onClose} />);

    await user.type(screen.getByLabelText('Min Value'), '2.5');
    await user.click(screen.getByRole('button', { name: 'Update Field' }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Min and max values must be whole numbers');
  });

  it('refuses a fractional maximum', async () => {
    const user = userEvent.setup();
    render(<FieldEditor field={numberField} onSave={onSave} onClose={onClose} />);

    await user.type(screen.getByLabelText('Max Value'), '10.25');
    await user.click(screen.getByRole('button', { name: 'Update Field' }));

    expect(onSave).not.toHaveBeenCalled();
  });

  it('sends whole-number bounds as integers', async () => {
    const user = userEvent.setup();
    render(<FieldEditor field={numberField} onSave={onSave} onClose={onClose} />);

    expect(screen.getByLabelText('Min Value')).toHaveAttribute('step', '1');
    await user.type(screen.getByLabelText('Min Value'), '1');
    await user.type(screen.getByLabelText('Max Value'), '40');
    await user.click(screen.getByRole('button', { name: 'Update Field' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ min_value: 1, max_value: 40 }));
  });
});
