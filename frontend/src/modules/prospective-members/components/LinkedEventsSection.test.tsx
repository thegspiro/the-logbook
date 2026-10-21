import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Applicant, ProspectEventLink } from '../types';

const mockGetLinkedEvents = vi.fn();
const mockUnlinkEvent = vi.fn();

vi.mock('../services/api', () => ({
  eventLinkService: {
    getLinkedEvents: (...args: unknown[]) => mockGetLinkedEvents(...args) as unknown,
    linkEvent: vi.fn(),
    unlinkEvent: (...args: unknown[]) => mockUnlinkEvent(...args) as unknown,
  },
}));

vi.mock('../../../services/eventServices', () => ({ eventService: { getEvents: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import LinkedEventsSection from './LinkedEventsSection';
import { ConfirmProvider } from '../../../contexts/ConfirmContext';

const applicant = { id: 'app-1', status: 'active' } as Applicant;

const link: ProspectEventLink = {
  id: 'link-1',
  prospect_id: 'app-1',
  event_id: 'ev-1',
  event_title: 'Open House',
  event_type: 'public_education',
  event_start: '2026-11-01T18:00:00Z',
  is_cancelled: false,
  created_at: '2026-10-01T00:00:00Z',
};

const renderSection = () =>
  render(
    <ConfirmProvider>
      <LinkedEventsSection applicant={applicant} tz="UTC" />
    </ConfirmProvider>
  );

// Unlinking was a single unconfirmed tap on a trash icon.
describe('LinkedEventsSection unlinking an event', () => {
  beforeEach(() => {
    mockGetLinkedEvents.mockReset();
    mockGetLinkedEvents.mockResolvedValue([link]);
    mockUnlinkEvent.mockReset();
    mockUnlinkEvent.mockResolvedValue(undefined);
  });

  it('asks first, naming the event and what is not changed', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(await screen.findByTitle('Unlink event'));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Open House will no longer be listed on this applicant’s record.');
    expect(dialog).toHaveTextContent('The event itself, and any attendance recorded at it, are not changed.');
    expect(mockUnlinkEvent).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Unlink event' }));

    await waitFor(() => expect(mockUnlinkEvent).toHaveBeenCalledWith('app-1', 'link-1'));
    await waitFor(() => expect(screen.queryByText('Open House')).toBeNull());
  });

  it('does nothing when the coordinator keeps the link', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(await screen.findByTitle('Unlink event'));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Keep it' }));

    expect(mockUnlinkEvent).not.toHaveBeenCalled();
    expect(screen.getByText('Open House')).toBeInTheDocument();
  });
});
