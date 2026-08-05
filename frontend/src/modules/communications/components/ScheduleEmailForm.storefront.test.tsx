import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

vi.mock('../store/scheduledEmailsStore', () => ({
  useScheduledEmailsStore: () => ({
    scheduleEmail: vi.fn(),
    isSaving: false,
    error: null,
  }),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import ScheduleEmailForm from './ScheduleEmailForm';
import type { EmailTemplate } from '../types';

const makeTemplate = (overrides: Partial<EmailTemplate> = {}): EmailTemplate => ({
  id: 'tmpl-1',
  organization_id: 'org-1',
  template_type: 'welcome',
  name: 'Welcome Email',
  description: '',
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

/**
 * A storefront notice reads entirely from an order that does not exist when
 * it is scheduled by hand — the member would get "Order  received" over an
 * empty table. The store raises these itself; they are editable, not
 * schedulable.
 */
describe('ScheduleEmailForm template types', () => {
  it('does not offer storefront notices for scheduling', () => {
    const templates = [
      makeTemplate({ id: '1', template_type: 'welcome' }),
      makeTemplate({ id: '2', template_type: 'event_reminder' }),
      makeTemplate({ id: '3', template_type: 'storefront_order_confirmation' }),
      makeTemplate({ id: '4', template_type: 'storefront_window_open' }),
    ];

    render(<ScheduleEmailForm templates={templates} onClose={vi.fn()} />);

    const picker = screen.getByRole('combobox', { name: /template/i });
    const options = within(picker)
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value);

    expect(options).toContain('welcome');
    expect(options).toContain('event_reminder');
    expect(options.filter((value) => value.startsWith('storefront_'))).toEqual([]);
  });
});
