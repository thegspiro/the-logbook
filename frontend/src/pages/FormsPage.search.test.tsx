/**
 * Searching refetches the list on every keystroke. A slow response for an
 * earlier prefix must not replace the list for what has been typed since.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import type { FormDef } from '../services/api';

const mockGetForms = vi.fn();
const mockGetForm = vi.fn();
const mockGetSubmissions = vi.fn();

vi.mock('../services/api', () => ({
  formsService: {
    getForms: (...args: unknown[]) => mockGetForms(...args) as unknown,
    getForm: (...args: unknown[]) => mockGetForm(...args) as unknown,
    getSubmissions: (...args: unknown[]) => mockGetSubmissions(...args) as unknown,
    getSummary: () =>
      Promise.resolve({
        total_forms: 1,
        published_forms: 1,
        draft_forms: 0,
        total_submissions: 12,
        submissions_this_month: 0,
        public_forms: 0,
      }),
  },
}));

vi.mock('../components/forms', () => ({
  FormBuilder: () => null,
  FormRenderer: () => null,
  SubmissionViewer: () => null,
  FormResultsPanel: () => null,
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    user: { id: 'u1', permissions: ['forms.manage'] },
    checkPermission: () => true,
  }),
}));

import FormsPage from './FormsPage';

const form: FormDef = {
  id: 'form-1',
  organization_id: 'org-1',
  name: 'Equipment Request',
  category: 'Operations',
  status: 'published',
  allow_multiple_submissions: true,
  require_authentication: true,
  notify_on_submission: false,
  is_public: false,
  allow_embed: false,
  version: 1,
  is_template: false,
  field_count: 3,
  submission_count: 12,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

describe('FormsPage search', () => {
  beforeEach(() => {
    mockGetForms.mockReset();
    mockGetForm.mockReset();
    mockGetSubmissions.mockReset();
  });

  it('keeps the list for the latest search when an earlier one answers late', async () => {
    let releaseEq: (value: unknown) => void = () => undefined;
    mockGetForms.mockImplementation((params: { search?: string }) => {
      if (params.search === 'eq') {
        return new Promise((resolve) => {
          releaseEq = resolve;
        });
      }
      if (params.search === 'equip') return Promise.resolve({ forms: [form], total: 1 });
      return Promise.resolve({ forms: [], total: 0 });
    });
    const user = userEvent.setup();
    renderWithRouter(<FormsPage />);

    await user.type(await screen.findByRole('textbox', { name: 'Search forms' }), 'equip');
    expect(await screen.findByText('Equipment Request')).toBeInTheDocument();
    releaseEq({ forms: [{ ...form, id: 'form-2', name: 'Equestrian Patrol Signup' }], total: 1 });
    await waitFor(() => expect(mockGetForms).toHaveBeenCalledTimes(6));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByText('Equipment Request')).toBeInTheDocument();
    expect(screen.queryByText('Equestrian Patrol Signup')).not.toBeInTheDocument();
  });
});
