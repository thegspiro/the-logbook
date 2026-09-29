import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import { EventRSVPSection } from './EventRSVPSection';
import type { RSVPHistory } from '../../types/event';

const entry = (overrides: Partial<RSVPHistory>): RSVPHistory => ({
  id: 'h1',
  rsvp_id: 'r1',
  event_id: 'e1',
  user_id: 'u1',
  old_status: null,
  new_status: 'going',
  changed_at: '2026-09-28T23:48:00Z',
  changed_by: null,
  user_name: 'Jordan Avery',
  changer_name: null,
  ...overrides,
});

const renderSection = (rsvpHistory: RSVPHistory[]) =>
  renderWithRouter(
    <EventRSVPSection
      rsvps={[]}
      rsvpHistory={rsvpHistory}
      timezone="America/Chicago"
      removeConfirmUserId={null}
      onSetRemoveConfirmUserId={vi.fn()}
      onCheckIn={vi.fn()}
      onOpenOverrideModal={vi.fn()}
      onRemoveAttendee={vi.fn()}
      onPrintRoster={vi.fn()}
      onExportCSV={vi.fn()}
    />
  );

describe('EventRSVPSection RSVP activity', () => {
  // The feed printed the stored values: "changed from going to not_going",
  // "RSVP'd as waitlisted" (workflow review W19).
  it('names each status the way the rest of the page does', async () => {
    const user = userEvent.setup();
    renderSection([
      entry({ id: 'h2', old_status: 'going', new_status: 'not_going' }),
      entry({ id: 'h1', user_name: 'Alex Brooks', new_status: 'waitlisted' }),
    ]);

    await user.click(screen.getByRole('button', { name: /RSVP Activity/ }));

    expect(screen.getByText('Not Going')).toBeInTheDocument();
    expect(screen.getByText('Waitlisted')).toBeInTheDocument();
    expect(screen.queryByText('not_going')).not.toBeInTheDocument();
    expect(screen.queryByText('waitlisted')).not.toBeInTheDocument();
  });

  it('shows an unrecognised stored value as it is rather than dropping it', async () => {
    const user = userEvent.setup();
    renderSection([entry({ new_status: 'tentative' })]);

    await user.click(screen.getByRole('button', { name: /RSVP Activity/ }));

    expect(screen.getByText('tentative')).toBeInTheDocument();
  });
});
