/**
 * The Integrations dialog shows its own errors (the page banner sits behind
 * it) and opens fresh for each form, so mappings chosen on one form are never
 * stored against another.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import type { FormDef, FormDetailDef } from '../services/api';

const mockGetForms = vi.fn();
const mockGetForm = vi.fn();
const mockGetSubmissions = vi.fn();
const mockAddIntegration = vi.fn();

vi.mock('../services/api', () => ({
  formsService: {
    getForms: (...args: unknown[]) => mockGetForms(...args) as unknown,
    getForm: (...args: unknown[]) => mockGetForm(...args) as unknown,
    getSubmissions: (...args: unknown[]) => mockGetSubmissions(...args) as unknown,
    addIntegration: (...args: unknown[]) => mockAddIntegration(...args) as unknown,
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

const field = (id: string, label: string) => ({
  id,
  form_id: 'form-1',
  label,
  field_type: 'member_lookup',
  required: false,
  sort_order: 0,
  width: 'full',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
});

const detail: FormDetailDef = {
  ...form,
  fields: [field('fld-member', 'Member receiving gear')],
  integrations: [],
};

const openIntegrations = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('button', { name: 'Integrations' }));
  return screen.findByRole('dialog', { name: 'Integrations' });
};

describe('FormsPage integrations dialog', () => {
  beforeEach(() => {
    mockGetForms.mockReset();
    mockGetForm.mockReset();
    mockGetSubmissions.mockReset();
    mockAddIntegration.mockReset();
    mockGetForms.mockResolvedValue({ forms: [form], total: 1 });
    mockGetForm.mockResolvedValue(detail);
    mockGetSubmissions.mockResolvedValue({ submissions: [], total: 0, skip: 0, limit: 500 });
    mockAddIntegration.mockResolvedValue(undefined);
  });

  it('says inside the dialog which required mapping is missing', async () => {
    const user = userEvent.setup();
    renderWithRouter(<FormsPage />);
    const dialog = await openIntegrations(user);

    await user.selectOptions(within(dialog).getByLabelText('Target Module'), 'inventory');
    await user.click(within(dialog).getByRole('button', { name: 'Add Integration' }));

    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Choose a form field for: Member (member_lookup field)'
    );
    expect(mockAddIntegration).not.toHaveBeenCalled();
  });

  it('opens fresh, without the target and mappings chosen last time', async () => {
    const user = userEvent.setup();
    renderWithRouter(<FormsPage />);
    let dialog = await openIntegrations(user);
    await user.selectOptions(within(dialog).getByLabelText('Target Module'), 'inventory');
    await user.selectOptions(within(dialog).getByLabelText(/Member \(member_lookup field\)/), 'fld-member');
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));

    dialog = await openIntegrations(user);

    expect(within(dialog).getByLabelText('Target Module')).toHaveValue('membership');
    expect(within(dialog).queryByLabelText(/Member \(member_lookup field\)/)).not.toBeInTheDocument();
  });
});
