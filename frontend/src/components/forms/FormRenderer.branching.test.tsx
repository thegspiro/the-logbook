import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../services/api', () => ({
  formsService: { getForm: vi.fn(), submitForm: vi.fn(), memberLookup: vi.fn() },
}));
vi.mock('../../hooks/useRanks', () => ({
  useRanks: () => ({ formatRank: (r: string) => r, ranks: [], loading: false }),
}));

import FormRenderer from './FormRenderer';
import type { FieldDefinition } from './FieldRenderer';

const base = { sort_order: 0, width: 'full' };

// The form built in the W60 drive: answering "No" at the top hid "Which
// certifications?" but left its required follow-up on screen, so the form
// could not be submitted without inventing a card number.
const whichField: FieldDefinition = {
  ...base,
  sort_order: 1,
  id: 'which',
  label: 'Which certifications?',
  field_type: 'checkbox',
  required: true,
  options: [
    { value: 'EMT', label: 'EMT' },
    { value: 'AEMT', label: 'AEMT' },
  ],
  condition_field_id: 'certified',
  condition_operator: 'equals',
  condition_value: 'yes',
};
const nameField: FieldDefinition = {
  ...base,
  sort_order: 3,
  id: 'name',
  label: 'Full name',
  field_type: 'text',
  required: true,
};

const intake: FieldDefinition[] = [
  {
    ...base,
    id: 'certified',
    label: 'Do you hold a medical certification?',
    field_type: 'radio',
    required: true,
    options: [
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
    ],
  },
  whichField,
  {
    ...base,
    sort_order: 2,
    id: 'card',
    label: 'EMT card number',
    field_type: 'text',
    required: true,
    condition_field_id: 'which',
    condition_operator: 'contains',
    condition_value: 'EMT',
  },
  nameField,
];

describe('FormRenderer branching (workflow review W60)', () => {
  const onSubmit = vi.fn<(data: Record<string, string>) => Promise<boolean>>();

  beforeEach(() => {
    onSubmit.mockReset();
    onSubmit.mockResolvedValue(true);
  });

  it('hides a required follow-up once the question it branches from is hidden, and submits', async () => {
    const user = userEvent.setup();
    render(<FormRenderer fields={intake} onSubmit={onSubmit} />);

    await user.click(screen.getByRole('radio', { name: 'Yes' }));
    await user.click(screen.getByRole('checkbox', { name: 'EMT' }));
    expect(screen.getByLabelText(/EMT card number/)).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'No' }));
    expect(screen.queryByText('Which certifications?')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/EMT card number/)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/Full name/), 'Pat Doe');
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    // The stale ticked box stays in state but is not sent.
    expect(onSubmit).toHaveBeenCalledWith({ certified: 'no', name: 'Pat Doe' });
  });

  it('does not open an "EMT" follow-up for an "AEMT" answer', async () => {
    const user = userEvent.setup();
    render(<FormRenderer fields={intake} onSubmit={onSubmit} />);

    await user.click(screen.getByRole('radio', { name: 'Yes' }));
    await user.click(screen.getByRole('checkbox', { name: 'AEMT' }));

    expect(screen.queryByLabelText(/EMT card number/)).not.toBeInTheDocument();
  });

  it('still requires a follow-up that is shown', async () => {
    const user = userEvent.setup();
    render(<FormRenderer fields={intake} onSubmit={onSubmit} />);

    await user.click(screen.getByRole('radio', { name: 'Yes' }));
    await user.click(screen.getByRole('checkbox', { name: 'EMT' }));
    await user.type(screen.getByLabelText(/Full name/), 'Pat Doe');
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getAllByText('EMT card number is required').length).toBeGreaterThan(0);
  });

  it('drops an error raised on a question that has since been hidden', async () => {
    const user = userEvent.setup();
    render(<FormRenderer fields={intake} onSubmit={onSubmit} />);

    await user.click(screen.getByRole('radio', { name: 'Yes' }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(screen.getAllByText('Which certifications? is required').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('radio', { name: 'No' }));
    expect(screen.queryByText('Which certifications? is required')).not.toBeInTheDocument();
  });

  it('names text inputs and checkbox groups by their labels', () => {
    render(<FormRenderer fields={[nameField, { ...whichField, condition_field_id: undefined }]} onSubmit={onSubmit} />);

    expect(screen.getByLabelText(/Full name/)).toHaveAttribute('type', 'text');
    expect(screen.getByRole('group', { name: /Which certifications\?/ })).toBeInTheDocument();
  });
});
