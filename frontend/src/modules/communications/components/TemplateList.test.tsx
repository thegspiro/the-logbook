import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TemplateList } from './TemplateList';
import type { EmailTemplate } from '../types';

const makeTemplate = (overrides: Partial<EmailTemplate> = {}): EmailTemplate => ({
  id: 'tmpl-1',
  organization_id: 'org-1',
  template_type: 'welcome',
  name: 'Welcome Email',
  description: 'Sent to new members',
  subject: 'Welcome',
  html_body: '<p>Hello</p>',
  allow_attachments: false,
  is_active: true,
  available_variables: [],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  attachments: [],
  ...overrides,
});

describe('TemplateList', () => {
  it('renders template items', () => {
    const templates = [
      makeTemplate({ id: '1', name: 'My Welcome Template', template_type: 'welcome' }),
      makeTemplate({ id: '2', name: 'My Reset Template', template_type: 'password_reset' }),
    ];

    render(<TemplateList templates={templates} selectedId={null} onSelect={vi.fn()} />);

    expect(screen.getByText('My Welcome Template')).toBeInTheDocument();
    expect(screen.getByText('My Reset Template')).toBeInTheDocument();
    // Type labels also rendered
    expect(screen.getByText('Welcome Email')).toBeInTheDocument();
    expect(screen.getByText('Password Reset')).toBeInTheDocument();
  });

  it('highlights selected template', () => {
    const templates = [
      makeTemplate({ id: '1', name: 'Our Welcome Note' }),
      makeTemplate({ id: '2', name: 'Our Reset Note', template_type: 'password_reset' }),
    ];

    render(<TemplateList templates={templates} selectedId="1" onSelect={vi.fn()} />);

    // The selected template's button carries the orange highlight class
    const selected = screen.getByRole('button', { name: /Our Welcome Note/ });
    expect(selected).toHaveClass('bg-orange-500/10');
  });

  it('groups templates under category headers', () => {
    const templates = [
      makeTemplate({ id: '1', name: 'Welcome', template_type: 'welcome' }),
      makeTemplate({ id: '2', name: 'Reminder', template_type: 'event_reminder' }),
      makeTemplate({ id: '3', name: 'Ballot', template_type: 'ballot_notification' }),
    ];

    render(<TemplateList templates={templates} selectedId={null} onSelect={vi.fn()} />);

    expect(screen.getByText('Members & Accounts')).toBeInTheDocument();
    expect(screen.getByText('Events & Scheduling')).toBeInTheDocument();
    expect(screen.getByText('Elections & Voting')).toBeInTheDocument();
  });

  it('files an unrecognised template type under Other', () => {
    const templates = [makeTemplate({ id: '1', name: 'Ad-hoc Notice', template_type: 'custom' })];

    render(<TemplateList templates={templates} selectedId={null} onSelect={vi.fn()} />);

    expect(screen.getByText('Other')).toBeInTheDocument();
    expect(screen.getByText('Ad-hoc Notice')).toBeInTheDocument();
  });

  it('collapses and re-expands a category', async () => {
    const user = userEvent.setup();
    const templates = [makeTemplate({ id: '1', name: 'Welcome', template_type: 'welcome' })];

    render(<TemplateList templates={templates} selectedId={null} onSelect={vi.fn()} />);

    const header = screen.getByText('Members & Accounts');
    await user.click(header);
    expect(screen.queryByText('Welcome')).not.toBeInTheDocument();

    await user.click(header);
    expect(screen.getByText('Welcome')).toBeInTheDocument();
  });

  it('keeps the selected template visible by expanding its category', async () => {
    const user = userEvent.setup();
    const templates = [makeTemplate({ id: '1', name: 'Welcome', template_type: 'welcome' })];

    const { rerender } = render(<TemplateList templates={templates} selectedId={null} onSelect={vi.fn()} />);

    await user.click(screen.getByText('Members & Accounts'));
    expect(screen.queryByText('Welcome')).not.toBeInTheDocument();

    rerender(<TemplateList templates={templates} selectedId="1" onSelect={vi.fn()} />);
    expect(screen.getByText('Welcome')).toBeInTheDocument();
  });

  it('calls onSelect when clicking a template', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const templates = [makeTemplate({ id: '1', name: 'My Custom Welcome' })];

    render(<TemplateList templates={templates} selectedId={null} onSelect={onSelect} />);

    await user.click(screen.getByText('My Custom Welcome'));
    expect(onSelect).toHaveBeenCalledWith(templates[0]);
  });

  it('shows empty state when no templates', () => {
    render(<TemplateList templates={[]} selectedId={null} onSelect={vi.fn()} />);

    expect(screen.getByText('No templates found')).toBeInTheDocument();
  });

  it('shows active/inactive status icons', () => {
    const templates = [
      makeTemplate({ id: '1', name: 'Active Template', is_active: true }),
      makeTemplate({ id: '2', name: 'Inactive Template', is_active: false }),
    ];

    render(<TemplateList templates={templates} selectedId={null} onSelect={vi.fn()} />);

    // Both templates should render with status indicators
    expect(screen.getByTitle('Active')).toBeInTheDocument();
    expect(screen.getByTitle('Inactive')).toBeInTheDocument();
  });

  it('displays template type labels', () => {
    const templates = [makeTemplate({ id: '1', name: 'My Event Notification', template_type: 'event_reminder' })];

    render(<TemplateList templates={templates} selectedId={null} onSelect={vi.fn()} />);

    // Name and type label rendered separately
    expect(screen.getByText('My Event Notification')).toBeInTheDocument();
    expect(screen.getByText('Event Reminder')).toBeInTheDocument();
  });
});
