/**
 * The preview's "Preview as member" list offers current members only, like
 * every other member picker; imported former members are not a sample.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';

const { mockSelectTemplate, mockDraft, eventReminder, shiftReminder, previewProps } = vi.hoisted(() => {
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
    previewProps: { members: [] as { id: string }[] },
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
  userService: {
    getUsers: () =>
      Promise.resolve([
        { id: 'u1', first_name: 'Sam', last_name: 'Ortiz', status: 'active' },
        { id: 'u2', first_name: 'Dana', last_name: 'Reyes', status: 'probationary' },
        { id: 'u3', first_name: 'Lee', last_name: 'Park', status: 'archived' },
      ]),
  },
}));

vi.mock('../components/TemplateEditor', () => ({ TemplateEditor: () => null }));
vi.mock('../components/TemplateBackupsPanel', () => ({ TemplateBackupsPanel: () => null }));
vi.mock('../components/TemplatePreview', () => ({
  TemplatePreview: (props: { members: { id: string }[] }) => {
    previewProps.members = props.members;
    return null;
  },
}));
vi.mock('../components/EmailLinkReachabilityNotice', () => ({ EmailLinkReachabilityNotice: () => null }));

import EmailTemplatesPage from './EmailTemplatesPage';

describe('EmailTemplatesPage preview members', () => {
  beforeEach(() => {
    mockSelectTemplate.mockReset();
    mockDraft.isDirty = false;
    previewProps.members = [];
  });

  it('offers only current members to preview as', async () => {
    renderWithRouter(<EmailTemplatesPage />);

    await waitFor(() => expect(previewProps.members.map((m) => m.id)).toEqual(['u1', 'u2']));
  });
});
