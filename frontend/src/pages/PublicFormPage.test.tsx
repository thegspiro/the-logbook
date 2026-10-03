import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import type { PublicFormDef } from '../services/api';

const mockGetForm = vi.fn();
const mockSubmitForm = vi.fn();
vi.mock('../services/api', () => ({
  publicFormsService: {
    getForm: (...a: unknown[]) => mockGetForm(...a) as unknown,
    submitForm: (...a: unknown[]) => mockSubmitForm(...a) as unknown,
  },
}));

vi.mock('../hooks/useCaptcha', () => ({
  useCaptcha: () => ({
    required: false,
    ready: true,
    error: null,
    containerRef: { current: null },
    getToken: vi.fn(),
    reset: vi.fn(),
  }),
}));

import PublicFormPage from './PublicFormPage';

const field = (
  id: string,
  label: string,
  field_type: string,
  extra: Partial<PublicFormDef['fields'][number]> = {}
) => ({
  id,
  label,
  field_type,
  required: false,
  sort_order: 0,
  width: 'full',
  ...extra,
});

const form: PublicFormDef = {
  id: 'form-1',
  name: 'Request a Public Event',
  category: 'administration',
  allow_multiple_submissions: true,
  require_authentication: false,
  fields: [
    field('f1', 'Your Name', 'text', { required: true }),
    field('f2', 'Email Address', 'email', { required: true }),
    field('f3', 'Expected Audience Size', 'number'),
    field('f4', 'Description', 'textarea'),
    field('f5', 'Earliest Date', 'date'),
    field('f6', 'Type of Event', 'select', { options: [{ value: 'safety', label: 'Fire Safety' }] }),
    field('f7', 'Extras', 'checkbox', { options: [{ value: 'truck', label: 'Engine visit' }] }),
  ],
};

describe('PublicFormPage field labels (workflow review W22)', () => {
  beforeEach(() => {
    mockGetForm.mockReset();
    mockGetForm.mockResolvedValue(form);
  });

  // Every label was a bare <label> with no control; a screen reader heard a
  // row of unnamed edit boxes on the department's public request form.
  it('names every control by the label shown beside it', async () => {
    render(
      <MemoryRouter initialEntries={['/f/abc123']}>
        <Routes>
          <Route path="/f/:slug" element={<PublicFormPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByLabelText(/Your Name/)).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText(/Email Address/)).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText('Expected Audience Size')).toHaveAttribute('type', 'number');
    expect(screen.getByLabelText('Description').tagName).toBe('TEXTAREA');
    expect(screen.getByLabelText('Earliest Date')).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText('Type of Event').tagName).toBe('SELECT');
    expect(screen.getByRole('group', { name: 'Extras' })).toBeInTheDocument();
  });
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/f/abc123']}>
      <Routes>
        <Route path="/f/:slug" element={<PublicFormPage />} />
      </Routes>
    </MemoryRouter>
  );

// The W60 drive: answering "No" hid "Which certifications?" but left its
// required follow-up on the public page, so the browser's own required check
// refused the form with no way to satisfy it honestly.
const intake: PublicFormDef = {
  ...form,
  name: 'Volunteer Intake',
  fields: [
    field('certified', 'Do you hold a medical certification?', 'radio', {
      required: true,
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
      ],
    }),
    field('which', 'Which certifications?', 'checkbox', {
      required: true,
      options: [
        { value: 'EMT', label: 'EMT' },
        { value: 'AEMT', label: 'AEMT' },
      ],
      condition_field_id: 'certified',
      condition_operator: 'equals',
      condition_value: 'yes',
    }),
    field('card', 'EMT card number', 'text', {
      required: true,
      condition_field_id: 'which',
      condition_operator: 'contains',
      condition_value: 'EMT',
    }),
    field('name', 'Full name', 'text', { required: true }),
  ],
};

describe('PublicFormPage branching (workflow review W60)', () => {
  beforeEach(() => {
    mockGetForm.mockReset();
    mockGetForm.mockResolvedValue(intake);
    mockSubmitForm.mockReset();
    mockSubmitForm.mockResolvedValue({ message: 'Thanks' });
  });

  it('hides a follow-up of a hidden question and leaves its stale answer out', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('radio', { name: 'Yes' }));
    await user.click(screen.getByRole('checkbox', { name: 'EMT' }));
    expect(screen.getByLabelText(/EMT card number/)).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'No' }));
    expect(screen.queryByLabelText(/EMT card number/)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/Full name/), 'Pat Doe');
    await user.click(screen.getByRole('button', { name: /Submit/ }));

    expect(mockSubmitForm).toHaveBeenCalledWith('abc123', { certified: 'no', name: 'Pat Doe' }, undefined, undefined);
    expect(await screen.findByText('Thanks')).toBeInTheDocument();
  });

  it('does not open an "EMT" follow-up for an "AEMT" answer', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('radio', { name: 'Yes' }));
    await user.click(screen.getByRole('checkbox', { name: 'AEMT' }));

    expect(screen.queryByLabelText(/EMT card number/)).not.toBeInTheDocument();
  });
});
