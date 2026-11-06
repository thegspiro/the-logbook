/**
 * Owner decision 2026-11-01: administrators can see which members have opted
 * out of which emails. The screen reports the backend's answer — who is not
 * emailed a kind — and never re-derives it (CLAUDE.md pitfall #29).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import MemberEmailOptOutsPage from './MemberEmailOptOutsPage';
import type { MemberEmailOptOut, MemberEmailOptOutPage, MemberEmailPolicy } from '../../../services/api';

const mockGetPolicy = vi.fn();
const mockGetOptOuts = vi.fn();

vi.mock('../../../services/api', () => ({
  emailTemplatesService: {
    getMemberEmailPolicy: (...args: unknown[]) => mockGetPolicy(...args) as unknown,
    getMemberEmailOptOuts: (...args: unknown[]) => mockGetOptOuts(...args) as unknown,
  },
}));

const kind = (key: string, label: string, required = false) => ({
  key,
  label,
  required,
  default_on: true,
  audience: 'members' as const,
  includes: [],
  rationale: '',
  legacy_preference: null,
  department_required: false,
});

const policy: MemberEmailPolicy = {
  emails: [
    kind('election_ballots', 'Election ballots', true),
    kind('shift_notices', 'Shift notices'),
    kind('volunteer_calls', 'Volunteer calls'),
  ],
  texts: [],
  text_conditions: [],
  can_edit: true,
};

const baker: MemberEmailOptOut = {
  user_id: 'u1',
  name: 'Jo Baker',
  membership_number: '104',
  email_notifications_off: true,
  turned_off: [],
};
const clark: MemberEmailOptOut = {
  user_id: 'u2',
  name: 'Sam Clark',
  membership_number: null,
  email_notifications_off: false,
  turned_off: ['shift_notices', 'volunteer_calls'],
};

const everyone: MemberEmailOptOutPage = {
  members: [baker, clark],
  total: 2,
  skip: 0,
  limit: 50,
  members_considered: 12,
  not_emailed: { shift_notices: 2, volunteer_calls: 1 },
  department_required: [],
};

describe('MemberEmailOptOutsPage', () => {
  beforeEach(() => {
    mockGetPolicy.mockReset();
    mockGetPolicy.mockResolvedValue(policy);
    mockGetOptOuts.mockReset();
    mockGetOptOuts.mockResolvedValue(everyone);
  });

  it('lists each member with their master switch and the emails they turned off, by label', async () => {
    renderWithRouter(<MemberEmailOptOutsPage />);

    const bakerRow = await screen.findByRole('row', { name: /Jo Baker/ });
    expect(within(bakerRow).getByText(/Off — optional emails stopped/)).toBeInTheDocument();
    expect(within(bakerRow).getByText('#104')).toBeInTheDocument();

    const clarkRow = screen.getByRole('row', { name: /Sam Clark/ });
    expect(within(clarkRow).getByText('On')).toBeInTheDocument();
    expect(within(clarkRow).getByText('Shift notices')).toBeInTheDocument();
    expect(within(clarkRow).getByText('Volunteer calls')).toBeInTheDocument();

    expect(screen.getByText('2 of 12 current members')).toBeInTheDocument();
    expect(mockGetOptOuts).toHaveBeenCalledWith({ kind: undefined, skip: 0, limit: 50 });
  });

  it('offers only optional emails as filters, with the backend counts', async () => {
    renderWithRouter(<MemberEmailOptOutsPage />);

    const select = await screen.findByLabelText('Show');
    const options = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual([
      'Everyone who turned anything off',
      'Not emailed: Shift notices (2)',
      'Not emailed: Volunteer calls (1)',
    ]);
  });

  it('asks the backend for one kind when filtered, from the first page', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MemberEmailOptOutsPage />);
    const select = await screen.findByLabelText('Show');

    mockGetOptOuts.mockResolvedValue({ ...everyone, members: [clark], total: 1 });
    await user.selectOptions(select, 'volunteer_calls');

    expect(mockGetOptOuts).toHaveBeenLastCalledWith({ kind: 'volunteer_calls', skip: 0, limit: 50 });
    expect(await screen.findByText('1 of 12 current members')).toBeInTheDocument();
    expect(screen.queryByText('Jo Baker')).not.toBeInTheDocument();
  });

  it('says so when the department requires the filtered email for everyone', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MemberEmailOptOutsPage />);
    const select = await screen.findByLabelText('Show');

    mockGetOptOuts.mockResolvedValue({
      ...everyone,
      members: [],
      total: 0,
      department_required: ['shift_notices'],
    });
    await user.selectOptions(select, 'shift_notices');

    expect(await screen.findByText(/requires Shift notices for every member/)).toBeInTheDocument();
    expect(screen.getByText('Everyone receives Shift notices')).toBeInTheDocument();
  });

  it('marks an opt-out the department overrides as still sent', async () => {
    mockGetOptOuts.mockResolvedValue({ ...everyone, department_required: ['shift_notices'] });
    renderWithRouter(<MemberEmailOptOutsPage />);

    const clarkRow = await screen.findByRole('row', { name: /Sam Clark/ });
    expect(within(clarkRow).getByText('Shift notices (required — still sent)')).toBeInTheDocument();
  });

  it('pages through the backend rather than slicing locally', async () => {
    const user = userEvent.setup();
    mockGetOptOuts.mockResolvedValue({ ...everyone, total: 120 });
    renderWithRouter(<MemberEmailOptOutsPage />);
    await screen.findByText('Jo Baker');

    await user.click(screen.getByRole('button', { name: 'Next page' }));

    expect(mockGetOptOuts).toHaveBeenLastCalledWith({ kind: undefined, skip: 50, limit: 50 });
  });

  it('shows an error instead of an empty list when loading fails', async () => {
    mockGetOptOuts.mockRejectedValue(new Error('Forbidden'));
    renderWithRouter(<MemberEmailOptOutsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Forbidden');
    expect(screen.queryByText('No member has turned off an email')).not.toBeInTheDocument();
  });
});
