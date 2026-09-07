/**
 * The Enrolled Members table could never render before 2026-09-06: the page
 * read `program.enrollments`, and the programme response
 * (`ProgramWithPhasesAndRequirements`) has no such field, so the section was
 * always skipped and the header always printed `Enrolled: 0`. These cases pin
 * the separate roster call and the three things about it that are easy to
 * regress — the permission degrade, the unavailable-vs-empty distinction, and
 * the phase name being resolved rather than read off the enrollment.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithRouter } from '../../test/utils';

const mockGetProgram = vi.fn();
const mockGetProgramRequirements = vi.fn();
const mockGetProgramEnrollments = vi.fn();

vi.mock('../../services/api', () => ({
  trainingProgramService: {
    getProgram: (...args: unknown[]) => mockGetProgram(...args) as unknown,
    getProgramRequirements: (...args: unknown[]) => mockGetProgramRequirements(...args) as unknown,
    getProgramEnrollments: (...args: unknown[]) => mockGetProgramEnrollments(...args) as unknown,
  },
}));

vi.mock('../../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

// Import after the mocks are in place.
import ProgramPrintPage from './ProgramPrintPage';

const program = {
  id: 'prog-1',
  organization_id: 'org-1',
  name: 'Probationary Firefighter Pipeline',
  description: 'Twelve-month probation.',
  code: 'PROB-1',
  structure_type: 'phased',
  time_limit_days: 365,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  phases: [
    { id: 'phase-1', program_id: 'prog-1', phase_number: 1, name: 'Orientation' },
    { id: 'phase-2', program_id: 'prog-1', phase_number: 2, name: 'Interior Operations' },
  ],
  requirements: [],
  milestones: [],
  total_requirements: 0,
  total_required: 0,
};

const enrollment = {
  id: 'enr-1',
  user_id: 'user-1',
  program_id: 'prog-1',
  enrolled_at: '2026-02-03T00:00:00Z',
  target_completion_date: '2027-02-03',
  current_phase_id: 'phase-2',
  progress_percentage: 42.4,
  status: 'active',
  deadline_warning_sent: false,
  created_at: '2026-02-03T00:00:00Z',
  updated_at: '2026-02-03T00:00:00Z',
  user_name: 'A. Ferraro',
  user_email: 'a.ferraro@example.org',
};

function renderAt(query: string) {
  window.history.pushState({}, '', `/training/print/program${query}`);
  return renderWithRouter(<ProgramPrintPage />);
}

/** The row of the Enrolled Members table describing `member`. */
async function memberRow(member: string) {
  await screen.findByText(member);
  const row = screen.getAllByRole('row').find((r) => within(r).queryByText(member));
  expect(row).toBeDefined();
  return row as HTMLElement;
}

/** The header cell carrying the enrolled count. */
async function enrolledCell() {
  const cells = await screen.findAllByRole('cell');
  const cell = cells.find((c) => c.textContent?.startsWith('Enrolled:'));
  expect(cell).toBeDefined();
  return cell as HTMLElement;
}

describe('ProgramPrintPage enrolled members', () => {
  beforeEach(() => {
    mockGetProgram.mockReset();
    mockGetProgramRequirements.mockReset();
    mockGetProgramEnrollments.mockReset();
    mockGetProgram.mockResolvedValue(structuredClone(program));
    mockGetProgramRequirements.mockResolvedValue([]);
    mockGetProgramEnrollments.mockResolvedValue([structuredClone(enrollment)]);
  });

  it('reads the roster from its own endpoint, not from the programme', async () => {
    renderAt('?id=prog-1');

    expect(await screen.findByText('Enrolled Members')).toBeInTheDocument();
    expect(mockGetProgramEnrollments).toHaveBeenCalledWith('prog-1');
  });

  it('renders the member name the roster endpoint supplies', async () => {
    renderAt('?id=prog-1');

    const row = await memberRow('A. Ferraro');
    expect(within(row).getByText('active')).toBeInTheDocument();
    expect(within(row).getByText('42%')).toBeInTheDocument();
  });

  it('resolves the current phase from the programme, not from the enrollment', async () => {
    // ProgramEnrollmentResponse serializes current_phase_id and no nested
    // phase, so reading e.current_phase would print an em dash for everyone.
    renderAt('?id=prog-1');

    const row = await memberRow('A. Ferraro');
    expect(within(row).getByText('Interior Operations')).toBeInTheDocument();
  });

  it('counts the roster in the header', async () => {
    renderAt('?id=prog-1');

    expect(await enrolledCell()).toHaveTextContent('Enrolled: 1');
  });

  it('falls back to the user id when no name came back', async () => {
    mockGetProgramEnrollments.mockResolvedValue([{ ...structuredClone(enrollment), user_name: '' }]);
    renderAt('?id=prog-1');

    expect(await memberRow('user-1')).toBeInTheDocument();
  });

  it('prints the rest of the sheet when the roster is forbidden', async () => {
    // The route is gated on the training module alone; the endpoint needs
    // training.view_all/training.manage. A member without it gets the
    // programme without the roster — which is the right outcome, not a
    // degraded one.
    mockGetProgramEnrollments.mockRejectedValue(new Error('Forbidden'));
    renderAt('?id=prog-1');

    expect(await screen.findByText('Probationary Firefighter Pipeline')).toBeInTheDocument();
    expect(screen.queryByText('Enrolled Members')).not.toBeInTheDocument();
  });

  it('does not claim zero enrolled when the roster could not be read', async () => {
    mockGetProgramEnrollments.mockRejectedValue(new Error('Forbidden'));
    renderAt('?id=prog-1');

    expect(await enrolledCell()).toHaveTextContent('Enrolled: —');
  });

  it('reports an empty roster as zero, distinctly from an unreadable one', async () => {
    mockGetProgramEnrollments.mockResolvedValue([]);
    renderAt('?id=prog-1');

    expect(await enrolledCell()).toHaveTextContent('Enrolled: 0');
    expect(screen.queryByText('Enrolled Members')).not.toBeInTheDocument();
  });
});
