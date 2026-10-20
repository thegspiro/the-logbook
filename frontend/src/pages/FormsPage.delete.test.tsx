/**
 * Deleting a form takes every submission with it, and deleting an
 * integration stops automatic processing, so both ask first.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import type { FormDef, FormDetailDef } from '../services/api';

const mockGetForms = vi.fn();
const mockGetForm = vi.fn();
const mockGetSubmissions = vi.fn();
const mockDeleteForm = vi.fn();
const mockDeleteIntegration = vi.fn();

vi.mock('../services/api', () => ({
  formsService: {
    getForms: (...args: unknown[]) => mockGetForms(...args) as unknown,
    getForm: (...args: unknown[]) => mockGetForm(...args) as unknown,
    getSubmissions: (...args: unknown[]) => mockGetSubmissions(...args) as unknown,
    deleteForm: (...args: unknown[]) => mockDeleteForm(...args) as unknown,
    deleteIntegration: (...args: unknown[]) => mockDeleteIntegration(...args) as unknown,
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
  version: 1,
  is_template: false,
  field_count: 3,
  submission_count: 12,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

const detail: FormDetailDef = {
  ...form,
  fields: [],
  integrations: [
    {
      id: 'integ-1',
      form_id: 'form-1',
      organization_id: 'org-1',
      target_module: 'inventory',
      integration_type: 'equipment_request',
      field_mappings: {},
      is_active: true,
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
    },
  ],
};

describe('FormsPage deletions', () => {
  beforeEach(() => {
    mockGetForms.mockReset();
    mockGetForm.mockReset();
    mockGetSubmissions.mockReset();
    mockDeleteForm.mockReset();
    mockDeleteIntegration.mockReset();
    mockGetForms.mockResolvedValue({ forms: [form], total: 1 });
    mockGetForm.mockResolvedValue(detail);
    mockGetSubmissions.mockResolvedValue({ submissions: [], total: 0, skip: 0, limit: 500 });
    mockDeleteForm.mockResolvedValue(undefined);
    mockDeleteIntegration.mockResolvedValue(undefined);
  });

  it('says the submissions go with the form, and Keep form deletes nothing', async () => {
    const user = userEvent.setup();
    renderWithRouter(<FormsPage />);

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this form?' });
    expect(dialog).toHaveTextContent('every submission made to it is deleted with it (12 submissions)');

    await user.click(within(dialog).getByRole('button', { name: 'Keep form' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mockDeleteForm).not.toHaveBeenCalled();
  });

  it('deletes the form once confirmed', async () => {
    const user = userEvent.setup();
    renderWithRouter(<FormsPage />);

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this form?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete form and submissions' }));

    await waitFor(() => expect(mockDeleteForm).toHaveBeenCalledWith('form-1'));
  });

  it('says automatic processing stops before deleting an integration', async () => {
    const user = userEvent.setup();
    renderWithRouter(<FormsPage />);

    await user.click(await screen.findByRole('button', { name: 'Integrations' }));
    await user.click(await screen.findByRole('button', { name: 'Delete integration' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this integration?' });
    expect(dialog).toHaveTextContent('Automatic processing stops');

    await user.click(within(dialog).getByRole('button', { name: 'Keep integration' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Delete this integration?' })).not.toBeInTheDocument()
    );
    expect(mockDeleteIntegration).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete integration' }));
    const again = await screen.findByRole('dialog', { name: 'Delete this integration?' });
    await user.click(within(again).getByRole('button', { name: 'Delete integration' }));

    await waitFor(() => expect(mockDeleteIntegration).toHaveBeenCalledWith('form-1', 'integ-1'));
  });
});
