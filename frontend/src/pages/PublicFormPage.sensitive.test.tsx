/**
 * PublicFormPage — an applicant is told which answers are kept encrypted.
 */
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

const form: PublicFormDef = {
  id: 'form-1',
  name: 'Background Questionnaire',
  category: 'administration',
  allow_multiple_submissions: true,
  require_authentication: false,
  fields: [
    { id: 'f1', label: 'Your Name', field_type: 'text', required: true, sort_order: 0, width: 'full' },
    {
      id: 'f2',
      label: 'Criminal history',
      field_type: 'textarea',
      required: false,
      sort_order: 1,
      width: 'full',
      is_sensitive: true,
    },
  ],
};

describe('PublicFormPage sensitive fields', () => {
  beforeEach(() => {
    mockGetForm.mockReset();
    mockGetForm.mockResolvedValue(form);
  });

  it('notes the encryption on the sensitive field only', async () => {
    render(
      <MemoryRouter initialEntries={['/f/abc123']}>
        <Routes>
          <Route path="/f/:slug" element={<PublicFormPage />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByLabelText('Criminal history');
    expect(
      screen.getAllByText('This answer is stored encrypted and is visible only to authorized staff.')
    ).toHaveLength(1);
  });
});
