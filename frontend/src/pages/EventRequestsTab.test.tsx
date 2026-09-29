import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const listRequests = vi.fn();
const getRequest = vi.fn();

vi.mock('../services/api', () => ({
  eventRequestService: {
    listRequests: (...args: unknown[]) => listRequests(...args) as unknown,
    getRequest: (...args: unknown[]) => getRequest(...args) as unknown,
    getOutreachTypeLabels: () => Promise.resolve({}),
    listEmailTemplates: () => Promise.resolve([]),
    getOutreachRoles: () => Promise.resolve([]),
    getStaffing: () => Promise.resolve(null),
  },
  eventService: {
    getModuleSettings: () =>
      Promise.resolve({
        request_pipeline: {
          tasks: [
            { id: 'review', label: 'Review Request', description: '' },
            { id: 'confirm', label: 'Confirm Date', description: '' },
          ],
        },
      }),
  },
  userService: {
    getUsers: () => Promise.resolve([{ id: 'u2', first_name: 'Sam', last_name: 'Ortiz', rank: 'fire_chief' }]),
  },
  locationsService: { getLocations: () => Promise.resolve([]) },
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));
vi.mock('../hooks/useRanks', () => ({
  useRanks: () => ({
    formatRank: (code: string | null | undefined) => (code === 'fire_chief' ? 'Fire Chief' : (code ?? '')),
  }),
}));

import EventRequestsTab from './EventRequestsTab';

const request = {
  id: 'req-1',
  contact_name: 'Pat Requester',
  contact_email: 'pat@example.com',
  outreach_type: 'station_tour',
  status: 'in_progress',
  description: 'A tour for a scout troop.',
  task_completions: { review: { completed: true, completed_by: 'u1', completed_at: '2026-09-29T00:00:00Z' } },
  created_at: '2026-09-28T00:00:00Z',
};

describe('EventRequestsTab pipeline tasks', () => {
  beforeEach(() => {
    listRequests.mockReset();
    getRequest.mockReset();
    listRequests.mockResolvedValue([request]);
    getRequest.mockResolvedValue({ ...request, activity_log: [] });
  });

  it('says which tasks are done, not only with an icon', async () => {
    const user = userEvent.setup();
    render(<EventRequestsTab />);

    await user.click(await screen.findByRole('button', { name: /Pat Requester/ }));

    expect(await screen.findByRole('button', { name: /Review Request/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Confirm Date/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('names a coordinator by their rank, not its code', async () => {
    const user = userEvent.setup();
    render(<EventRequestsTab />);

    await user.click(await screen.findByRole('button', { name: /Pat Requester/ }));
    await user.click(await screen.findByRole('button', { name: 'Assign' }));

    expect(screen.getByRole('option', { name: 'Sam Ortiz — Fire Chief' })).toBeInTheDocument();
  });
});
