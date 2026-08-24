import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { TemplateEditor } from './TemplateEditor';
import { useTemplateDraft } from '../hooks/useTemplateDraft';
import { COLOURWAYS, EMAIL_BLOCKS, EMAIL_LAYOUTS } from '../constants/blocks';
import type { EmailTemplate, EmailTemplateUpdate } from '../types';

const makeTemplate = (overrides: Partial<EmailTemplate> = {}): EmailTemplate => ({
  id: 'tmpl-1',
  organization_id: 'org-1',
  template_type: 'welcome',
  name: 'Welcome Email',
  description: 'Sent to new members',
  subject: 'Welcome to {{organization_name}}',
  html_body: '<p>Hello {{first_name}}</p>',
  text_body: 'Hello {{first_name}}',
  css_styles: 'body { color: #333; }',
  allow_attachments: false,
  is_active: true,
  available_variables: [
    { name: 'first_name', description: "Recipient's first name" },
    { name: 'organization_name', description: 'Organization name' },
  ],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  attachments: [],
  ...overrides,
});

/**
 * Save and the draft now live in the page, not the editor card, so a test of
 * the editor has to supply what the page supplies. This harness is the page's
 * half: it owns the draft and renders the Save button beside the form, which
 * is also what lets these tests keep asserting on save behaviour.
 */
const Harness: React.FC<{
  template: EmailTemplate;
  onSave?: (data: EmailTemplateUpdate) => void;
  isSaving?: boolean;
}> = ({ template, onSave = vi.fn(), isSaving = false }) => {
  const draft = useTemplateDraft(template);
  return (
    <>
      <button
        type="button"
        disabled={!draft.isDirty || isSaving || draft.hasValidationErrors}
        onClick={() => {
          onSave(draft.buildUpdate());
        }}
      >
        Save
      </button>
      <TemplateEditor template={template} draft={draft} />
    </>
  );
};

describe('TemplateEditor', () => {
  it('renders subject and HTML body fields', () => {
    render(<Harness template={makeTemplate()} />);

    expect(screen.getByLabelText('Subject Line')).toHaveValue('Welcome to {{organization_name}}');
    expect(screen.getByLabelText('HTML Body')).toHaveValue('<p>Hello {{first_name}}</p>');
  });

  it('does not draw its own save button', () => {
    // Save moved to the sticky page header: with the editor and the preview
    // side by side it scrolled out of sight while the fields it saves stayed
    // on screen. Two save buttons would be worse than the scroll.
    render(<TemplateEditor template={makeTemplate()} draft={makeDraft()} />);

    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /discard/i })).not.toBeInTheDocument();
  });

  it('shows save button disabled when no changes', () => {
    render(<Harness template={makeTemplate()} />);

    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('enables save button after editing', async () => {
    const user = userEvent.setup();
    render(<Harness template={makeTemplate()} />);

    const subjectInput = screen.getByLabelText('Subject Line');
    await user.clear(subjectInput);
    await user.type(subjectInput, 'New Subject');

    expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled();
  });

  it('builds an update containing only the changed fields', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<Harness template={makeTemplate()} onSave={onSave} />);

    const subjectInput = screen.getByLabelText('Subject Line');
    await user.clear(subjectInput);
    await user.type(subjectInput, 'New Subject');

    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith({ subject: 'New Subject' });
  });

  it('shows available variables panel', async () => {
    const user = userEvent.setup();
    render(<Harness template={makeTemplate()} />);

    await user.click(screen.getByText(/available variables/i));

    expect(screen.getByText('{{first_name}}')).toBeInTheDocument();
    expect(screen.getByText('{{organization_name}}')).toBeInTheDocument();
  });

  it('shows loading state when saving', () => {
    render(<Harness template={makeTemplate()} isSaving={true} />);

    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('shows collapsible plain-text body', async () => {
    const user = userEvent.setup();
    render(<Harness template={makeTemplate()} />);

    expect(screen.queryByLabelText(/plain-text/i)).not.toBeInTheDocument();

    await user.click(screen.getByText(/plain-text body/i));

    expect(screen.getByPlaceholderText(/plain text version/i)).toHaveValue('Hello {{first_name}}');
  });

  it('shows collapsible CSS styles', async () => {
    const user = userEvent.setup();
    render(<Harness template={makeTemplate()} />);

    await user.click(screen.getByText(/css styles/i));

    expect(screen.getByPlaceholderText(/\.container/i)).toHaveValue('body { color: #333; }');
  });

  describe('colourway controls', () => {
    it('offers every accent the API accepts', () => {
      render(<Harness template={makeTemplate()} />);

      for (const colourway of COLOURWAYS) {
        expect(screen.getByRole('button', { name: colourway.label })).toBeInTheDocument();
      }
    });

    it("marks the template's current accent as selected", () => {
      render(<Harness template={makeTemplate({ header_accent: '#4338ca' })} />);

      const elections = screen.getByRole('button', { name: 'Elections' });
      expect(elections).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Shifts' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('sends only the accent when nothing else changed', async () => {
      const user = userEvent.setup();
      const onSave = vi.fn();
      render(<Harness template={makeTemplate({ header_accent: '#b91c1c' })} onSave={onSave} />);

      await user.click(screen.getByRole('button', { name: 'Elections' }));
      await user.click(screen.getByRole('button', { name: /save/i }));

      expect(onSave).toHaveBeenCalledWith({ header_accent: '#4338ca' });
    });

    it('offers every layout, defaulting to notice', () => {
      render(<Harness template={makeTemplate()} />);

      for (const layout of EMAIL_LAYOUTS) {
        expect(screen.getByRole('button', { name: layout.label })).toBeInTheDocument();
      }
      // A row written before these columns existed has no layout; the shell
      // renders it as a notice, so the control has to say so rather than
      // showing nothing selected.
      expect(screen.getByRole('button', { name: 'Notice' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('previews the chip as it will actually render', async () => {
      const user = userEvent.setup();
      render(<Harness template={makeTemplate({ header_accent: '#047857' })} />);

      // Empty is a real state — the header then carries no chip at all.
      expect(screen.getByText('No chip')).toBeInTheDocument();

      await user.type(screen.getByLabelText('Status chip'), 'Assignment');

      expect(screen.getByText('Assignment')).toBeInTheDocument();
    });
  });

  describe('block palette', () => {
    it('offers every block', () => {
      render(<Harness template={makeTemplate()} />);

      for (const block of EMAIL_BLOCKS) {
        expect(screen.getByRole('button', { name: block.label })).toBeInTheDocument();
      }
    });

    it('inserts a block at the cursor rather than appending', async () => {
      const user = userEvent.setup();
      render(<Harness template={makeTemplate({ html_body: '<p>A</p><p>B</p>' })} />);

      const body = screen.getByLabelText<HTMLTextAreaElement>('HTML Body');
      // Between the two paragraphs.
      body.focus();
      body.setSelectionRange(8, 8);

      await user.click(screen.getByRole('button', { name: 'Section heading' }));

      expect(body).toHaveValue('<p>A</p><h2>Section heading</h2><p>B</p>');
    });

    it('replaces the selection when there is one', async () => {
      const user = userEvent.setup();
      render(<Harness template={makeTemplate({ html_body: '<p>OLD</p>' })} />);

      const body = screen.getByLabelText<HTMLTextAreaElement>('HTML Body');
      body.focus();
      body.setSelectionRange(0, body.value.length);

      await user.click(screen.getByRole('button', { name: 'Paragraph' }));

      expect(body).toHaveValue('<p>Write the sentence a member needs to read here.</p>');
    });

    it('makes the body dirty, so the change is saveable', async () => {
      const user = userEvent.setup();
      render(<Harness template={makeTemplate()} />);

      expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
      await user.click(screen.getByRole('button', { name: 'Alert' }));
      expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled();
    });
  });
});

/** A draft object for the one test that renders the editor without a page. */
function makeDraft() {
  const noop = () => undefined;
  return {
    subject: '',
    setSubject: noop,
    htmlBody: '',
    setHtmlBody: noop,
    textBody: '',
    setTextBody: noop,
    cssStyles: '',
    setCssStyles: noop,
    footerKey: '',
    setFooterKey: noop,
    defaultCc: '',
    setDefaultCc: noop,
    defaultBcc: '',
    setDefaultBcc: noop,
    headerAccent: '',
    setHeaderAccent: noop,
    statusChip: '',
    setStatusChip: noop,
    layout: '',
    setLayout: noop,
    ccError: null,
    bccError: null,
    hasValidationErrors: false,
    isDirty: false,
    buildUpdate: () => ({}),
    discard: noop,
  };
}
