import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import type { FormDef } from '../services/api';

const mockGetForms = vi.fn();
const mockUpdateForm = vi.fn();

vi.mock('../services/api', () => ({
  formsService: {
    getForms: (...args: unknown[]) => mockGetForms(...args) as unknown,
    getSummary: vi.fn().mockResolvedValue({
      total_forms: 1,
      published_forms: 1,
      draft_forms: 0,
      total_submissions: 0,
      submissions_this_month: 0,
      public_forms: 1,
    }),
    updateForm: (...args: unknown[]) => mockUpdateForm(...args) as unknown,
  },
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    user: { id: 'u1', permissions: ['forms.manage'] },
    checkPermission: () => true,
  }),
}));

import FormsPage from './FormsPage';

const baseForm: FormDef = {
  id: 'form-1',
  organization_id: 'org-1',
  name: 'Open House Sign-up',
  category: 'Operations',
  status: 'published',
  allow_multiple_submissions: true,
  require_authentication: true,
  notify_on_submission: false,
  is_public: true,
  public_slug: 'abcdef123456',
  version: 1,
  is_template: false,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

async function openShareDialog(form: FormDef) {
  mockGetForms.mockResolvedValue({ forms: [form], total: 1 });
  renderWithRouter(<FormsPage />);
  await userEvent.click(await screen.findByRole('button', { name: /^Share$/ }));
  return screen.getByRole('dialog', { name: /Share Form/ });
}

describe('FormsPage share dialog: submissions without signing in', () => {
  beforeEach(() => {
    mockGetForms.mockReset();
    mockUpdateForm.mockReset();
    mockUpdateForm.mockResolvedValue({});
  });

  it('offers the setting, off by default, and does not promise a login-free submit', async () => {
    const dialog = await openShareDialog(baseForm);

    const checkbox = within(dialog).getByRole('checkbox', { name: /Allow submissions without signing in/ });
    expect(checkbox).not.toBeChecked();
    expect(checkbox).toBeEnabled();
    expect(within(dialog).queryByText(/Anyone with the link can view and submit/)).not.toBeInTheDocument();
    expect(within(dialog).getByText(/submitting requires signing in/)).toBeInTheDocument();
  });

  it('sends require_authentication: false when the manager allows anonymous submissions', async () => {
    const dialog = await openShareDialog(baseForm);

    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Allow submissions without signing in/ }));

    await waitFor(() => {
      expect(mockUpdateForm).toHaveBeenCalledWith('form-1', { require_authentication: false });
    });
  });

  it('sends require_authentication: true when the manager turns it back off', async () => {
    const dialog = await openShareDialog({ ...baseForm, require_authentication: false });

    const checkbox = within(dialog).getByRole('checkbox', { name: /Allow submissions without signing in/ });
    expect(checkbox).toBeChecked();
    expect(within(dialog).getByText(/Anyone with the link can view and submit/)).toBeInTheDocument();

    await userEvent.click(checkbox);

    await waitFor(() => {
      expect(mockUpdateForm).toHaveBeenCalledWith('form-1', { require_authentication: true });
    });
  });

  it('disables the setting on a one-submission-per-person form, which the server refuses anonymously', async () => {
    const dialog = await openShareDialog({
      ...baseForm,
      require_authentication: false,
      allow_multiple_submissions: false,
    });

    const checkbox = within(dialog).getByRole('checkbox', { name: /Allow submissions without signing in/ });
    expect(checkbox).not.toBeChecked();
    expect(checkbox).toBeDisabled();
    expect(within(dialog).getByText(/submitting requires signing in/)).toBeInTheDocument();
  });
});
