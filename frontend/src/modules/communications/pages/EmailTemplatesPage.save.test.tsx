/**
 * Forms batch 24: an email template's save keeps what it cannot save flagged
 * and saves the rest (owner rule, 2026-11-05), instead of Save sitting greyed
 * out while a copy list is wrong and a failure saying only "Failed to save".
 *
 * The real store, draft and editor: a successful save swaps the stored
 * template, which re-seeds the draft, and that reset is what a refused field
 * has to survive.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

// The officer and footer stores are read through selectors. Their state is one
// object for the whole file: a fresh fetch function per render would re-run the
// page's load effect on every render, and with the real template store behind
// it each run renders again.
const { mockUpdateTemplate, mockToastSuccess, stored, officerState, footerState } = vi.hoisted(() => ({
  mockUpdateTemplate: vi.fn(),
  mockToastSuccess: vi.fn(),
  officerState: { variables: [], fetchOfficers: () => Promise.resolve() },
  footerState: { footers: [], defaultKey: null, fetchFooters: () => Promise.resolve() },
  stored: {
    id: 'tmpl-1',
    organization_id: 'org-1',
    template_type: 'event_reminder',
    name: 'Event Reminder',
    subject: 'Reminder: {{event_title}}',
    html_body: '<p>See you there</p>',
    text_body: '',
    footer_key: '',
    header_accent: '#991b1b',
    status_chip: 'Reminder',
    layout: 'notice',
    default_cc: [] as string[],
    default_bcc: [] as string[],
    default_cc_position_ids: [] as string[],
    is_active: true,
    allow_attachments: false,
    always_sent: false,
    attachments: [],
    available_variables: [],
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: (...a: unknown[]) => mockToastSuccess(...a) as unknown, error: vi.fn() },
}));

vi.mock('../../../services/api', () => ({
  emailTemplatesService: {
    getTemplates: () => Promise.resolve([stored]),
    updateTemplate: (...a: unknown[]) => mockUpdateTemplate(...a) as unknown,
    previewTemplate: () => Promise.resolve({ subject: '', html_body: '', text_body: '' }),
  },
  userService: { getUsers: () => Promise.resolve([]) },
  roleService: { getRoles: () => Promise.resolve([]) },
}));

vi.mock('../store/officersStore', () => ({
  useOfficersStore: (selector: (s: unknown) => unknown) => selector(officerState),
}));
vi.mock('../store/footersStore', () => ({
  useFootersStore: (selector: (s: unknown) => unknown) => selector(footerState),
}));
vi.mock('../components/TemplateBackupsPanel', () => ({ TemplateBackupsPanel: () => null }));
vi.mock('../components/TemplatePreview', () => ({ TemplatePreview: () => null }));
vi.mock('../components/EmailLinkReachabilityNotice', () => ({ EmailLinkReachabilityNotice: () => null }));
vi.mock('../components/CcPositionsField', () => ({ CcPositionsField: () => null }));

import EmailTemplatesPage from './EmailTemplatesPage';
import { useEmailTemplatesStore } from '../store/emailTemplatesStore';

describe('EmailTemplatesPage save (batch 24)', () => {
  beforeEach(() => {
    mockUpdateTemplate.mockReset();
    mockUpdateTemplate.mockImplementation((_id: string, data: Record<string, unknown>) =>
      Promise.resolve({ ...stored, ...data })
    );
    mockToastSuccess.mockReset();
    useEmailTemplatesStore.setState({ templates: [], selectedTemplate: null, error: null, isSaving: false });
  });

  const openCopies = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole('button', { name: /Default CC \/ BCC Recipients/ }));
  };

  it('keeps Save pressable with a wrong CC list, saves the rest, and keeps the CC typed and flagged', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EmailTemplatesPage />);

    const subject = await screen.findByLabelText(/^Subject Line/);
    await user.clear(subject);
    await user.type(subject, 'Tomorrow: {{{{event_title}}');
    await openCopies(user);
    await user.type(screen.getByLabelText(/Default CC/), 'chief at dept');

    const save = screen.getByRole('button', { name: /^Save$/ });
    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() => expect(mockUpdateTemplate).toHaveBeenCalledTimes(1));
    const [, body] = mockUpdateTemplate.mock.calls[0] as [string, Record<string, unknown>];
    expect(body).toEqual({ subject: 'Tomorrow: {{event_title}}' });
    const cc = await screen.findByLabelText(/Default CC/);
    await waitFor(() => expect(cc).toHaveValue('chief at dept'));
    expect(cc).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Template saved, except default cc.');
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it('resends without a subject the server refuses, and flags the subject', async () => {
    mockUpdateTemplate.mockRejectedValueOnce({
      response: { status: 422, data: { detail: [{ loc: ['body', 'subject'], msg: 'Subject is too long' }] } },
    });
    const user = userEvent.setup();
    renderWithRouter(<EmailTemplatesPage />);

    const subject = await screen.findByLabelText(/^Subject Line/);
    await user.type(subject, ' now');
    const chip = screen.getByLabelText('Status chip');
    await user.clear(chip);
    await user.type(chip, 'Soon');
    await user.click(screen.getByRole('button', { name: /^Save$/ }));

    await waitFor(() => expect(mockUpdateTemplate).toHaveBeenCalledTimes(2));
    const [, retry] = mockUpdateTemplate.mock.calls[1] as [string, Record<string, unknown>];
    expect(retry).toEqual({ status_chip: 'Soon' });
    const flagged = await screen.findByLabelText(/^Subject Line/);
    await waitFor(() => expect(flagged).toHaveValue('Reminder: {{event_title}} now'));
    expect(flagged).toHaveAccessibleDescription('Subject is too long.');
  });

  it('says a failure no field answers for by the Save button, not in a toast', async () => {
    mockUpdateTemplate.mockRejectedValue({
      response: { status: 409, data: { detail: 'Someone else saved this first.' } },
    });
    const user = userEvent.setup();
    renderWithRouter(<EmailTemplatesPage />);

    await user.type(await screen.findByLabelText(/^Subject Line/), '!');
    await user.click(screen.getByRole('button', { name: /^Save$/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Someone else saved this first.');
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it('says a full save in a toast, as before', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EmailTemplatesPage />);

    await user.type(await screen.findByLabelText(/^Subject Line/), '!');
    await user.click(screen.getByRole('button', { name: /^Save$/ }));

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('Template saved'));
  });
});
