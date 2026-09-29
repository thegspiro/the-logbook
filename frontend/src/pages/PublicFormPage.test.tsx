import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import type { PublicFormDef } from '../services/api';

const mockGetForm = vi.fn();
vi.mock('../services/api', () => ({
  publicFormsService: {
    getForm: (...a: unknown[]) => mockGetForm(...a) as unknown,
    submitForm: vi.fn(),
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
