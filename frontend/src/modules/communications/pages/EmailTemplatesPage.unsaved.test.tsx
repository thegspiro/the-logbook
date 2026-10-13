/**
 * Workflow review W57: picking another template re-seeds the editor from it,
 * so an unsaved edit to the open template was thrown away without a word.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

const { mockSelectTemplate, mockDraft, eventReminder, shiftReminder } = vi.hoisted(() => {
  const template = (id: string, name: string) => ({
    id,
    name,
    template_type: id,
    subject: name,
    html_body: '<p>Body</p>',
    is_active: true,
    attachments: [],
  });
  return {
    mockSelectTemplate: vi.fn(),
    mockDraft: { isDirty: true, hasValidationErrors: false },
    eventReminder: template('event_reminder', 'Event Reminder'),
    shiftReminder: template('shift_reminder', 'Shift Reminder'),
  };
});

vi.mock('../store/emailTemplatesStore', () => {
  const state = {
    templates: [eventReminder, shiftReminder],
    selectedTemplate: eventReminder,
    preview: null,
    isLoading: false,
    isSaving: false,
    isPreviewing: false,
    error: null,
    fetchTemplates: vi.fn(),
    selectTemplate: (...args: unknown[]) => mockSelectTemplate(...args) as unknown,
    updateTemplate: vi.fn(),
    previewTemplate: vi.fn(),
    clearPreview: vi.fn(),
    clearError: vi.fn(),
  };
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
  useTemplateDraft: () => mockDraft,
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

describe('EmailTemplatesPage with unsaved changes (W57)', () => {
  beforeEach(() => {
    mockSelectTemplate.mockReset();
    mockDraft.isDirty = true;
  });

  it('asks before another template replaces the edit, and keeps it when told to', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EmailTemplatesPage />);

    await user.click(await screen.findByRole('button', { name: /Shift Reminder/ }));
    expect(await screen.findByText('Your unsaved changes to Event Reminder will be lost.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(mockSelectTemplate).not.toHaveBeenCalled();
  });

  it('switches once the edit is knowingly discarded', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EmailTemplatesPage />);

    await user.click(await screen.findByRole('button', { name: /Shift Reminder/ }));
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));

    expect(mockSelectTemplate).toHaveBeenCalledWith(shiftReminder);
  });

  it('switches without asking when nothing is unsaved', async () => {
    mockDraft.isDirty = false;
    const user = userEvent.setup();
    renderWithRouter(<EmailTemplatesPage />);

    await user.click(await screen.findByRole('button', { name: /Shift Reminder/ }));

    expect(screen.queryByText(/unsaved changes to/)).not.toBeInTheDocument();
    expect(mockSelectTemplate).toHaveBeenCalledWith(shiftReminder);
  });
});
