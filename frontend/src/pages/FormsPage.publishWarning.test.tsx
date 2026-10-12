/**
 * Publishing a public request form while public intake is off asks first.
 *
 * Owner decision (outreach-publish-toggle): warn on publish. The warning text
 * comes from `GET /forms/{id}/publish-warnings`; the page only decides whether
 * to show a confirmation and honours the answer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import type { FormDef } from '../services/api';

const mockGetForms = vi.fn();
const mockGetPublishWarnings = vi.fn();
const mockPublishForm = vi.fn();

vi.mock('../services/api', () => ({
  formsService: {
    getForms: (...args: unknown[]) => mockGetForms(...args) as unknown,
    getSummary: vi.fn().mockResolvedValue({
      total_forms: 1,
      published_forms: 0,
      draft_forms: 1,
      total_submissions: 0,
      submissions_this_month: 0,
      public_forms: 1,
    }),
    getPublishWarnings: (...args: unknown[]) => mockGetPublishWarnings(...args) as unknown,
    publishForm: (...args: unknown[]) => mockPublishForm(...args) as unknown,
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

const draft: FormDef = {
  id: 'form-1',
  organization_id: 'org-1',
  name: 'Request a Station Tour',
  category: 'Operations',
  status: 'draft',
  allow_multiple_submissions: true,
  require_authentication: false,
  notify_on_submission: false,
  is_public: true,
  public_slug: 'abcdef123456',
  integration_type: 'event_request',
  version: 1,
  is_template: false,
  field_count: 4,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

const INTAKE_OFF =
  'This form files event requests from the public, but public event requests are turned off in Events settings.';

describe('FormsPage publish warning', () => {
  beforeEach(() => {
    mockGetForms.mockReset();
    mockGetPublishWarnings.mockReset();
    mockPublishForm.mockReset();
    mockGetForms.mockResolvedValue({ forms: [draft], total: 1 });
    mockPublishForm.mockResolvedValue({});
    mockGetPublishWarnings.mockResolvedValue([{ code: 'public_intake_off', message: INTAKE_OFF }]);
  });

  it('says what publishing will not do, and Not yet leaves the form a draft', async () => {
    const user = userEvent.setup();
    renderWithRouter(<FormsPage />);

    await user.click(await screen.findByRole('button', { name: 'Publish Form' }));
    const dialog = await screen.findByRole('dialog', { name: 'Publish this form?' });
    expect(within(dialog).getByText(INTAKE_OFF)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Not yet' }));
    expect(mockGetPublishWarnings).toHaveBeenCalledWith('form-1');
    expect(mockPublishForm).not.toHaveBeenCalled();
  });

  it('publishes when the manager chooses Publish anyway', async () => {
    const user = userEvent.setup();
    renderWithRouter(<FormsPage />);

    await user.click(await screen.findByRole('button', { name: 'Publish Form' }));
    const dialog = await screen.findByRole('dialog', { name: 'Publish this form?' });
    await user.click(within(dialog).getByRole('button', { name: 'Publish anyway' }));

    await waitFor(() => expect(mockPublishForm).toHaveBeenCalledWith('form-1'));
  });

  it('publishes without asking when nothing is wrong', async () => {
    mockGetPublishWarnings.mockResolvedValue([]);
    const user = userEvent.setup();
    renderWithRouter(<FormsPage />);

    await user.click(await screen.findByRole('button', { name: 'Publish Form' }));

    await waitFor(() => expect(mockPublishForm).toHaveBeenCalledWith('form-1'));
    expect(screen.queryByRole('dialog', { name: 'Publish this form?' })).not.toBeInTheDocument();
  });
});
