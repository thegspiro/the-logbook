import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import PipelineDetailPage from './PipelineDetailPage';

// ---- Service mocks ----
const mockGetProgram = vi.fn();
const mockGetProgramPhases = vi.fn();
const mockGetProgramRequirements = vi.fn();
const mockGetProgramEnrollments = vi.fn();
const mockGetEnrollmentProgress = vi.fn();
const mockUpdateProgress = vi.fn();
const mockAdvancePhase = vi.fn();
const mockUpdateProgramRequirement = vi.fn();
const mockGetEnrollmentEligibility = vi.fn();
const mockBulkEnrollMembers = vi.fn();
const mockUpdateProgram = vi.fn();
const mockCreateProgramPhase = vi.fn();
const mockDeleteProgramPhase = vi.fn();

vi.mock('../services/api', () => ({
  trainingProgramService: {
    getProgram: (...a: unknown[]) => mockGetProgram(...a) as unknown,
    getProgramPhases: (...a: unknown[]) => mockGetProgramPhases(...a) as unknown,
    getProgramRequirements: (...a: unknown[]) => mockGetProgramRequirements(...a) as unknown,
    getProgramEnrollments: (...a: unknown[]) => mockGetProgramEnrollments(...a) as unknown,
    getEnrollmentProgress: (...a: unknown[]) => mockGetEnrollmentProgress(...a) as unknown,
    updateProgress: (...a: unknown[]) => mockUpdateProgress(...a) as unknown,
    advancePhase: (...a: unknown[]) => mockAdvancePhase(...a) as unknown,
    updateProgramRequirement: (...a: unknown[]) => mockUpdateProgramRequirement(...a) as unknown,
    getEnrollmentEligibility: (...a: unknown[]) => mockGetEnrollmentEligibility(...a) as unknown,
    bulkEnrollMembers: (...a: unknown[]) => mockBulkEnrollMembers(...a) as unknown,
    updateProgram: (...a: unknown[]) => mockUpdateProgram(...a) as unknown,
    createProgramPhase: (...a: unknown[]) => mockCreateProgramPhase(...a) as unknown,
    deleteProgramPhase: (...a: unknown[]) => mockDeleteProgramPhase(...a) as unknown,
  },
}));

// Grant training.manage so officer-only controls (the Required toggle) render.
let mockHasPermission = true;
vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ checkPermission: () => mockHasPermission }),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ programId: 'prog-1' }),
  };
});

const program = {
  id: 'prog-1',
  organization_id: 'org-1',
  name: 'Recruit Pipeline',
  structure_type: 'phases',
  version: 1,
  is_template: false,
  active: true,
  warning_days_before: 30,
  allows_concurrent_enrollment: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const enrollment = {
  id: 'enr-1',
  user_id: 'user-9',
  user_name: 'Jane Recruit',
  program_id: 'prog-1',
  enrolled_at: '2026-02-01T00:00:00Z',
  progress_percentage: 0,
  status: 'active',
  deadline_warning_sent: false,
  created_at: '2026-02-01T00:00:00Z',
  updated_at: '2026-02-01T00:00:00Z',
};

// A certification requirement — non-numeric, so only a status action completes it.
const certProgress = {
  id: 'prog-rec-1',
  enrollment_id: 'enr-1',
  requirement_id: 'req-1',
  status: 'not_started',
  progress_value: 0,
  progress_percentage: 0,
  created_at: '2026-02-01T00:00:00Z',
  updated_at: '2026-02-01T00:00:00Z',
  requirement: {
    id: 'req-1',
    name: 'CPR Certification',
    requirement_type: 'certification',
  },
};

describe('PipelineDetailPage — enrollment progress management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission = true;
    mockGetProgram.mockResolvedValue(program);
    mockGetProgramPhases.mockResolvedValue([]);
    mockGetProgramRequirements.mockResolvedValue([]);
    mockGetProgramEnrollments.mockResolvedValue([enrollment]);
    mockGetEnrollmentProgress.mockResolvedValue({
      enrollment,
      program,
      requirement_progress: [certProgress],
      completed_requirements: 0,
      total_requirements: 1,
      next_milestones: [],
      is_behind_schedule: false,
    });
    mockUpdateProgress.mockResolvedValue({ ...certProgress, status: 'completed' });
    mockAdvancePhase.mockResolvedValue({ ...enrollment, current_phase_id: 'ph-2' });
    mockGetEnrollmentEligibility.mockResolvedValue([
      { user_id: 'u1', first_name: 'Ava', last_name: 'Recruit', eligible: true, status: 'eligible', reason: null },
      {
        user_id: 'u2', first_name: 'Ben', last_name: 'Veteran', eligible: false,
        status: 'prerequisite', reason: 'Must first complete: Recruit School',
      },
    ]);
    mockBulkEnrollMembers.mockResolvedValue({ success_count: 1, enrolled_users: ['u1'], errors: [] });
    mockUpdateProgram.mockResolvedValue(program);
    mockCreateProgramPhase.mockResolvedValue({ id: 'ph-new', program_id: 'prog-1', phase_number: 1, name: 'Intro' });
    mockDeleteProgramPhase.mockResolvedValue(undefined);
  });

  it('lists enrolled members by name on the Enrollments tab', async () => {
    renderWithRouter(<PipelineDetailPage />);

    await userEvent.click(await screen.findByRole('tab', { name: /Enrollments/i }));

    expect(await screen.findByText('Jane Recruit')).toBeInTheDocument();
  });

  it('marks a non-numeric requirement complete via the progress modal', async () => {
    renderWithRouter(<PipelineDetailPage />);

    await userEvent.click(await screen.findByRole('tab', { name: /Enrollments/i }));
    await userEvent.click(
      await screen.findByRole('button', { name: /Manage progress for Jane Recruit/i }),
    );

    // Modal loads the member's requirement list.
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('CPR Certification')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: /Mark complete/i }));

    await waitFor(() =>
      expect(mockUpdateProgress).toHaveBeenCalledWith('prog-rec-1', { status: 'completed' }),
    );
    // Progress is re-fetched after the update so the rollup reflects it.
    await waitFor(() => expect(mockGetEnrollmentProgress).toHaveBeenCalledTimes(2));
  });

  it('groups requirements by phase and advances to the next phase', async () => {
    const phase1 = {
      id: 'ph-1', program_id: 'prog-1', phase_number: 1, name: 'Basics',
      requires_manual_advancement: false, created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    const phase2 = {
      id: 'ph-2', program_id: 'prog-1', phase_number: 2, name: 'Advanced',
      requires_manual_advancement: false, created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    mockGetProgramPhases.mockResolvedValue([phase1, phase2]);
    mockGetProgramRequirements.mockResolvedValue([
      { id: 'pr-1', program_id: 'prog-1', phase_id: 'ph-1', requirement_id: 'req-1', is_required: true, is_prerequisite: false, sort_order: 0, created_at: '2026-01-01T00:00:00Z' },
      { id: 'pr-2', program_id: 'prog-1', phase_id: 'ph-2', requirement_id: 'req-2', is_required: true, is_prerequisite: false, sort_order: 0, created_at: '2026-01-01T00:00:00Z' },
    ]);
    const phasedEnrollment = { ...enrollment, current_phase_id: 'ph-1' };
    mockGetEnrollmentProgress.mockResolvedValue({
      enrollment: phasedEnrollment,
      program,
      current_phase: phase1,
      requirement_progress: [
        { ...certProgress, id: 'rp-1', requirement_id: 'req-1' },
        {
          ...certProgress, id: 'rp-2', requirement_id: 'req-2',
          requirement: { id: 'req-2', name: 'Pump Ops', requirement_type: 'skills_evaluation' },
        },
      ],
      completed_requirements: 0,
      total_requirements: 2,
      next_milestones: [],
      is_behind_schedule: false,
    });

    renderWithRouter(<PipelineDetailPage />);

    await userEvent.click(await screen.findByRole('tab', { name: /Enrollments/i }));
    await userEvent.click(
      await screen.findByRole('button', { name: /Manage progress for Jane Recruit/i }),
    );

    const dialog = await screen.findByRole('dialog');
    // Requirements are grouped under their phase headers.
    expect(await within(dialog).findByText(/Phase 1: Basics/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Phase 2: Advanced/)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: /Advance to next phase/i }));

    await waitFor(() => expect(mockAdvancePhase).toHaveBeenCalledWith('enr-1'));
  });

  it('records a knowledge-test score via the progress modal', async () => {
    mockGetEnrollmentProgress.mockResolvedValue({
      enrollment,
      program,
      requirement_progress: [
        {
          ...certProgress,
          id: 'rp-kt',
          requirement_id: 'req-kt',
          requirement: {
            id: 'req-kt',
            name: 'Written Exam',
            requirement_type: 'knowledge_test',
            passing_score: 70,
          },
        },
      ],
      completed_requirements: 0,
      total_requirements: 1,
      next_milestones: [],
      is_behind_schedule: false,
    });
    mockUpdateProgress.mockResolvedValue({ ...certProgress });

    renderWithRouter(<PipelineDetailPage />);
    await userEvent.click(await screen.findByRole('tab', { name: /Enrollments/i }));
    await userEvent.click(
      await screen.findByRole('button', { name: /Manage progress for Jane Recruit/i }),
    );

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Written Exam')).toBeInTheDocument();

    await userEvent.type(within(dialog).getByRole('spinbutton'), '85');
    await userEvent.click(within(dialog).getByRole('button', { name: /Record/i }));

    await waitFor(() =>
      expect(mockUpdateProgress).toHaveBeenCalledWith('rp-kt', { test_score: 85 }),
    );
  });

  it('toggles a requirement between Required and Optional on the overview', async () => {
    const phase1 = {
      id: 'ph-1', program_id: 'prog-1', phase_number: 1, name: 'Basics',
      requires_manual_advancement: false, created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    mockGetProgramPhases.mockResolvedValue([phase1]);
    mockGetProgramRequirements.mockResolvedValue([
      {
        id: 'pr-1', program_id: 'prog-1', phase_id: 'ph-1', requirement_id: 'req-1',
        is_required: true, is_prerequisite: false, sort_order: 0,
        created_at: '2026-01-01T00:00:00Z',
        requirement: { id: 'req-1', name: 'CPR Certification', requirement_type: 'certification' },
      },
    ]);
    mockUpdateProgramRequirement.mockResolvedValue({
      id: 'pr-1', program_id: 'prog-1', phase_id: 'ph-1', requirement_id: 'req-1',
      is_required: false, is_prerequisite: false, sort_order: 0,
      created_at: '2026-01-01T00:00:00Z',
    });

    renderWithRouter(<PipelineDetailPage />);

    const toggle = await screen.findByRole('button', { name: 'Required' });
    await userEvent.click(toggle);

    await waitFor(() =>
      expect(mockUpdateProgramRequirement).toHaveBeenCalledWith('prog-1', 'pr-1', {
        is_required: false,
      }),
    );
    // The label flips to reflect the new state.
    expect(await screen.findByRole('button', { name: 'Optional' })).toBeInTheDocument();
  });

  it('hides the Required toggle for members without training.manage', async () => {
    mockHasPermission = false;
    mockGetProgramPhases.mockResolvedValue([
      {
        id: 'ph-1', program_id: 'prog-1', phase_number: 1, name: 'Basics',
        requires_manual_advancement: false, created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ]);
    mockGetProgramRequirements.mockResolvedValue([
      {
        id: 'pr-1', program_id: 'prog-1', phase_id: 'ph-1', requirement_id: 'req-1',
        is_required: true, is_prerequisite: false, sort_order: 0,
        created_at: '2026-01-01T00:00:00Z',
        requirement: { id: 'req-1', name: 'CPR Certification', requirement_type: 'certification' },
      },
    ]);

    renderWithRouter(<PipelineDetailPage />);

    // Static "Required" text renders, but not as an interactive control.
    expect(await screen.findByText('Required')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Required' })).not.toBeInTheDocument();
  });

  it('shows only eligible members in the enroll picker, with a reason for the rest', async () => {
    renderWithRouter(<PipelineDetailPage />);

    await userEvent.click(await screen.findByRole('button', { name: /^Enroll$/i }));

    const dialog = await screen.findByRole('dialog');
    expect(mockGetEnrollmentEligibility).toHaveBeenCalledWith('prog-1');

    // Eligible member is shown; ineligible member is hidden by default.
    expect(await within(dialog).findByText('Ava Recruit')).toBeInTheDocument();
    expect(within(dialog).queryByText('Ben Veteran')).not.toBeInTheDocument();
    expect(within(dialog).getByText('1 of 2 eligible')).toBeInTheDocument();

    // Turning off "eligible only" reveals the blocked member and the reason.
    await userEvent.click(within(dialog).getByLabelText(/Show eligible only/i));
    expect(await within(dialog).findByText('Ben Veteran')).toBeInTheDocument();
    expect(within(dialog).getByText(/Must first complete: Recruit School/)).toBeInTheDocument();
  });

  it('enrolls the selected eligible member', async () => {
    renderWithRouter(<PipelineDetailPage />);

    await userEvent.click(await screen.findByRole('button', { name: /^Enroll$/i }));
    const dialog = await screen.findByRole('dialog');

    await userEvent.click(await within(dialog).findByText('Ava Recruit'));
    await userEvent.click(within(dialog).getByRole('button', { name: /Enroll 1 Member/i }));

    await waitFor(() =>
      expect(mockBulkEnrollMembers).toHaveBeenCalledWith('prog-1', {
        user_ids: ['u1'],
        target_completion_date: undefined,
      }),
    );
  });

  it('edits program details via the Edit button', async () => {
    renderWithRouter(<PipelineDetailPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: /Edit pipeline details/i });

    const nameInput = within(dialog).getByLabelText('Name');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Renamed Pipeline');
    await userEvent.click(within(dialog).getByRole('button', { name: /^Save$/i }));

    await waitFor(() =>
      expect(mockUpdateProgram).toHaveBeenCalledWith(
        'prog-1',
        expect.objectContaining({ name: 'Renamed Pipeline' }),
      ),
    );
  });

  it('adds a phase from the overview', async () => {
    mockGetProgramPhases.mockResolvedValue([]);
    renderWithRouter(<PipelineDetailPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Add phase/i }));
    const dialog = await screen.findByRole('dialog', { name: /Add phase/i });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Orientation');
    await userEvent.click(within(dialog).getByRole('button', { name: /^Save$/i }));

    await waitFor(() =>
      expect(mockCreateProgramPhase).toHaveBeenCalledWith(
        'prog-1',
        expect.objectContaining({ name: 'Orientation', phase_number: 1 }),
      ),
    );
  });

  it('deletes a phase after confirmation', async () => {
    mockGetProgramPhases.mockResolvedValue([
      {
        id: 'ph-1', program_id: 'prog-1', phase_number: 1, name: 'Basics',
        requires_manual_advancement: false, created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ]);
    renderWithRouter(<PipelineDetailPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Delete phase' }));
    // Confirm dialog appears; confirm the deletion.
    await userEvent.click(await screen.findByRole('button', { name: /^Delete$/ }));

    await waitFor(() => expect(mockDeleteProgramPhase).toHaveBeenCalledWith('prog-1', 'ph-1'));
  });
});
