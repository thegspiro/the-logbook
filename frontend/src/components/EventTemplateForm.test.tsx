import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EventTemplateForm } from './EventTemplateForm';

describe('EventTemplateForm reminder audience', () => {
  it('persists the selected reminder audience in the template', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<EventTemplateForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/template name/i), 'Department meeting');
    await user.click(screen.getByRole('button', { name: 'Reminders' }));
    await user.click(screen.getByLabelText('Send reminders'));
    await user.selectOptions(screen.getByLabelText(/who should receive reminders/i), 'all');
    await user.click(screen.getByRole('button', { name: 'Save Template' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        send_reminders: true,
        reminder_target: 'all',
      })
    );
  });

  it('preserves intentional zero-minute check-in windows', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<EventTemplateForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/template name/i), 'Starts on time');
    await user.click(screen.getByRole('button', { name: /check-in settings/i }));
    await user.selectOptions(screen.getByLabelText(/check-in window type/i), 'window');
    await user.type(screen.getByLabelText(/minutes before start/i), '0');
    await user.type(screen.getByLabelText(/minutes after start/i), '0');
    await user.click(screen.getByRole('button', { name: 'Save Template' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        check_in_minutes_before: 0,
        check_in_minutes_after: 0,
      })
    );
  });

  it('defaults mandatory templates to all-member reminders', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<EventTemplateForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/template name/i), 'Mandatory meeting');
    await user.click(screen.getByRole('button', { name: /rsvp & attendance/i }));
    await user.click(screen.getByLabelText(/mandatory attendance/i));
    await user.click(screen.getByRole('button', { name: /reminders/i }));
    await user.click(screen.getByRole('button', { name: 'Save Template' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        is_mandatory: true,
        send_reminders: true,
        reminder_target: 'all',
      })
    );
  });

  it('does not re-enable reminders when they were explicitly disabled', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <EventTemplateForm
        initialData={{
          id: 'template-1',
          organization_id: 'org-1',
          name: 'No reminders',
          event_type: 'business_meeting',
          requires_rsvp: false,
          is_mandatory: false,
          allow_guests: false,
          require_checkout: false,
          send_reminders: true,
          reminder_target: 'going',
          reminder_schedule: [24],
          is_active: true,
          created_at: '2026-08-14T00:00:00Z',
          updated_at: '2026-08-14T00:00:00Z',
        }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    );

    await user.click(screen.getByLabelText(/send reminders/i));
    await user.click(screen.getByRole('button', { name: /rsvp & attendance/i }));
    await user.click(screen.getByLabelText(/mandatory attendance/i));
    await user.click(screen.getByRole('button', { name: 'Save Template' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        is_mandatory: true,
        send_reminders: false,
        reminder_target: 'none',
      })
    );
  });
});
