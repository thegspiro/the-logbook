import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TemplateEditor } from './TemplateEditor';
import type { EmailTemplate } from '../types';

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

describe('TemplateEditor', () => {
  it('renders subject and HTML body fields', () => {
    const template = makeTemplate();
    render(<TemplateEditor template={template} isSaving={false} onSave={vi.fn()} />);

    expect(screen.getByLabelText('Subject Line')).toHaveValue(
      'Welcome to {{organization_name}}',
    );
    expect(screen.getByLabelText('HTML Body')).toHaveValue(
      '<p>Hello {{first_name}}</p>',
    );
  });

  it('shows save button disabled when no changes', () => {
    const template = makeTemplate();
    render(<TemplateEditor template={template} isSaving={false} onSave={vi.fn()} />);

    const saveButton = screen.getByRole('button', { name: /save/i });
    expect(saveButton).toBeDisabled();
  });

  it('enables save button after editing', async () => {
    const user = userEvent.setup();
    const template = makeTemplate();
    render(<TemplateEditor template={template} isSaving={false} onSave={vi.fn()} />);

    const subjectInput = screen.getByLabelText('Subject Line');
    await user.clear(subjectInput);
    await user.type(subjectInput, 'New Subject');

    const saveButton = screen.getByRole('button', { name: /save/i });
    expect(saveButton).not.toBeDisabled();
  });

  it('calls onSave with changed fields', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const template = makeTemplate();
    render(<TemplateEditor template={template} isSaving={false} onSave={onSave} />);

    const subjectInput = screen.getByLabelText('Subject Line');
    await user.clear(subjectInput);
    await user.type(subjectInput, 'New Subject');

    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith({ subject: 'New Subject' });
  });

  it('shows available variables panel', async () => {
    const user = userEvent.setup();
    const template = makeTemplate();
    render(<TemplateEditor template={template} isSaving={false} onSave={vi.fn()} />);

    // Open the variables panel
    await user.click(screen.getByText(/available variables/i));

    expect(screen.getByText('{{first_name}}')).toBeInTheDocument();
    expect(screen.getByText('{{organization_name}}')).toBeInTheDocument();
  });

  it('shows loading state when saving', () => {
    const template = makeTemplate();
    render(<TemplateEditor template={template} isSaving={true} onSave={vi.fn()} />);

    const saveButton = screen.getByRole('button', { name: /save/i });
    expect(saveButton).toBeDisabled();
  });

  it('shows collapsible plain-text body', async () => {
    const user = userEvent.setup();
    const template = makeTemplate();
    render(<TemplateEditor template={template} isSaving={false} onSave={vi.fn()} />);

    // Initially the text body field should not be visible
    expect(screen.queryByLabelText(/plain-text/i)).not.toBeInTheDocument();

    // Click to expand
    await user.click(screen.getByText(/plain-text body/i));

    // Now the textarea should be visible with the value
    const textarea = screen.getByPlaceholderText(/plain text version/i);
    expect(textarea).toHaveValue('Hello {{first_name}}');
  });

  it('shows collapsible CSS styles', async () => {
    const user = userEvent.setup();
    const template = makeTemplate();
    render(<TemplateEditor template={template} isSaving={false} onSave={vi.fn()} />);

    // Click to expand CSS
    await user.click(screen.getByText(/css styles/i));

    const textarea = screen.getByPlaceholderText(/\.container/i);
    expect(textarea).toHaveValue('body { color: #333; }');
  });
});
