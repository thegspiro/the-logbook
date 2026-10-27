/**
 * A template switched off is not sent at all, so the switch asks first, and
 * the emails a recipient cannot get any other way cannot be switched off.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

const { mockUpdateTemplate, state, shiftReminder, passwordReset } = vi.hoisted(() => {
  const template = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
    id,
    name,
    template_type: id,
    subject: name,
    html_body: '<p>Body</p>',
    is_active: true,
    attachments: [],
    ...extra,
  });
  const shift = template('shift_reminder', 'Shift Reminder');
  const reset = template('password_reset', 'Password Reset', { always_sent: true });
  const update = vi.fn();
  // Widened so a test can select the always-sent template, or an off copy.
  const selected: Record<string, unknown> = shift;
  return {
    mockUpdateTemplate: update,
    shiftReminder: shift,
    passwordReset: reset,
    state: {
      templates: [shift, reset],
      selectedTemplate: selected,
      preview: null,
      isLoading: false,
      isSaving: false,
      isPreviewing: false,
      error: null,
      fetchTemplates: vi.fn(),
      selectTemplate: vi.fn(),
      updateTemplate: (...args: unknown[]) => update(...args) as unknown,
      previewTemplate: vi.fn(),
      clearPreview: vi.fn(),
      clearError: vi.fn(),
    },
  };
});

vi.mock('../store/emailTemplatesStore', () => {
  const useEmailTemplatesStore = Object.assign(() => state, { getState: () => state });
  return { useEmailTemplatesStore };
});

vi.mock('../store/officersStore', () => ({
  useOfficersStore: (selector: (s: unknown) => unknown) => selector({ variables: [], fetchOfficers: vi.fn() }),
}));

vi.mock('../store/footersStore', () => ({
  useFootersStore: (selector: (s: unknown) => unknown) =>
    selector({ footers: [], defaultKey: null, fetchFooters: vi.fn() }),
}));

vi.mock('../hooks/useTemplateDraft', () => ({
  useTemplateDraft: () => ({ isDirty: false, hasValidationErrors: false }),
}));

vi.mock('../../../services/api', () => ({
  emailTemplatesService: {},
  userService: { getUsers: () => Promise.resolve([]) },
}));

vi.mock('../components/TemplateEditor', () => ({ TemplateEditor: () => null }));
vi.mock('../components/TemplateBackupsPanel', () => ({ TemplateBackupsPanel: () => null }));
vi.mock('../components/TemplatePreview', () => ({ TemplatePreview: () => null }));
vi.mock('../components/EmailLinkReachabilityNotice', () => ({ EmailLinkReachabilityNotice: () => null }));

import EmailTemplatesPage from './EmailTemplatesPage';

describe('EmailTemplatesPage on/off switch', () => {
  beforeEach(() => {
    mockUpdateTemplate.mockReset();
    mockUpdateTemplate.mockResolvedValue(undefined);
    state.selectedTemplate = shiftReminder;
  });

  it('asks before switching an email off, and leaves it on when told to', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EmailTemplatesPage />);

    await user.click(await screen.findByRole('button', { name: 'Switch this email off' }));
    expect(
      await screen.findByText('Shift Reminder will not be sent to anyone until you switch it back on.')
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep sending' }));

    expect(mockUpdateTemplate).not.toHaveBeenCalled();
  });

  it('switches it off once confirmed', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EmailTemplatesPage />);

    await user.click(await screen.findByRole('button', { name: 'Switch this email off' }));
    await user.click(await screen.findByRole('button', { name: 'Switch off' }));

    expect(mockUpdateTemplate).toHaveBeenCalledWith('shift_reminder', { is_active: false });
  });

  it('switches an off email back on without asking', async () => {
    state.selectedTemplate = { ...shiftReminder, is_active: false };
    const user = userEvent.setup();
    renderWithRouter(<EmailTemplatesPage />);

    await user.click(await screen.findByRole('button', { name: 'Switch this email on' }));

    expect(screen.queryByText(/will not be sent to anyone/)).not.toBeInTheDocument();
    expect(mockUpdateTemplate).toHaveBeenCalledWith('shift_reminder', { is_active: true });
  });

  it('does not offer to switch off an email that is always sent', async () => {
    state.selectedTemplate = passwordReset;
    renderWithRouter(<EmailTemplatesPage />);

    const toggle = await screen.findByRole('button', { name: 'Switch this email off' });
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute(
      'title',
      'This email cannot be switched off: its recipient has no other way to receive what it carries'
    );
    expect(screen.getByText('Always sent')).toBeInTheDocument();
  });
});
