/**
 * FORM-10: "one submission per person" had no control anywhere, so every
 * form allowed repeats. It is now set when a form is created and from the
 * form editor, and written as allow_multiple_submissions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import type { FormDef } from '../services/api';

const mockGetForms = vi.fn();
const mockGetForm = vi.fn();
const mockCreateForm = vi.fn();
const mockUpdateForm = vi.fn();

vi.mock('../services/api', () => ({
  formsService: {
    getForms: (...args: unknown[]) => mockGetForms(...args) as unknown,
    getForm: (...args: unknown[]) => mockGetForm(...args) as unknown,
    createForm: (...args: unknown[]) => mockCreateForm(...args) as unknown,
    updateForm: (...args: unknown[]) => mockUpdateForm(...args) as unknown,
    getSummary: () =>
      Promise.resolve({
        total_forms: 1,
        published_forms: 0,
        draft_forms: 1,
        total_submissions: 0,
        submissions_this_month: 0,
        public_forms: 0,
      }),
  },
}));

// The builder loads and saves fields itself; this suite is about the form's
// own setting, so it stands in for it.
vi.mock('../components/forms', () => ({
  FormBuilder: () => <div>Field builder</div>,
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

const draft: FormDef = {
  id: 'form-1',
  organization_id: 'org-1',
  name: 'Equipment Request',
  category: 'Operations',
  status: 'draft',
  allow_multiple_submissions: true,
  require_authentication: true,
  notify_on_submission: false,
  is_public: false,
  version: 1,
  is_template: false,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

describe('FormsPage — one submission per person (FORM-10)', () => {
  beforeEach(() => {
    mockGetForms.mockReset();
    mockGetForm.mockReset();
    mockCreateForm.mockReset();
    mockUpdateForm.mockReset();
    mockGetForms.mockResolvedValue({ forms: [draft], total: 1 });
    mockGetForm.mockResolvedValue({ ...draft, fields: [], integrations: [] });
    mockCreateForm.mockResolvedValue({ id: 'form-2' });
    mockUpdateForm.mockResolvedValue({});
  });

  it('creates a form that allows one submission each when ticked', async () => {
    const user = userEvent.setup();
    renderWithRouter(<FormsPage />);

    await user.click(await screen.findByRole('button', { name: 'Create Form' }));
    await user.type(screen.getByLabelText(/Form Name/), 'Annual Gear Survey');
    await user.click(screen.getByRole('checkbox', { name: /One submission per person/ }));
    const createButtons = screen.getAllByRole('button', { name: 'Create Form' });
    await user.click(createButtons[createButtons.length - 1] as HTMLElement);

    expect(mockCreateForm).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Annual Gear Survey', allow_multiple_submissions: false })
    );
  });

  it('leaves repeats allowed by default', async () => {
    const user = userEvent.setup();
    renderWithRouter(<FormsPage />);

    await user.click(await screen.findByRole('button', { name: 'Create Form' }));
    await user.type(screen.getByLabelText(/Form Name/), 'Shift Report');
    const createButtons = screen.getAllByRole('button', { name: 'Create Form' });
    await user.click(createButtons[createButtons.length - 1] as HTMLElement);

    expect(mockCreateForm).toHaveBeenCalledWith(expect.objectContaining({ allow_multiple_submissions: true }));
  });

  it('turns it on from the form editor', async () => {
    const user = userEvent.setup();
    renderWithRouter(<FormsPage />);

    await user.click(await screen.findByRole('button', { name: /Edit Fields/ }));
    const editor = await screen.findByRole('dialog', { name: 'Equipment Request' });
    const toggle = within(editor).getByRole('checkbox', { name: /One submission per person/ });
    expect(toggle).not.toBeChecked();

    await user.click(toggle);

    expect(mockUpdateForm).toHaveBeenCalledWith('form-1', { allow_multiple_submissions: false });
    expect(await within(editor).findByRole('checkbox', { name: /One submission per person/ })).toBeChecked();
  });
});
