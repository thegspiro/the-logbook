/**
 * W21-5: the template action that calls DELETE only deactivates the template
 * (the backend soft-deletes), so it is labelled Deactivate and its dialog no
 * longer claims the action cannot be undone.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetTemplates = vi.fn();
const mockDeleteTemplate = vi.fn();

vi.mock('../services/api', () => ({
  eventService: {
    getTemplates: (...a: unknown[]) => mockGetTemplates(...a) as unknown,
    deleteTemplate: (...a: unknown[]) => mockDeleteTemplate(...a) as unknown,
    updateTemplate: vi.fn(),
    createTemplate: vi.fn(),
  },
}));

import EventTemplatesPage from './EventTemplatesPage';
import { renderWithRouter } from '../test/utils';

const base = {
  organization_id: 'org-1',
  event_type: 'training',
  requires_rsvp: false,
  is_mandatory: false,
  allow_guests: false,
  require_checkout: false,
  send_reminders: false,
  reminder_target: 'none',
  reminder_schedule: [],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const active = { ...base, id: 't-1', name: 'Monthly Drill', is_active: true };
const inactive = { ...base, id: 't-2', name: 'Old Format', is_active: false };

describe('EventTemplatesPage deactivate action (W21-5)', () => {
  beforeEach(() => {
    mockGetTemplates.mockReset();
    mockGetTemplates.mockResolvedValue([active, inactive]);
    mockDeleteTemplate.mockReset();
    mockDeleteTemplate.mockResolvedValue(undefined);
  });

  it('labels the action Deactivate and does not say it cannot be undone', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EventTemplatesPage />);

    await user.click(await screen.findByRole('button', { name: 'Deactivate Monthly Drill…' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Deactivate Template')).toBeInTheDocument();
    expect(within(dialog).getByText(/reactivate it at any time/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/undo/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Delete/ })).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    expect(mockDeleteTemplate).toHaveBeenCalledWith('t-1');
  });

  it('is not offered on a template that is already inactive', async () => {
    renderWithRouter(<EventTemplatesPage />);

    expect(await screen.findByText('Old Format')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate Old Format…' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activate Old Format' })).toBeInTheDocument();
  });
});
