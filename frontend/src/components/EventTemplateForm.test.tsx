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
});
