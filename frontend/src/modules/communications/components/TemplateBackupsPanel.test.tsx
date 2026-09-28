import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetTemplateBackups = vi.fn();

vi.mock('../../../services/api', () => ({
  emailTemplatesService: {
    getTemplateBackups: (...args: unknown[]) => mockGetTemplateBackups(...args) as unknown,
  },
}));

// Imported after the mock so the component binds to it.
import { TemplateBackupsPanel } from './TemplateBackupsPanel';
import { renderWithRouter } from '../../../test/utils';
import type { EmailTemplateBackup } from '../../../services/api';

const backup = (overrides: Partial<EmailTemplateBackup> = {}): EmailTemplateBackup => ({
  id: 'b-1',
  template_id: 't-1',
  reason: '15c5bc7700aa',
  created_at: '2026-09-27T19:45:00Z',
  subject: 'Welcome aboard, {{first_name}}',
  html_body: '<div class="header"><h1>Old</h1></div>',
  text_body: 'Our own words.',
  restored_subject: 'Welcome aboard, {{first_name}}',
  restored_html_body: '<div class="summary"><h1>Old</h1></div><p>Our own words.</p>',
  restored_text_body: 'Our own words.',
  ...overrides,
});

const makeDraft = (isDirty = false) => ({
  isDirty,
  setSubject: vi.fn(),
  setHtmlBody: vi.fn(),
  setTextBody: vi.fn(),
});

describe('TemplateBackupsPanel', () => {
  beforeEach(() => {
    mockGetTemplateBackups.mockReset();
    mockGetTemplateBackups.mockResolvedValue([backup()]);
  });

  it('renders nothing for a template with no backup', async () => {
    mockGetTemplateBackups.mockResolvedValue([]);
    const { container } = renderWithRouter(<TemplateBackupsPanel templateId="t-1" draft={makeDraft()} />);

    await waitFor(() => expect(mockGetTemplateBackups).toHaveBeenCalledWith('t-1'));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('lists the saved version with its subject', async () => {
    renderWithRouter(<TemplateBackupsPanel templateId="t-1" draft={makeDraft()} />);

    expect(await screen.findByText(/previous version \(before the redesign\)/i)).toBeInTheDocument();
    expect(screen.getByText('Welcome aboard, {{first_name}}')).toBeInTheDocument();
  });

  it('shows the old wording on request', async () => {
    const user = userEvent.setup();
    renderWithRouter(<TemplateBackupsPanel templateId="t-1" draft={makeDraft()} />);

    await user.click(await screen.findByRole('button', { name: /show the old wording/i }));

    expect(screen.getByText('Our own words.')).toBeInTheDocument();
  });

  it('loads the restore draft, not the old markup, into a clean editor', async () => {
    const user = userEvent.setup();
    const draft = makeDraft(false);
    renderWithRouter(<TemplateBackupsPanel templateId="t-1" draft={draft} />);

    await user.click(await screen.findByRole('button', { name: /load this wording/i }));

    expect(draft.setSubject).toHaveBeenCalledWith('Welcome aboard, {{first_name}}');
    expect(draft.setHtmlBody).toHaveBeenCalledWith('<div class="summary"><h1>Old</h1></div><p>Our own words.</p>');
    expect(draft.setTextBody).toHaveBeenCalledWith('Our own words.');
  });

  it('asks before replacing unsaved edits, and keeps them on cancel', async () => {
    const user = userEvent.setup();
    const draft = makeDraft(true);
    renderWithRouter(<TemplateBackupsPanel templateId="t-1" draft={draft} />);

    await user.click(await screen.findByRole('button', { name: /load this wording/i }));
    await user.click(await screen.findByRole('button', { name: /keep editing/i }));

    expect(draft.setHtmlBody).not.toHaveBeenCalled();
  });

  it('replaces unsaved edits once confirmed', async () => {
    const user = userEvent.setup();
    const draft = makeDraft(true);
    renderWithRouter(<TemplateBackupsPanel templateId="t-1" draft={draft} />);

    await user.click(await screen.findByRole('button', { name: /load this wording/i }));
    await user.click(await screen.findByRole('button', { name: /load previous version/i }));

    expect(draft.setHtmlBody).toHaveBeenCalledWith('<div class="summary"><h1>Old</h1></div><p>Our own words.</p>');
  });

  it('says so when the backups cannot be loaded', async () => {
    mockGetTemplateBackups.mockRejectedValue(new Error('network'));
    renderWithRouter(<TemplateBackupsPanel templateId="t-1" draft={makeDraft()} />);

    expect(await screen.findByRole('status')).toBeInTheDocument();
  });
});
