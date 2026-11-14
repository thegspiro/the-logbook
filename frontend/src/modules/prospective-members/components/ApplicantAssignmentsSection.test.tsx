/**
 * ApplicantAssignmentsSection — who is assigned to an applicant, and the
 * coordinator's controls to assign and unassign them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { Applicant, ProspectAssignment } from '../types';
import { ApplicantAccessContext, READ_ONLY_ACCESS } from './ApplicantAccessContext';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
  getUsers: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('../services/api', () => ({
  assignmentService: {
    list: (...a: unknown[]) => mocks.list(...a) as unknown,
    add: (...a: unknown[]) => mocks.add(...a) as unknown,
    remove: (...a: unknown[]) => mocks.remove(...a) as unknown,
  },
}));

vi.mock('../../../services/api', () => ({
  userService: { getUsers: (...a: unknown[]) => mocks.getUsers(...a) as unknown },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: (...a: unknown[]) => mocks.toastError(...a) as unknown },
}));

import ApplicantAssignmentsSection from './ApplicantAssignmentsSection';

const applicant = { id: 'app-1' } as Applicant;

const assignment = (overrides: Partial<ProspectAssignment> = {}): ProspectAssignment => ({
  id: 'asg-1',
  prospect_id: 'app-1',
  user_id: 'user-2',
  user_name: 'Dana Trustee',
  role: 'interviewer',
  ...overrides,
});

const members = [
  { id: 'user-2', username: 'dtrustee', first_name: 'Dana', last_name: 'Trustee', status: 'active' },
  { id: 'user-3', username: 'cchief', first_name: 'Casey', last_name: 'Chief', status: 'active' },
  { id: 'user-4', username: 'gone', first_name: 'Gone', last_name: 'Member', status: 'retired' },
];

describe('ApplicantAssignmentsSection', () => {
  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockReset();
    mocks.list.mockResolvedValue([assignment()]);
    mocks.getUsers.mockResolvedValue(members);
    mocks.remove.mockResolvedValue(undefined);
  });

  it('lists who is assigned and in what role', async () => {
    renderWithRouter(<ApplicantAssignmentsSection applicant={applicant} />);

    const [row] = await screen.findAllByRole('listitem');
    expect(within(row as HTMLElement).getByText('Dana Trustee')).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText('Interviewer')).toBeInTheDocument();
    expect(mocks.list).toHaveBeenCalledWith('app-1');
  });

  it('assigns a current member in the chosen role', async () => {
    mocks.add.mockResolvedValue(
      assignment({ id: 'asg-2', user_id: 'user-3', user_name: 'Casey Chief', role: 'case_manager' })
    );
    const user = userEvent.setup();
    renderWithRouter(<ApplicantAssignmentsSection applicant={applicant} />);
    await screen.findByText('Dana Trustee', { selector: 'li span' });

    await user.selectOptions(await screen.findByLabelText('Member'), 'user-3');
    await user.selectOptions(screen.getByLabelText('As'), 'case_manager');
    await user.click(screen.getByRole('button', { name: 'Assign' }));

    expect(mocks.add).toHaveBeenCalledWith('app-1', 'user-3', 'case_manager');
    expect(await screen.findByText('Casey Chief', { selector: 'li span' })).toBeInTheDocument();
  });

  it('offers only current members', async () => {
    renderWithRouter(<ApplicantAssignmentsSection applicant={applicant} />);

    const picker = await screen.findByLabelText('Member');
    await waitFor(() => expect(within(picker).getByRole('option', { name: 'Casey Chief' })).toBeInTheDocument());
    expect(within(picker).queryByRole('option', { name: 'Gone Member' })).not.toBeInTheDocument();
  });

  it('removes an assignment after confirmation', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ApplicantAssignmentsSection applicant={applicant} />);

    await user.click(await screen.findByRole('button', { name: 'Remove Dana Trustee as interviewer' }));
    await user.click(await screen.findByRole('button', { name: 'Remove' }));

    expect(mocks.remove).toHaveBeenCalledWith('app-1', 'asg-1');
    await waitFor(() => expect(screen.queryByText('Dana Trustee', { selector: 'li span' })).not.toBeInTheDocument());
  });

  it('shows someone who cannot manage the list without the controls', async () => {
    renderWithRouter(
      <ApplicantAccessContext.Provider value={{ ...READ_ONLY_ACCESS, roles: ['interviewer'] }}>
        <ApplicantAssignmentsSection applicant={applicant} />
      </ApplicantAccessContext.Provider>
    );

    expect(await screen.findByText('Dana Trustee', { selector: 'li span' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Member')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
    expect(mocks.getUsers).not.toHaveBeenCalled();
  });

  it('renders nothing for a non-manager when nobody is assigned', async () => {
    mocks.list.mockResolvedValue([]);
    renderWithRouter(
      <ApplicantAccessContext.Provider value={READ_ONLY_ACCESS}>
        <ApplicantAssignmentsSection applicant={applicant} />
      </ApplicantAccessContext.Provider>
    );

    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('heading', { name: /Assigned/ })).not.toBeInTheDocument());
  });
});
