import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const signupForShift = vi.fn();

vi.mock('../../modules/scheduling/services/api', () => ({
  schedulingService: {
    signupForShift: (...args: unknown[]) => signupForShift(...args) as unknown,
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { renderWithRouter } from '../../test/utils';
import EventVolunteerSignupCard from './EventVolunteerSignupCard';
import type { EventVolunteerSignup } from '../../types/event';

const sheet = (overrides: Partial<EventVolunteerSignup> = {}): EventVolunteerSignup => ({
  shift_id: 'shift-7',
  roles: [
    { role: 'tour_guide', label: 'Tour Guide', total: 2, filled: 0, remaining: 2 },
    { role: 'educator', label: 'Educator', total: 1, filled: 0, remaining: 1 },
  ],
  signed_up: false,
  my_role_label: null,
  ...overrides,
});

describe('EventVolunteerSignupCard', () => {
  beforeEach(() => {
    signupForShift.mockReset();
    signupForShift.mockResolvedValue({});
  });

  it('lets a member choose a role and sign up from the event page', async () => {
    const onSignedUp = vi.fn();
    const user = userEvent.setup();
    renderWithRouter(<EventVolunteerSignupCard signup={sheet()} isPast={false} onSignedUp={onSignedUp} />);

    expect(screen.getByText('0 of 2 — 2 still needed')).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'What would you like to do?' }), 'educator');
    await user.click(screen.getByRole('button', { name: 'Sign me up' }));

    await waitFor(() => expect(onSignedUp).toHaveBeenCalledTimes(1));
    expect(signupForShift).toHaveBeenCalledWith('shift-7', { outreach_role: 'educator' });
  });

  it('says what the member signed up as instead of offering it again', () => {
    renderWithRouter(
      <EventVolunteerSignupCard
        signup={sheet({ signed_up: true, my_role_label: 'Tour Guide' })}
        isPast={false}
        onSignedUp={vi.fn()}
      />
    );

    expect(screen.getByText(/You are signed up as Tour Guide/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My Shifts' })).toHaveAttribute('href', '/scheduling?tab=my-shifts');
    expect(screen.queryByRole('button', { name: /Sign me up/ })).not.toBeInTheDocument();
  });

  it('offers no signup once the event is over', () => {
    renderWithRouter(<EventVolunteerSignupCard signup={sheet()} isPast onSignedUp={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Sign me up/ })).not.toBeInTheDocument();
  });

  it('says so when every role is filled', () => {
    renderWithRouter(
      <EventVolunteerSignupCard
        signup={sheet({
          roles: [{ role: 'tour_guide', label: 'Tour Guide', total: 2, filled: 2, remaining: 0 }],
        })}
        isPast={false}
        onSignedUp={vi.fn()}
      />
    );
    expect(screen.getByText('Every role on this sheet is filled.')).toBeInTheDocument();
  });
});
