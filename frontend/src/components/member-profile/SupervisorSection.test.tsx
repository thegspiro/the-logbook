import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider } from '../../contexts/ConfirmContext';
import type { MemberSupervisor, SupervisorAssignment } from '../../types/user';

const mockGetSupervisor = vi.fn();
const mockGetCandidates = vi.fn();
const mockSetSupervisor = vi.fn();
const mockEndSupervisor = vi.fn();
vi.mock('../../services/api', () => ({
  memberStatusService: {
    getSupervisor: (...args: unknown[]) => mockGetSupervisor(...args) as unknown,
    getSupervisorCandidates: (...args: unknown[]) => mockGetCandidates(...args) as unknown,
    setSupervisor: (...args: unknown[]) => mockSetSupervisor(...args) as unknown,
    endSupervisor: (...args: unknown[]) => mockEndSupervisor(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../utils/dateFormatting', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/dateFormatting')>();
  return { ...actual, getTodayLocalDate: () => '2026-11-01' };
});

// Import AFTER mocks
import { SupervisorSection } from './SupervisorSection';

const CURRENT: SupervisorAssignment = {
  id: 'a2',
  supervisor_id: 'lt',
  supervisor_name: 'Lee Lieutenant',
  starts_on: '2026-06-01',
  ends_on: null,
  created_at: null,
};

const EARLIER: SupervisorAssignment = {
  id: 'a1',
  supervisor_id: 'cap',
  supervisor_name: 'Casey Captain',
  starts_on: '2025-01-01',
  ends_on: '2026-05-31',
  created_at: null,
};

const WITH_HISTORY: MemberSupervisor = { member_id: 'u1', current: CURRENT, history: [CURRENT, EARLIER] };
const NONE: MemberSupervisor = { member_id: 'u1', current: null, history: [] };

function renderSection(canEdit = true) {
  return render(
    <ConfirmProvider>
      <SupervisorSection userId="u1" memberName="Sam Member" canEdit={canEdit} tz="UTC" />
    </ConfirmProvider>
  );
}

describe('SupervisorSection', () => {
  beforeEach(() => {
    mockGetSupervisor.mockReset();
    mockGetSupervisor.mockResolvedValue(WITH_HISTORY);
    mockGetCandidates.mockReset();
    mockGetCandidates.mockResolvedValue([
      { id: 'cap', name: 'Casey Captain', membership_number: '12' },
      { id: 'chief', name: 'Pat Chief', membership_number: null },
    ]);
    mockSetSupervisor.mockReset();
    mockSetSupervisor.mockResolvedValue(NONE);
    mockEndSupervisor.mockReset();
    mockEndSupervisor.mockResolvedValue({ ...WITH_HISTORY, current: null });
  });

  it('shows the current supervisor and the earlier ones', async () => {
    renderSection();

    expect(await screen.findByText('Lee Lieutenant')).toBeInTheDocument();
    const earlier = screen.getByRole('list', { name: 'Earlier supervisors' });
    expect(within(earlier).getByText('Casey Captain')).toBeInTheDocument();
    expect(within(earlier).queryByText('Lee Lieutenant')).not.toBeInTheDocument();
    expect(mockGetSupervisor).toHaveBeenCalledWith('u1');
  });

  it('says when no supervisor is on record', async () => {
    mockGetSupervisor.mockResolvedValue(NONE);
    renderSection();

    expect(await screen.findByText('No supervisor on record.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set supervisor' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End assignment' })).not.toBeInTheDocument();
  });

  it('offers no changes without members.manage', async () => {
    renderSection(false);

    await screen.findByText('Lee Lieutenant');
    expect(screen.queryByRole('button', { name: 'Change supervisor' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End assignment' })).not.toBeInTheDocument();
  });

  it('changes the supervisor from the chosen date using the candidate list', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(await screen.findByRole('button', { name: 'Change supervisor' }));
    const select = screen.getByLabelText('Supervisor');
    await screen.findByRole('option', { name: 'Casey Captain (#12)' });
    await user.selectOptions(select, 'chief');
    const start = screen.getByLabelText('Starting');
    expect(start).toHaveValue('2026-11-01');
    await user.clear(start);
    await user.type(start, '2026-10-15');
    await user.click(screen.getByRole('button', { name: 'Save supervisor' }));

    expect(mockGetCandidates).toHaveBeenCalledWith('u1');
    expect(mockSetSupervisor).toHaveBeenCalledWith('u1', { supervisor_id: 'chief', starts_on: '2026-10-15' });
    expect(await screen.findByText('No supervisor on record.')).toBeInTheDocument();
  });

  it('omits a cleared start date so the backend uses today', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(await screen.findByRole('button', { name: 'Change supervisor' }));
    await screen.findByRole('option', { name: 'Pat Chief' });
    await user.selectOptions(screen.getByLabelText('Supervisor'), 'chief');
    await user.clear(screen.getByLabelText('Starting'));
    await user.click(screen.getByRole('button', { name: 'Save supervisor' }));

    expect(mockSetSupervisor).toHaveBeenCalledWith('u1', { supervisor_id: 'chief', starts_on: undefined });
  });

  it('asks for a supervisor before saving', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(await screen.findByRole('button', { name: 'Change supervisor' }));
    await screen.findByRole('option', { name: 'Pat Chief' });
    await user.click(screen.getByRole('button', { name: 'Save supervisor' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Choose a supervisor.');
    expect(mockSetSupervisor).not.toHaveBeenCalled();
  });

  it('shows the reason a save was refused', async () => {
    mockSetSupervisor.mockRejectedValue(new Error('A member cannot be their own supervisor'));
    const user = userEvent.setup();
    renderSection();

    await user.click(await screen.findByRole('button', { name: 'Change supervisor' }));
    await screen.findByRole('option', { name: 'Pat Chief' });
    await user.selectOptions(screen.getByLabelText('Supervisor'), 'chief');
    await user.click(screen.getByRole('button', { name: 'Save supervisor' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('A member cannot be their own supervisor');
  });

  it('ends the assignment only after confirmation', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(await screen.findByRole('button', { name: 'End assignment' }));
    await user.click(await screen.findByRole('button', { name: 'Keep it' }));
    expect(mockEndSupervisor).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'End assignment' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'End assignment' }));

    expect(mockEndSupervisor).toHaveBeenCalledWith('u1', {});
    expect(await screen.findByText('No supervisor on record.')).toBeInTheDocument();
  });
});
