import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
    // The subtitle is the state line now — the type label moved to the row's
    // title, which is the only thing left saying what a renamed template is.
    expect(screen.getByRole('button', { name: /My Welcome Template/ })).toHaveAttribute('title', 'Welcome Email');
    expect(screen.getByRole('button', { name: /My Reset Template/ })).toHaveAttribute('title', 'Password Reset');
  });

  it('highlights selected template', () => {
    const templates = [
      makeTemplate({ id: '1', name: 'Our Welcome Note' }),
      makeTemplate({ id: '2', name: 'Our Reset Note', template_type: 'password_reset' }),
    ];

    render(<TemplateList templates={templates} selectedId="1" onSelect={vi.fn()} />);

    // The selected template's button carries the primary highlight class
    const selected = screen.getByRole('button', { name: /Our Welcome Note/ });
    expect(selected).toHaveClass('bg-red-500/10');
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

  it('shows active/off status dots', () => {
    const templates = [
      makeTemplate({ id: '1', name: 'Active Template', is_active: true }),
      makeTemplate({ id: '2', name: 'Inactive Template', is_active: false }),
    ];

    render(<TemplateList templates={templates} selectedId={null} onSelect={vi.fn()} />);

    // Both templates should render with status indicators
    expect(screen.getByTitle('Active')).toBeInTheDocument();
    expect(screen.getByTitle('Off')).toBeInTheDocument();
  });

  it("displays each template's state and send count", () => {
    const templates = [
      makeTemplate({
        id: '1',
        name: 'My Event Notification',
        template_type: 'event_reminder',
        is_customized: true,
        sent_count: 210,
      }),
    ];

    render(<TemplateList templates={templates} selectedId={null} onSelect={vi.fn()} />);

    expect(screen.getByText('My Event Notification')).toBeInTheDocument();
    expect(screen.getByText('Edited · sent 210 times')).toBeInTheDocument();
  });

  it('says a notice has never been sent rather than showing a zero', () => {
    const templates = [makeTemplate({ id: '1', sent_count: 0 })];

    render(<TemplateList templates={templates} selectedId={null} onSelect={vi.fn()} />);

    expect(screen.getByText('Default · never sent')).toBeInTheDocument();
  });

  it('singularises a single send', () => {
    const templates = [makeTemplate({ id: '1', sent_count: 1 })];

    render(<TemplateList templates={templates} selectedId={null} onSelect={vi.fn()} />);

    expect(screen.getByText('Default · sent 1 time')).toBeInTheDocument();
  });

  it('says only Off for a switched-off notice', () => {
    // A notice nobody sends has no count worth reading, and the fact that it
    // is switched off is the whole answer.
    const templates = [makeTemplate({ id: '1', is_active: false, sent_count: 12 })];

    render(<TemplateList templates={templates} selectedId={null} onSelect={vi.fn()} />);

    // Scoped to the row: "Off" is also a filter chip.
    const row = screen.getByRole('button', { name: /Welcome Email/ });
    expect(within(row).getByText('Off')).toBeInTheDocument();
    expect(screen.queryByText(/sent 12/)).not.toBeInTheDocument();
  });

  describe('filter chips', () => {
    const mixed = () => [
      makeTemplate({ id: '1', name: 'Untouched', template_type: 'welcome', is_customized: false }),
      makeTemplate({ id: '2', name: 'Reworded', template_type: 'password_reset', is_customized: true }),
      makeTemplate({ id: '3', name: 'Switched off', template_type: 'event_reminder', is_active: false }),
    ];

    it('shows everything under All', () => {
      render(<TemplateList templates={mixed()} selectedId={null} onSelect={vi.fn()} />);

      expect(screen.getByText('Untouched')).toBeInTheDocument();
      expect(screen.getByText('Reworded')).toBeInTheDocument();
      expect(screen.getByText('Switched off')).toBeInTheDocument();
    });

    it('narrows to the notices a department has actually changed', async () => {
      // The question the sidebar could not answer without opening three
      // dozen templates in turn.
      const user = userEvent.setup();
      render(<TemplateList templates={mixed()} selectedId={null} onSelect={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: 'Edited' }));

      expect(screen.getByText('Reworded')).toBeInTheDocument();
      expect(screen.queryByText('Untouched')).not.toBeInTheDocument();
    });

    it('separates active from off', async () => {
      const user = userEvent.setup();
      render(<TemplateList templates={mixed()} selectedId={null} onSelect={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: 'Off' }));
      expect(screen.getByText('Switched off')).toBeInTheDocument();
      expect(screen.queryByText('Untouched')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Active' }));
      expect(screen.getByText('Untouched')).toBeInTheDocument();
      expect(screen.queryByText('Switched off')).not.toBeInTheDocument();
    });

    it('says so rather than rendering nothing when a filter matches none', async () => {
      const user = userEvent.setup();
      render(
        <TemplateList
          templates={[makeTemplate({ id: '1', name: 'Untouched', is_customized: false })]}
          selectedId={null}
          onSelect={vi.fn()}
        />
      );

      await user.click(screen.getByRole('button', { name: 'Edited' }));

      expect(screen.getByText('No templates found')).toBeInTheDocument();
    });
  });
});
