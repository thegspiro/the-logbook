import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';
import { renderWithRouter } from '../test/utils';
import PipelineDetailPage from './PipelineDetailPage';

// ---- Service mocks ----
const mockGetProgram = vi.fn();
const mockGetProgramPhases = vi.fn();
const mockGetProgramRequirements = vi.fn();
const mockGetProgramEnrollments = vi.fn();
const mockGetEnrollmentProgress = vi.fn();
const mockUpdateProgress = vi.fn();
const mockResetProgress = vi.fn();
const mockResetEnrollment = vi.fn();
const mockAdvancePhase = vi.fn();
const mockUpdateProgramRequirement = vi.fn();
const mockGetEnrollmentEligibility = vi.fn();
const mockBulkEnrollMembers = vi.fn();
const mockUpdateProgram = vi.fn();
const mockCreateProgramPhase = vi.fn();
const mockDeleteProgramPhase = vi.fn();
const mockDeleteProgram = vi.fn();
const mockReopenEnrollment = vi.fn();
const mockGetPrograms = vi.fn();
const mockCompleteEnrollment = vi.fn();

// The edit dialog loads the department's evaluation forms for its picker;
// an empty list unless a test says otherwise.
const mockListShiftEvaluationTemplates = vi.fn();
vi.mock('../services/api', () => ({
  shiftEvaluationTemplateService: {
    list: (...a: unknown[]) => mockListShiftEvaluationTemplates(...a) as unknown,
  },
  trainingProgramService: {
    getProgram: (...a: unknown[]) => mockGetProgram(...a) as unknown,
    getProgramPhases: (...a: unknown[]) => mockGetProgramPhases(...a) as unknown,
    getProgramRequirements: (...a: unknown[]) => mockGetProgramRequirements(...a) as unknown,
    getProgramEnrollments: (...a: unknown[]) => mockGetProgramEnrollments(...a) as unknown,
    getEnrollmentProgress: (...a: unknown[]) => mockGetEnrollmentProgress(...a) as unknown,
    updateProgress: (...a: unknown[]) => mockUpdateProgress(...a) as unknown,
    resetProgress: (...a: unknown[]) => mockResetProgress(...a) as unknown,
    resetEnrollment: (...a: unknown[]) => mockResetEnrollment(...a) as unknown,
    advancePhase: (...a: unknown[]) => mockAdvancePhase(...a) as unknown,
    updateProgramRequirement: (...a: unknown[]) => mockUpdateProgramRequirement(...a) as unknown,
    getEnrollmentEligibility: (...a: unknown[]) => mockGetEnrollmentEligibility(...a) as unknown,
    bulkEnrollMembers: (...a: unknown[]) => mockBulkEnrollMembers(...a) as unknown,
    updateProgram: (...a: unknown[]) => mockUpdateProgram(...a) as unknown,
    createProgramPhase: (...a: unknown[]) => mockCreateProgramPhase(...a) as unknown,
    deleteProgramPhase: (...a: unknown[]) => mockDeleteProgramPhase(...a) as unknown,
    deleteProgram: (...a: unknown[]) => mockDeleteProgram(...a) as unknown,
    reopenEnrollment: (...a: unknown[]) => mockReopenEnrollment(...a) as unknown,
    getPrograms: (...a: unknown[]) => mockGetPrograms(...a) as unknown,
    completeEnrollment: (...a: unknown[]) => mockCompleteEnrollment(...a) as unknown,
  },
}));

// Grant training.manage so officer-only controls (the Required toggle) render.
let mockHasPermission = true;
// Set to grant exactly these permissions instead of the blanket answer above.
let mockPermissions: string[] | null = null;
vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      checkPermission: (permission: string) =>
        mockPermissions ? mockPermissions.includes(permission) : mockHasPermission,
    }),
}));

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
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
    mockListShiftEvaluationTemplates.mockReset();
    mockListShiftEvaluationTemplates.mockResolvedValue([]);
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
    mockResetProgress.mockResolvedValue({ ...certProgress, status: 'not_started' });
    mockResetEnrollment.mockResolvedValue({ ...enrollment });
    mockAdvancePhase.mockResolvedValue({ ...enrollment, current_phase_id: 'ph-2' });
    mockGetEnrollmentEligibility.mockResolvedValue([
      { user_id: 'u1', first_name: 'Ava', last_name: 'Recruit', eligible: true, status: 'eligible', reason: null },
      {
        user_id: 'u2',
        first_name: 'Ben',
        last_name: 'Veteran',
        eligible: false,
        status: 'prerequisite',
        reason: 'Must first complete: Recruit School',
      },
    ]);
    mockBulkEnrollMembers.mockResolvedValue({ success_count: 1, enrolled_users: ['u1'], errors: [] });
    mockUpdateProgram.mockResolvedValue(program);
    mockCreateProgramPhase.mockResolvedValue({ id: 'ph-new', program_id: 'prog-1', phase_number: 1, name: 'Intro' });
    mockDeleteProgramPhase.mockResolvedValue(undefined);
    mockDeleteProgram.mockResolvedValue(undefined);
    mockGetPrograms.mockReset();
    mockGetPrograms.mockResolvedValue([]);
  });

  // Generated from the URL now rather than passed as items, so these set the
  // route. The trail ends at Programs: the programme's own name is the <h1>
  // just below, and repeating it in the trail is the duplication the reports
  // page was pulled up for.
  it('shows the hub breadcrumb back to training administration for training managers', async () => {
    window.history.replaceState({}, '', '/training/programs/prog-1');
    renderWithRouter(<PipelineDetailPage />);

    const nav = await screen.findByRole('navigation', { name: /breadcrumb/i });
    expect(within(nav).getByRole('link', { name: 'Training Administration' })).toHaveAttribute(
      'href',
      '/training/admin'
    );
    expect(within(nav).getByRole('link', { name: 'Programs' })).toHaveAttribute('href', '/training/programs');
  });

  it('omits the hub breadcrumb for members without training.manage', async () => {
    mockHasPermission = false;
    window.history.replaceState({}, '', '/training/programs/prog-1');
    renderWithRouter(<PipelineDetailPage />);

    const nav = await screen.findByRole('navigation', { name: /breadcrumb/i });
    expect(within(nav).queryByRole('link', { name: 'Training Administration' })).not.toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Programs' })).toHaveAttribute('href', '/training/programs');
  });

  it('offers a member without training permissions no enrollment view and no Duplicate', async () => {
    mockHasPermission = false;
    renderWithRouter(<PipelineDetailPage />);

    expect(await screen.findByRole('heading', { name: 'Recruit Pipeline' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Duplicate/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Enrollments/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Enrolled')).not.toBeInTheDocument();
    expect(mockGetProgramEnrollments).not.toHaveBeenCalled();
  });

  it('lists enrolled members by name on the Enrollments tab', async () => {
    renderWithRouter(<PipelineDetailPage />);

    await userEvent.click(await screen.findByRole('tab', { name: /Enrollments/i }));

    expect(await screen.findByText('Jane Recruit')).toBeInTheDocument();
  });

  it('names the enrollment status rather than printing the stored value', async () => {
    mockGetProgramEnrollments.mockResolvedValue([{ ...enrollment, status: 'on_hold' }]);
    renderWithRouter(<PipelineDetailPage />);

    await userEvent.click(await screen.findByRole('tab', { name: /Enrollments/i }));

    expect(await screen.findByText(/Status: On Hold/)).toBeInTheDocument();
  });

  it('asks the API for one status when the filter is set', async () => {
    renderWithRouter(<PipelineDetailPage />);

    await userEvent.click(await screen.findByRole('tab', { name: /Enrollments/i }));
    await screen.findByText('Jane Recruit');
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'expired');

    await waitFor(() => expect(mockGetProgramEnrollments).toHaveBeenCalledWith('prog-1', 'expired'));
  });

  it('says the filter emptied the list, and offers the way back', async () => {
    // Distinct from "nobody is enrolled": an officer who filtered to Expired
    // and found none should not be told to enroll somebody.
    renderWithRouter(<PipelineDetailPage />);

    await userEvent.click(await screen.findByRole('tab', { name: /Enrollments/i }));
    await screen.findByText('Jane Recruit');
    mockGetProgramEnrollments.mockResolvedValue([]);
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'expired');

    expect(await screen.findByText(/No expired enrollments in this pipeline/)).toBeInTheDocument();
    expect(screen.queryByText(/No members enrolled yet/)).not.toBeInTheDocument();

    mockGetProgramEnrollments.mockResolvedValue([enrollment]);
    await userEvent.click(screen.getByRole('button', { name: /Show all statuses/i }));

    expect(await screen.findByText('Jane Recruit')).toBeInTheDocument();
  });

  it('marks a non-numeric requirement complete via the progress modal', async () => {
    renderWithRouter(<PipelineDetailPage />);

    await userEvent.click(await screen.findByRole('tab', { name: /Enrollments/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Manage progress for Jane Recruit/i }));

    // Modal loads the member's requirement list.
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('CPR Certification')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: /Mark complete/i }));

    await waitFor(() => expect(mockUpdateProgress).toHaveBeenCalledWith('prog-rec-1', { status: 'completed' }));
    // Progress is re-fetched after the update so the rollup reflects it.
    await waitFor(() => expect(mockGetEnrollmentProgress).toHaveBeenCalledTimes(2));
  });

  it('shows a linked requirement as the compliance figure, offering only a waiver', async () => {
    // W26-1: a department requirement linked into the program reads the
    // member's compliance result; the server refuses manual progress on it.
    mockGetEnrollmentProgress.mockResolvedValue({
      enrollment,
      program,
      requirement_progress: [
        {
          ...certProgress,
          status: 'in_progress',
          progress_value: 4,
          progress_percentage: 66.67,
          reads_compliance: true,
          requirement: { id: 'req-1', name: 'Annual Hazmat Hours', requirement_type: 'hours', required_hours: 6 },
        },
      ],
      completed_requirements: 0,
      total_requirements: 1,
      next_milestones: [],
      is_behind_schedule: false,
    });
    mockUpdateProgress.mockResolvedValue({ ...certProgress, status: 'waived', reads_compliance: true });
    renderWithRouter(<PipelineDetailPage />);

    await userEvent.click(await screen.findByRole('tab', { name: /Enrollments/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Manage progress for Jane Recruit/i }));
    const dialog = await screen.findByRole('dialog');

    expect(await within(dialog).findByText(/as the compliance screens grade it \(4 of 6 hours\)/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Mark complete/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('spinbutton')).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Waive for this program' }));
    await waitFor(() => expect(mockUpdateProgress).toHaveBeenCalledWith('prog-rec-1', { status: 'waived' }));
  });

  it('groups requirements by phase and advances to the next phase', async () => {
    const phase1 = {
      id: 'ph-1',
      program_id: 'prog-1',
      phase_number: 1,
      name: 'Basics',
      requires_manual_advancement: false,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    const phase2 = {
      id: 'ph-2',
      program_id: 'prog-1',
      phase_number: 2,
      name: 'Advanced',
      requires_manual_advancement: false,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    mockGetProgramPhases.mockResolvedValue([phase1, phase2]);
    mockGetProgramRequirements.mockResolvedValue([
      {
        id: 'pr-1',
        program_id: 'prog-1',
        phase_id: 'ph-1',
        requirement_id: 'req-1',
        is_required: true,
        is_prerequisite: false,
        sort_order: 0,
        created_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'pr-2',
        program_id: 'prog-1',
        phase_id: 'ph-2',
        requirement_id: 'req-2',
        is_required: true,
        is_prerequisite: false,
        sort_order: 0,
        created_at: '2026-01-01T00:00:00Z',
      },
    ]);
    const phasedEnrollment = { ...enrollment, current_phase_id: 'ph-1' };
    mockGetEnrollmentProgress.mockResolvedValue({
      enrollment: phasedEnrollment,
      program,
      current_phase: phase1,
      requirement_progress: [
        { ...certProgress, id: 'rp-1', requirement_id: 'req-1' },
        {
          ...certProgress,
          id: 'rp-2',
          requirement_id: 'req-2',
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
    await userEvent.click(await screen.findByRole('button', { name: /Manage progress for Jane Recruit/i }));

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
    await userEvent.click(await screen.findByRole('button', { name: /Manage progress for Jane Recruit/i }));

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Written Exam')).toBeInTheDocument();

    await userEvent.type(within(dialog).getByRole('spinbutton'), '85');
    await userEvent.click(within(dialog).getByRole('button', { name: /Record/i }));

    await waitFor(() => expect(mockUpdateProgress).toHaveBeenCalledWith('rp-kt', { test_score: 85 }));
  });

  it('toggles a requirement between Required and Optional on the overview', async () => {
    const phase1 = {
      id: 'ph-1',
      program_id: 'prog-1',
      phase_number: 1,
      name: 'Basics',
      requires_manual_advancement: false,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    mockGetProgramPhases.mockResolvedValue([phase1]);
    mockGetProgramRequirements.mockResolvedValue([
      {
        id: 'pr-1',
        program_id: 'prog-1',
        phase_id: 'ph-1',
        requirement_id: 'req-1',
        is_required: true,
        is_prerequisite: false,
        sort_order: 0,
        created_at: '2026-01-01T00:00:00Z',
        requirement: { id: 'req-1', name: 'CPR Certification', requirement_type: 'certification' },
      },
    ]);
    mockUpdateProgramRequirement.mockResolvedValue({
      id: 'pr-1',
      program_id: 'prog-1',
      phase_id: 'ph-1',
      requirement_id: 'req-1',
      is_required: false,
      is_prerequisite: false,
      sort_order: 0,
      created_at: '2026-01-01T00:00:00Z',
    });

    renderWithRouter(<PipelineDetailPage />);

    const toggle = await screen.findByRole('button', { name: 'Required' });
    await userEvent.click(toggle);

    await waitFor(() =>
      expect(mockUpdateProgramRequirement).toHaveBeenCalledWith('prog-1', 'pr-1', {
        is_required: false,
      })
    );
    // The label flips to reflect the new state.
    expect(await screen.findByRole('button', { name: 'Optional' })).toBeInTheDocument();
  });

  it('marks a requirement as the one to do first', async () => {
    const phase1 = {
      id: 'ph-1',
      program_id: 'prog-1',
      phase_number: 1,
      name: 'Basics',
      requires_manual_advancement: false,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    mockGetProgramPhases.mockResolvedValue([phase1]);
    mockGetProgramRequirements.mockResolvedValue([
      {
        id: 'pr-1',
        program_id: 'prog-1',
        phase_id: 'ph-1',
        requirement_id: 'req-1',
        is_required: true,
        is_prerequisite: false,
        sort_order: 0,
        created_at: '2026-01-01T00:00:00Z',
        requirement: { id: 'req-1', name: 'Orientation', requirement_type: 'checklist' },
      },
    ]);
    mockUpdateProgramRequirement.mockResolvedValue({
      id: 'pr-1',
      program_id: 'prog-1',
      phase_id: 'ph-1',
      requirement_id: 'req-1',
      is_required: true,
      is_prerequisite: true,
      sort_order: 0,
      created_at: '2026-01-01T00:00:00Z',
    });

    renderWithRouter(<PipelineDetailPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Any order/ }));

    await waitFor(() =>
      expect(mockUpdateProgramRequirement).toHaveBeenCalledWith('prog-1', 'pr-1', {
        is_prerequisite: true,
      })
    );
    expect(await screen.findByRole('button', { name: /Do this first/ })).toBeInTheDocument();
  });

  it('says which phases gate a phase that has prerequisites', async () => {
    mockGetProgramPhases.mockResolvedValue([
      {
        id: 'ph-1',
        program_id: 'prog-1',
        phase_number: 1,
        name: 'Classroom',
        requires_manual_advancement: false,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'ph-2',
        program_id: 'prog-1',
        phase_number: 2,
        name: 'Ride-Along',
        prerequisite_phase_ids: ['ph-1'],
        requires_manual_advancement: false,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ]);
    mockGetProgramRequirements.mockResolvedValue([]);

    renderWithRouter(<PipelineDetailPage />);

    // Phases render expanded, so the gate is visible without a click.
    expect(await screen.findByText(/can't start this phase until they finish Classroom/)).toBeInTheDocument();
  });

  it('hides the Required toggle for members without training.manage', async () => {
    mockHasPermission = false;
    mockGetProgramPhases.mockResolvedValue([
      {
        id: 'ph-1',
        program_id: 'prog-1',
        phase_number: 1,
        name: 'Basics',
        requires_manual_advancement: false,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ]);
    mockGetProgramRequirements.mockResolvedValue([
      {
        id: 'pr-1',
        program_id: 'prog-1',
        phase_id: 'ph-1',
        requirement_id: 'req-1',
        is_required: true,
        is_prerequisite: false,
        sort_order: 0,
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

    const ava = await within(dialog).findByRole('button', { name: /Ava Recruit/ });
    expect(ava).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(ava);
    expect(ava).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(within(dialog).getByRole('button', { name: /Enroll 1 Member/i }));

    await waitFor(() =>
      expect(mockBulkEnrollMembers).toHaveBeenCalledWith('prog-1', {
        user_ids: ['u1'],
        target_completion_date: undefined,
      })
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
      expect(mockUpdateProgram).toHaveBeenCalledWith('prog-1', expect.objectContaining({ name: 'Renamed Pipeline' }))
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
        expect.objectContaining({ name: 'Orientation', phase_number: 1 })
      )
    );
  });

  it('deletes a phase after confirmation', async () => {
    mockGetProgramPhases.mockResolvedValue([
      {
        id: 'ph-1',
        program_id: 'prog-1',
        phase_number: 1,
        name: 'Basics',
        requires_manual_advancement: false,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ]);
    renderWithRouter(<PipelineDetailPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Delete phase' }));
    // Confirm dialog appears; confirm the deletion (scoped to the dialog).
    const confirmDialog = await screen.findByRole('dialog');
    await userEvent.click(within(confirmDialog).getByRole('button', { name: /^Delete$/ }));

    await waitFor(() => expect(mockDeleteProgramPhase).toHaveBeenCalledWith('prog-1', 'ph-1'));
  });

  it('hard-deletes a pipeline nobody has graduated from after a warning and navigates away', async () => {
    const success = vi.spyOn(toast, 'success');
    renderWithRouter(<PipelineDetailPage />);

    await userEvent.click(await screen.findByRole('button', { name: /^Delete$/ }));
    // A warning dialog appears; confirm the destructive action.
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Permanently delete "Recruit Pipeline"?');
    expect(dialog).toHaveTextContent('1 enrolled member — their progress will be permanently deleted');
    // Decided from every enrollment, not the Enrollments tab's status filter.
    expect(mockGetProgramEnrollments).toHaveBeenLastCalledWith('prog-1');
    await userEvent.click(within(dialog).getByRole('button', { name: /Delete pipeline/i }));

    await waitFor(() => expect(mockDeleteProgram).toHaveBeenCalledWith('prog-1'));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/training/programs'));
    expect(success).toHaveBeenCalledWith('Pipeline deleted');
    success.mockRestore();
  });

  it('says a pipeline with graduates is deactivated instead, and who is withdrawn', async () => {
    mockGetProgramEnrollments.mockResolvedValue([
      enrollment,
      { ...enrollment, id: 'enr-2', user_id: 'user-8', user_name: 'Sam Graduate', status: 'completed' },
    ]);
    const success = vi.spyOn(toast, 'success');
    renderWithRouter(<PipelineDetailPage />);

    await userEvent.click(await screen.findByRole('button', { name: /^Delete$/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Deactivate pipeline' });
    expect(dialog).toHaveTextContent('"Recruit Pipeline" has 1 graduate, so it is deactivated instead of deleted');
    expect(dialog).toHaveTextContent('The 1 member still in progress will be withdrawn from it.');
    expect(dialog).not.toHaveTextContent('Permanently delete');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate pipeline' }));

    await waitFor(() => expect(mockDeleteProgram).toHaveBeenCalledWith('prog-1'));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/training/programs'));
    expect(success).toHaveBeenCalledWith('Pipeline deactivated');
    success.mockRestore();
  });

  it('shows a member in another program as eligible with an advisory', async () => {
    mockGetEnrollmentEligibility.mockResolvedValue([
      {
        user_id: 'u3',
        first_name: 'Cy',
        last_name: 'Onboarding',
        eligible: true,
        status: 'concurrent',
        reason: 'Also enrolled in another program',
      },
    ]);

    renderWithRouter(<PipelineDetailPage />);
    await userEvent.click(await screen.findByRole('button', { name: /^Enroll$/i }));
    const dialog = await screen.findByRole('dialog');

    // Selectable (eligible) and the advisory is shown; not hidden by the filter.
    const row = await within(dialog).findByText('Cy Onboarding');
    expect(row).toBeInTheDocument();
    expect(within(dialog).getByText('Also enrolled in another program')).toBeInTheDocument();
    expect(within(dialog).getByText('1 of 1 eligible')).toBeInTheDocument();
  });

  it('resets a single requirement to start a new cycle', async () => {
    // A requirement mid-cycle (completed) so the Reset control is offered.
    mockGetEnrollmentProgress.mockResolvedValue({
      enrollment,
      program,
      requirement_progress: [{ ...certProgress, status: 'completed', progress_percentage: 100 }],
      completed_requirements: 1,
      total_requirements: 1,
      next_milestones: [],
      is_behind_schedule: false,
    });

    renderWithRouter(<PipelineDetailPage />);
    await userEvent.click(await screen.findByRole('tab', { name: /Enrollments/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Manage progress for Jane Recruit/i }));

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('CPR Certification')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: /^Reset$/i }));

    // Resetting clears accumulated progress, so it asks first.
    const confirmDialog = await screen.findByRole('dialog', { name: /Reset this requirement/i });
    await userEvent.click(within(confirmDialog).getByRole('button', { name: /^Reset$/i }));

    await waitFor(() => expect(mockResetProgress).toHaveBeenCalledWith('prog-rec-1'));
    // Progress is re-fetched so the row reflects the cleared state.
    await waitFor(() => expect(mockGetEnrollmentProgress).toHaveBeenCalledTimes(2));
  });

  it('resets the whole enrollment for a new recert cycle', async () => {
    renderWithRouter(<PipelineDetailPage />);
    await userEvent.click(await screen.findByRole('tab', { name: /Enrollments/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Manage progress for Jane Recruit/i }));

    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /Start new cycle/i }));

    const confirmDialog = await screen.findByRole('dialog', { name: /Start a new cycle/i });
    await userEvent.click(within(confirmDialog).getByRole('button', { name: /Start new cycle/i }));

    await waitFor(() => expect(mockResetEnrollment).toHaveBeenCalledWith('enr-1'));
  });

  it('shows the scheduled auto-reset date in the progress modal', async () => {
    mockGetEnrollmentProgress.mockResolvedValue({
      enrollment: { ...enrollment, next_recert_reset_at: '2028-03-30' },
      program,
      requirement_progress: [certProgress],
      completed_requirements: 0,
      total_requirements: 1,
      next_milestones: [],
      is_behind_schedule: false,
    });

    renderWithRouter(<PipelineDetailPage />);
    await userEvent.click(await screen.findByRole('tab', { name: /Enrollments/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Manage progress for Jane Recruit/i }));

    const dialog = await screen.findByRole('dialog');
    // The date renders without a timezone shift (built from Y-M-D at local midnight).
    expect(await within(dialog).findByText(/Auto-resets/i)).toBeInTheDocument();
    expect(within(dialog).getByText('3/30/2028')).toBeInTheDocument();
  });

  it('shows the officer each requirement’s due date and whether it is overdue', async () => {
    mockGetEnrollmentProgress.mockResolvedValue({
      enrollment,
      program,
      requirement_progress: [{ ...certProgress, due_date: '2026-03-03', is_overdue: true }],
      completed_requirements: 0,
      total_requirements: 1,
      next_milestones: [],
      is_behind_schedule: false,
    });

    renderWithRouter(<PipelineDetailPage />);
    await userEvent.click(await screen.findByRole('tab', { name: /Enrollments/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Manage progress for Jane Recruit/i }));

    const dialog = await screen.findByRole('dialog');
    // A calendar date prints as written, whatever the viewer's zone.
    expect(await within(dialog).findByText(/Overdue — was due 3\/3\/2026/)).toBeInTheDocument();
  });

  it('configures a recertification cycle from the Edit modal', async () => {
    renderWithRouter(<PipelineDetailPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: /Edit pipeline details/i });

    await userEvent.click(within(dialog).getByLabelText(/Recertification cycle/i));
    const interval = within(dialog).getByLabelText(/Cycle length/i);
    await userEvent.clear(interval);
    await userEvent.type(interval, '24');
    await userEvent.selectOptions(within(dialog).getByLabelText(/Reset month/i), '3');
    await userEvent.type(within(dialog).getByLabelText(/Reset day/i), '30');
    await userEvent.click(within(dialog).getByRole('button', { name: /^Save$/i }));

    await waitFor(() =>
      expect(mockUpdateProgram).toHaveBeenCalledWith(
        'prog-1',
        expect.objectContaining({
          recert_enabled: true,
          recert_interval_months: 24,
          recert_anchor_month: 3,
          recert_anchor_day: 30,
        })
      )
    );
  });
});

describe('PipelineDetailPage — requirements outside any phase', () => {
  const programLevelLink = {
    id: 'pr-flat',
    program_id: 'prog-1',
    phase_id: null,
    requirement_id: 'req-ce',
    is_required: true,
    is_prerequisite: false,
    sort_order: 0,
    owns_requirement: true,
    created_at: '2026-01-01T00:00:00Z',
    requirement: {
      id: 'req-ce',
      name: 'Annual CE Hours',
      requirement_type: 'hours',
      required_hours: 24,
    },
  };

  beforeEach(() => {
    mockListShiftEvaluationTemplates.mockReset();
    mockListShiftEvaluationTemplates.mockResolvedValue([]);
    vi.clearAllMocks();
    mockHasPermission = true;
    mockGetProgram.mockResolvedValue({ ...program, structure_type: 'flexible' });
    mockGetProgramPhases.mockResolvedValue([]);
    mockGetProgramRequirements.mockResolvedValue([programLevelLink]);
    mockGetProgramEnrollments.mockResolvedValue([]);
  });

  it('renders a requirement that belongs to the program rather than a phase', async () => {
    // A flexible pipeline has no phases at all, so its requirements only ever
    // appear here — the page used to render phase requirements exclusively and
    // showed such a program as empty.
    renderWithRouter(<PipelineDetailPage />);

    expect(await screen.findByText('Requirements outside any phase')).toBeInTheDocument();
    expect(await screen.findByText('Annual CE Hours')).toBeInTheDocument();
  });

  it('offers an officer a way to add one', async () => {
    renderWithRouter(<PipelineDetailPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Add requirement/i }));

    expect(await screen.findByRole('dialog', { name: /Add requirement/i })).toBeInTheDocument();
  });
});

describe('PipelineDetailPage — an inactive requirement', () => {
  const link = (id: string, name: string, active: boolean) => ({
    id: `pr-${id}`,
    program_id: 'prog-1',
    phase_id: null,
    requirement_id: id,
    is_required: true,
    is_prerequisite: false,
    sort_order: 0,
    owns_requirement: true,
    created_at: '2026-01-01T00:00:00Z',
    requirement: { id, name, requirement_type: 'hours', required_hours: 4, active },
  });

  beforeEach(() => {
    mockListShiftEvaluationTemplates.mockReset();
    mockListShiftEvaluationTemplates.mockResolvedValue([]);
    vi.clearAllMocks();
    mockHasPermission = true;
    mockGetProgram.mockReset();
    mockGetProgram.mockResolvedValue({ ...program, structure_type: 'flexible' });
    mockGetProgramPhases.mockReset();
    mockGetProgramPhases.mockResolvedValue([]);
    mockGetProgramRequirements.mockReset();
    mockGetProgramRequirements.mockResolvedValue([
      link('req-live', 'Hazmat Awareness', true),
      link('req-retired', 'Legacy Decon Drill', false),
    ]);
    mockGetProgramEnrollments.mockReset();
    mockGetProgramEnrollments.mockResolvedValue([]);
  });

  it('is listed as not currently required and left out of the required count', async () => {
    renderWithRouter(<PipelineDetailPage />);

    expect(await screen.findByText('Legacy Decon Drill')).toBeInTheDocument();
    expect(screen.getByText('Hazmat Awareness')).toBeInTheDocument();
    // One of the two is inactive, so exactly one is labelled, and only the
    // active one counts as required.
    expect(screen.getAllByText('Inactive — not currently required')).toHaveLength(1);
    expect(screen.getByText('1 required')).toBeInTheDocument();
  });
});

describe('PipelineDetailPage — checklist sign-off and expiry', () => {
  const checklistProgress = {
    id: 'rp-check',
    enrollment_id: 'enr-1',
    requirement_id: 'req-check',
    status: 'in_progress',
    progress_value: 1,
    progress_percentage: 50,
    progress_notes: { checklist_done: ['s1'] },
    created_at: '',
    updated_at: '',
    requirement: {
      id: 'req-check',
      name: 'Station Orientation',
      requirement_type: 'checklist',
      checklist_items: [
        { id: 's1', text: 'Station tour', member_visible: true },
        { id: 's2', text: 'References called', member_visible: false },
      ],
    },
  };

  beforeEach(() => {
    mockListShiftEvaluationTemplates.mockReset();
    mockListShiftEvaluationTemplates.mockResolvedValue([]);
    vi.clearAllMocks();
    mockHasPermission = true;
    mockGetProgram.mockResolvedValue(program);
    mockGetProgramPhases.mockResolvedValue([]);
    mockGetProgramRequirements.mockResolvedValue([]);
    mockGetProgramEnrollments.mockResolvedValue([enrollment]);
    mockGetEnrollmentProgress.mockResolvedValue({
      enrollment,
      program,
      requirement_progress: [checklistProgress],
      completed_requirements: 0,
      total_requirements: 1,
      next_milestones: [],
      is_behind_schedule: false,
    });
  });

  const openProgress = async () => {
    renderWithRouter(<PipelineDetailPage />);
    await userEvent.click(await screen.findByRole('tab', { name: /Enrollments/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Manage progress for Jane Recruit/i }));
    return screen.findByRole('dialog');
  };

  it('ticks one step at a time, sending the whole set', async () => {
    const dialog = await openProgress();

    // 's1' is already ticked; checking 's2' sends both, not just the change —
    // an idempotent write, so a retry cannot half-apply it.
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /References called/ }));

    await waitFor(() => expect(mockUpdateProgress).toHaveBeenCalledWith('rp-check', { checklist_done: ['s1', 's2'] }));
  });

  it('unticking a done step sends the set without it', async () => {
    const dialog = await openProgress();

    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Station tour/ }));

    await waitFor(() => expect(mockUpdateProgress).toHaveBeenCalledWith('rp-check', { checklist_done: [] }));
  });

  it('marks the officer-only step so nobody assumes the member can see it', async () => {
    const dialog = await openProgress();

    expect(within(dialog).getByText('References called')).toBeInTheDocument();
    expect(within(dialog).getByText(/Officer only/)).toBeInTheDocument();
  });

  it('offers a way out of an expired enrollment', async () => {
    mockGetEnrollmentProgress.mockResolvedValue({
      enrollment: { ...enrollment, status: 'expired', progress_percentage: 60 },
      program,
      requirement_progress: [checklistProgress],
      completed_requirements: 0,
      total_requirements: 1,
      next_milestones: [],
      is_behind_schedule: false,
    });

    const dialog = await openProgress();

    expect(within(dialog).getByText(/Deadline passed/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/New deadline/i), '2027-01-31');
    await userEvent.click(within(dialog).getByRole('button', { name: /Reopen enrollment/i }));

    await waitFor(() => expect(mockReopenEnrollment).toHaveBeenCalledWith('enr-1', '2027-01-31'));
  });

  it('shows no expiry banner on a healthy enrollment', async () => {
    const dialog = await openProgress();
    expect(within(dialog).queryByText(/Deadline passed/)).not.toBeInTheDocument();
  });
});

describe('PipelineDetailPage — enrollment rules', () => {
  beforeEach(() => {
    mockListShiftEvaluationTemplates.mockReset();
    mockListShiftEvaluationTemplates.mockResolvedValue([]);
    vi.clearAllMocks();
    mockHasPermission = true;
    mockGetProgram.mockReset();
    mockGetProgramPhases.mockReset();
    mockGetProgramPhases.mockResolvedValue([]);
    mockGetProgramRequirements.mockReset();
    mockGetProgramRequirements.mockResolvedValue([]);
    mockGetProgramEnrollments.mockReset();
    mockGetProgramEnrollments.mockResolvedValue([]);
  });

  it('names the prerequisite programs and says concurrency is flagged', async () => {
    mockGetProgram.mockResolvedValue({
      ...program,
      allows_concurrent_enrollment: false,
      prerequisite_program_ids: ['prog-a', 'prog-b'],
      prerequisite_programs: [
        { id: 'prog-a', name: 'Recruit School' },
        { id: 'prog-b', name: 'Hazmat Operations' },
      ],
    });
    renderWithRouter(<PipelineDetailPage />);

    expect(await screen.findByText('Recruit School, Hazmat Operations')).toBeInTheDocument();
    expect(screen.getByText('Not allowed — flagged when enrolling')).toBeInTheDocument();
  });

  it('labels an inactive prerequisite as not currently required rather than hiding it', async () => {
    mockGetProgram.mockResolvedValue({
      ...program,
      prerequisite_program_ids: ['prog-a', 'prog-b'],
      prerequisite_programs: [
        { id: 'prog-a', name: 'Recruit School', active: false },
        { id: 'prog-b', name: 'Hazmat Operations', active: true },
      ],
    });
    renderWithRouter(<PipelineDetailPage />);

    // The listing, in order, with the label right after the inactive one.
    expect(await screen.findByText(/Recruit School/)).toHaveTextContent(
      'Recruit School Inactive — not currently required, Hazmat Operations'
    );
    expect(screen.getAllByText('Inactive — not currently required')).toHaveLength(1);
  });

  it('says there are none and that concurrency is allowed', async () => {
    mockGetProgram.mockResolvedValue({ ...program, prerequisite_programs: [] });
    renderWithRouter(<PipelineDetailPage />);

    expect(await screen.findByText('Prerequisite programs:')).toBeInTheDocument();
    expect(screen.getByText('None')).toBeInTheDocument();
    expect(screen.getByText('Allowed')).toBeInTheDocument();
  });
});

// An inactive pipeline is opened from the list's "Show inactive" view. The
// header marks it and offers Reactivate, which restores the flag only: the
// dialog says withdrawn members are not re-enrolled.
describe('PipelineDetailPage — reactivating an inactive pipeline', () => {
  const inactiveProgram = { ...program, active: false };

  beforeEach(() => {
    mockListShiftEvaluationTemplates.mockReset();
    mockListShiftEvaluationTemplates.mockResolvedValue([]);
    vi.clearAllMocks();
    mockHasPermission = true;
    mockGetProgram.mockReset();
    mockGetProgram.mockResolvedValueOnce(inactiveProgram).mockResolvedValue(program);
    mockGetProgramPhases.mockReset();
    mockGetProgramPhases.mockResolvedValue([]);
    mockGetProgramRequirements.mockReset();
    mockGetProgramRequirements.mockResolvedValue([]);
    mockGetProgramEnrollments.mockReset();
    mockGetProgramEnrollments.mockResolvedValue([]);
    mockUpdateProgram.mockReset();
    mockUpdateProgram.mockResolvedValue(program);
  });

  const openReactivate = async () => {
    renderWithRouter(<PipelineDetailPage />);
    expect(await screen.findByText('Inactive')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reactivate' }));
    return screen.findByRole('dialog');
  };

  it('confirms, reactivates, reports it and reloads the pipeline', async () => {
    const success = vi.spyOn(toast, 'success');
    const dialog = await openReactivate();
    expect(dialog).toHaveTextContent('Reactivate "Recruit Pipeline"?');
    expect(dialog).toHaveTextContent('Members who were withdrawn when it was deactivated are not re-enrolled');
    expect(mockUpdateProgram).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Reactivate' }));

    await waitFor(() => expect(mockUpdateProgram).toHaveBeenCalledWith('prog-1', { active: true }));
    await waitFor(() => expect(success).toHaveBeenCalledWith('Recruit Pipeline reactivated'));
    await waitFor(() => expect(screen.queryByText('Inactive')).not.toBeInTheDocument());
    expect(mockGetProgram).toHaveBeenCalledTimes(2);
  });

  it("shows the server's reason when reactivation fails", async () => {
    const success = vi.spyOn(toast, 'success');
    const error = vi.spyOn(toast, 'error');
    mockUpdateProgram.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 404'), {
        isAxiosError: true,
        response: { status: 404, data: { detail: 'Training program not found' } },
      })
    );
    const dialog = await openReactivate();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reactivate' }));

    await waitFor(() => expect(error).toHaveBeenCalledWith('Training program not found'));
    expect(success).not.toHaveBeenCalled();
  });

  it('is not offered without training.manage, nor on an active pipeline', async () => {
    mockHasPermission = false;
    const { unmount } = renderWithRouter(<PipelineDetailPage />);
    expect(await screen.findByText('Inactive')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reactivate' })).not.toBeInTheDocument();
    unmount();

    mockHasPermission = true;
    renderWithRouter(<PipelineDetailPage />);
    // The name is in the trail as well as the heading, so ask for the heading.
    expect(await screen.findByRole('heading', { level: 1, name: /Recruit Pipeline/ })).toBeInTheDocument();
    expect(screen.queryByText('Inactive')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reactivate' })).not.toBeInTheDocument();
  });
});

describe('PipelineDetailPage — no active requirements', () => {
  // Every required item in this pipeline is inactive. The server completes
  // nobody for finishing an empty set, and the page says so rather than
  // showing a percentage that measures nothing.
  const phase1 = {
    id: 'ph-1',
    program_id: 'prog-1',
    phase_number: 1,
    name: 'Awareness',
    requires_manual_advancement: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
  const phase2 = { ...phase1, id: 'ph-2', phase_number: 2, name: 'Operations' };
  const retired = {
    id: 'pr-retired',
    program_id: 'prog-1',
    phase_id: 'ph-1',
    requirement_id: 'req-retired',
    is_required: true,
    is_prerequisite: false,
    sort_order: 0,
    owns_requirement: true,
    created_at: '2026-01-01T00:00:00Z',
    requirement: { id: 'req-retired', name: 'Legacy Decon Drill', requirement_type: 'certification', active: false },
  };
  const runningEnrollment = { ...enrollment, current_phase_id: 'ph-1', progress_percentage: 60 };
  const progress = {
    enrollment: runningEnrollment,
    program,
    current_phase: phase1,
    requirement_progress: [
      {
        ...certProgress,
        id: 'rp-retired',
        requirement_id: 'req-retired',
        status: 'in_progress',
        progress_percentage: 60,
        // The server sends no date for an inactive requirement.
        due_date: null,
        is_overdue: false,
        requirement: retired.requirement,
      },
    ],
    completed_requirements: 0,
    total_requirements: 0,
    next_milestones: [],
    is_behind_schedule: false,
    no_active_requirements: true,
    phases_without_active_requirements: ['ph-1'],
  };

  beforeEach(() => {
    mockListShiftEvaluationTemplates.mockReset();
    mockListShiftEvaluationTemplates.mockResolvedValue([]);
    vi.clearAllMocks();
    mockHasPermission = true;
    mockGetProgram.mockReset();
    mockGetProgram.mockResolvedValue({ ...program, no_active_requirements: true });
    mockGetProgramPhases.mockReset();
    mockGetProgramPhases.mockResolvedValue([phase1, phase2]);
    mockGetProgramRequirements.mockReset();
    mockGetProgramRequirements.mockResolvedValue([retired]);
    mockGetProgramEnrollments.mockReset();
    mockGetProgramEnrollments.mockResolvedValue([
      runningEnrollment,
      { ...enrollment, id: 'enr-2', user_name: 'Sam Graduate', status: 'completed', progress_percentage: 100 },
    ]);
    mockGetEnrollmentProgress.mockReset();
    mockGetEnrollmentProgress.mockResolvedValue(progress);
    mockAdvancePhase.mockReset();
    mockAdvancePhase.mockResolvedValue({ ...runningEnrollment, current_phase_id: 'ph-2' });
  });

  it('tells the officer nobody completes it automatically, for the pipeline and the phase', async () => {
    renderWithRouter(<PipelineDetailPage />);

    expect(await screen.findByText('Legacy Decon Drill')).toBeInTheDocument();
    expect(screen.getAllByText('No active requirements')).toHaveLength(2);
    expect(screen.getByText(/no member is completed automatically/)).toBeInTheDocument();
    expect(screen.getByText(/Advance members by hand, or reactivate a requirement/)).toBeInTheDocument();
    expect(screen.getByText('0 required')).toBeInTheDocument();
  });

  it('lists a running member without a percentage, and a graduate with theirs', async () => {
    renderWithRouter(<PipelineDetailPage />);

    await userEvent.click(await screen.findByRole('tab', { name: /Enrollments/i }));
    const running = await screen.findByRole('button', { name: /Manage progress for Jane Recruit/i });
    expect(within(running).getByText('No active requirements')).toBeInTheDocument();
    expect(within(running).queryByText(/% complete/)).not.toBeInTheDocument();
    const graduate = screen.getByRole('button', { name: /Manage progress for Sam Graduate/i });
    expect(within(graduate).getByText('100% complete')).toBeInTheDocument();
  });

  it('says so in the member’s progress and advances them by hand out of the empty phase', async () => {
    renderWithRouter(<PipelineDetailPage />);

    await userEvent.click(await screen.findByRole('tab', { name: /Enrollments/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Manage progress for Jane Recruit/i }));
    const dialog = await screen.findByRole('dialog');

    expect(await within(dialog).findByText(/Phase 1: Awareness/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/% overall/)).not.toBeInTheDocument();
    expect(within(dialog).getAllByText('No active requirements').length).toBeGreaterThanOrEqual(2);
    expect(within(dialog).queryByLabelText('Phase complete')).not.toBeInTheDocument();
    // The inactive requirement carries the badge and no date.
    expect(within(dialog).getByText('Inactive — not currently required')).toBeInTheDocument();
    expect(within(dialog).queryByText(/Due |was due|Overdue/)).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: /Advance to next phase/i }));
    await waitFor(() => expect(mockAdvancePhase).toHaveBeenCalledWith('enr-1', true));
  });
});

describe('PipelineDetailPage — mark pipeline complete', () => {
  // An officer completes a member's whole enrollment by hand. Offered only to
  // training.manage, only on an active or on-hold enrollment, and only with a
  // reason; the server decides the rest.
  const graduate = {
    ...enrollment,
    id: 'enr-2',
    user_name: 'Sam Graduate',
    status: 'completed',
    progress_percentage: 100,
  };
  const paused = { ...enrollment, id: 'enr-3', user_name: 'Pat Paused', status: 'on_hold' };
  const progressFor = (e: typeof enrollment) => ({
    enrollment: e,
    program,
    requirement_progress: [certProgress],
    completed_requirements: 0,
    total_requirements: 1,
    next_milestones: [],
    is_behind_schedule: false,
  });

  beforeEach(() => {
    mockListShiftEvaluationTemplates.mockReset();
    mockListShiftEvaluationTemplates.mockResolvedValue([]);
    vi.clearAllMocks();
    vi.restoreAllMocks();
    mockHasPermission = true;
    mockGetProgram.mockReset();
    mockGetProgram.mockResolvedValue(program);
    mockGetProgramPhases.mockReset();
    mockGetProgramPhases.mockResolvedValue([]);
    mockGetProgramRequirements.mockReset();
    mockGetProgramRequirements.mockResolvedValue([]);
    mockGetProgramEnrollments.mockReset();
    mockGetProgramEnrollments.mockResolvedValue([enrollment, graduate, paused]);
    mockGetEnrollmentProgress.mockReset();
    mockGetEnrollmentProgress.mockResolvedValue(progressFor(enrollment));
    mockCompleteEnrollment.mockReset();
    mockCompleteEnrollment.mockResolvedValue({ ...enrollment, status: 'completed' });
  });

  afterEach(() => {
    // Back to the blanket grant the other blocks assume.
    mockPermissions = null;
  });

  const openEnrollments = async () => {
    renderWithRouter(<PipelineDetailPage />);
    await userEvent.click(await screen.findByRole('tab', { name: /Enrollments/i }));
    await screen.findByRole('button', { name: /Manage progress for Jane Recruit/i });
  };

  it('offers it on active and on-hold enrollments in the list, not on a finished one', async () => {
    await openEnrollments();

    expect(screen.getByRole('button', { name: 'Mark pipeline complete for Jane Recruit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark pipeline complete for Pat Paused' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark pipeline complete for Sam Graduate' })).not.toBeInTheDocument();
  });

  it('is not offered to a viewer without training.manage', async () => {
    // training.view_all reaches the list and the progress dialog, not the action.
    mockPermissions = ['training.view_all'];
    await openEnrollments();

    expect(screen.queryByRole('button', { name: /Mark pipeline complete/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Manage progress for Jane Recruit/i }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('CPR Certification')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Mark pipeline complete/i })).not.toBeInTheDocument();
  });

  it('is in the member’s progress dialog for a running enrollment only', async () => {
    mockGetEnrollmentProgress.mockResolvedValueOnce(progressFor(enrollment));
    mockGetEnrollmentProgress.mockResolvedValueOnce(progressFor(graduate));
    await openEnrollments();

    await userEvent.click(screen.getByRole('button', { name: /Manage progress for Jane Recruit/i }));
    let dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('button', { name: 'Mark pipeline complete' })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));

    await userEvent.click(screen.getByRole('button', { name: /Manage progress for Sam Graduate/i }));
    dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('CPR Certification')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Mark pipeline complete' })).not.toBeInTheDocument();
  });

  it('requires a reason before it calls the server', async () => {
    await openEnrollments();
    await userEvent.click(screen.getByRole('button', { name: 'Mark pipeline complete for Jane Recruit' }));
    const prompt = await screen.findByRole('dialog', { name: 'Mark pipeline complete?' });

    expect(within(prompt).getByText(/stays unmet on their record/)).toBeInTheDocument();
    await userEvent.type(within(prompt).getByLabelText('Reason'), '   ');
    await userEvent.click(within(prompt).getByRole('button', { name: 'Mark complete' }));

    expect(await within(prompt).findByText('Reason is required.')).toBeInTheDocument();
    expect(mockCompleteEnrollment).not.toHaveBeenCalled();
  });

  it('completes from the list with the trimmed reason, then reloads the list', async () => {
    const success = vi.spyOn(toast, 'success');
    await openEnrollments();
    mockGetProgramEnrollments.mockClear();

    await userEvent.click(screen.getByRole('button', { name: 'Mark pipeline complete for Jane Recruit' }));
    const prompt = await screen.findByRole('dialog', { name: 'Mark pipeline complete?' });
    await userEvent.type(within(prompt).getByLabelText('Reason'), '  Chief signed off  ');
    await userEvent.click(within(prompt).getByRole('button', { name: 'Mark complete' }));

    await waitFor(() => expect(mockCompleteEnrollment).toHaveBeenCalledWith('enr-1', 'Chief signed off'));
    await waitFor(() => expect(success).toHaveBeenCalledWith('Jane Recruit marked complete'));
    await waitFor(() => expect(mockGetProgramEnrollments).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Mark pipeline complete?' })).not.toBeInTheDocument()
    );
  });

  it('completes from the progress dialog and re-fetches the member’s progress', async () => {
    await openEnrollments();
    await userEvent.click(screen.getByRole('button', { name: /Manage progress for Jane Recruit/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Mark pipeline complete' }));
    mockGetEnrollmentProgress.mockClear();
    mockGetProgramEnrollments.mockClear();

    const prompt = await screen.findByRole('dialog', { name: 'Mark pipeline complete?' });
    await userEvent.type(within(prompt).getByLabelText('Reason'), 'Retired pipeline');
    await userEvent.click(within(prompt).getByRole('button', { name: 'Mark complete' }));

    await waitFor(() => expect(mockCompleteEnrollment).toHaveBeenCalledWith('enr-1', 'Retired pipeline'));
    await waitFor(() => expect(mockGetEnrollmentProgress).toHaveBeenCalledWith('enr-1'));
    await waitFor(() => expect(mockGetProgramEnrollments).toHaveBeenCalled());
  });

  it('shows the server’s refusal and keeps the prompt open', async () => {
    const error = vi.spyOn(toast, 'error');
    mockCompleteEnrollment.mockRejectedValue({
      isAxiosError: true,
      message: 'Request failed with status code 409',
      response: { status: 409, data: { detail: 'This enrollment is already complete' } },
    });
    await openEnrollments();

    await userEvent.click(screen.getByRole('button', { name: 'Mark pipeline complete for Jane Recruit' }));
    const prompt = await screen.findByRole('dialog', { name: 'Mark pipeline complete?' });
    await userEvent.type(within(prompt).getByLabelText('Reason'), 'Chief signed off');
    await userEvent.click(within(prompt).getByRole('button', { name: 'Mark complete' }));

    await waitFor(() => expect(error).toHaveBeenCalledWith('This enrollment is already complete'));
    expect(screen.getByRole('dialog', { name: 'Mark pipeline complete?' })).toBeInTheDocument();
  });
});

describe('PipelineDetailPage — progress dialog actions need training.manage', () => {
  // Advance, start-new-cycle and reopen all require training.manage on the
  // server, so a viewer who can open the dialog is not offered them.
  const progressFor = (status: string) => ({
    enrollment: { ...enrollment, status },
    program,
    requirement_progress: [certProgress],
    completed_requirements: 0,
    total_requirements: 1,
    next_milestones: [],
    is_behind_schedule: false,
  });

  beforeEach(() => {
    mockListShiftEvaluationTemplates.mockReset();
    mockListShiftEvaluationTemplates.mockResolvedValue([]);
    vi.clearAllMocks();
    mockHasPermission = true;
    mockPermissions = null;
    mockGetProgram.mockReset();
    mockGetProgram.mockResolvedValue(program);
    mockGetProgramPhases.mockReset();
    mockGetProgramPhases.mockResolvedValue([]);
    mockGetProgramRequirements.mockReset();
    mockGetProgramRequirements.mockResolvedValue([]);
    mockGetProgramEnrollments.mockReset();
    mockGetProgramEnrollments.mockResolvedValue([enrollment]);
    mockGetEnrollmentProgress.mockReset();
    mockGetEnrollmentProgress.mockResolvedValue(progressFor('active'));
  });

  afterEach(() => {
    mockPermissions = null;
  });

  const openDialog = async () => {
    renderWithRouter(<PipelineDetailPage />);
    await userEvent.click(await screen.findByRole('tab', { name: /Enrollments/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Manage progress for Jane Recruit/i }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('CPR Certification');
    return dialog;
  };

  it('offers an officer the cycle reset', async () => {
    const dialog = await openDialog();
    expect(within(dialog).getByRole('button', { name: /Start new cycle/i })).toBeInTheDocument();
  });

  it('offers a viewer none of the officer actions', async () => {
    mockPermissions = ['training.view_all'];
    const dialog = await openDialog();

    expect(within(dialog).queryByRole('button', { name: /Start new cycle/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Advance to next phase/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Mark pipeline complete/i })).not.toBeInTheDocument();
  });

  it('tells a viewer an enrollment expired without offering to reopen it', async () => {
    mockPermissions = ['training.view_all'];
    mockGetEnrollmentProgress.mockResolvedValue(progressFor('expired'));
    const dialog = await openDialog();

    expect(within(dialog).getByText(/Deadline passed/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Reopen enrollment/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/New deadline/i)).not.toBeInTheDocument();
  });
});

describe('PipelineDetailPage — a pipeline completed by hand', () => {
  // The officer's reason is an officer note: shown to training.manage on a
  // completed enrollment that carries one, and to nobody else.
  const byHand = {
    ...enrollment,
    id: 'enr-4',
    user_name: 'Chris ByHand',
    status: 'completed',
    progress_percentage: 50,
    completion_reason: "Chief's call after the live burn",
  };
  const automatic = {
    ...enrollment,
    id: 'enr-5',
    user_name: 'Alex Automatic',
    status: 'completed',
    progress_percentage: 100,
    completion_reason: null,
  };
  const NOTE = "Completed by hand: Chief's call after the live burn";
  const progressFor = (e: typeof byHand | typeof automatic) => ({
    enrollment: e,
    program,
    requirement_progress: [certProgress],
    completed_requirements: 0,
    total_requirements: 1,
    next_milestones: [],
    is_behind_schedule: false,
  });

  beforeEach(() => {
    mockListShiftEvaluationTemplates.mockReset();
    mockListShiftEvaluationTemplates.mockResolvedValue([]);
    vi.clearAllMocks();
    mockHasPermission = true;
    mockPermissions = null;
    mockGetProgram.mockReset();
    mockGetProgram.mockResolvedValue(program);
    mockGetProgramPhases.mockReset();
    mockGetProgramPhases.mockResolvedValue([]);
    mockGetProgramRequirements.mockReset();
    mockGetProgramRequirements.mockResolvedValue([]);
    mockGetProgramEnrollments.mockReset();
    mockGetProgramEnrollments.mockResolvedValue([byHand, automatic]);
    mockGetEnrollmentProgress.mockReset();
    mockGetEnrollmentProgress.mockResolvedValue(progressFor(byHand));
  });

  afterEach(() => {
    mockPermissions = null;
  });

  const openEnrollments = async () => {
    renderWithRouter(<PipelineDetailPage />);
    await userEvent.click(await screen.findByRole('tab', { name: /Enrollments/i }));
    await screen.findByRole('button', { name: /Manage progress for Chris ByHand/i });
  };

  const openDialogFor = async (name: string) => {
    await openEnrollments();
    await userEvent.click(screen.getByRole('button', { name: `Manage progress for ${name}` }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('CPR Certification');
    return dialog;
  };

  it('shows an officer the reason in the enrollment list, only on the by-hand row', async () => {
    await openEnrollments();

    const byHandRow = screen.getByRole('button', { name: 'Manage progress for Chris ByHand' });
    expect(within(byHandRow).getByText(NOTE)).toBeInTheDocument();
    const automaticRow = screen.getByRole('button', { name: 'Manage progress for Alex Automatic' });
    expect(within(automaticRow).queryByText(/Completed by hand/)).not.toBeInTheDocument();
  });

  it('shows an officer the reason in the progress dialog header', async () => {
    const dialog = await openDialogFor('Chris ByHand');

    expect(within(dialog).getByText(NOTE)).toBeInTheDocument();
  });

  it('shows nothing in the dialog for an automatic completion', async () => {
    mockGetEnrollmentProgress.mockResolvedValue(progressFor(automatic));
    const dialog = await openDialogFor('Alex Automatic');

    expect(within(dialog).queryByText(/Completed by hand/)).not.toBeInTheDocument();
  });

  it('shows a viewer without training.manage no reason, in the list or the dialog', async () => {
    mockPermissions = ['training.view_all'];
    const dialog = await openDialogFor('Chris ByHand');

    expect(screen.queryAllByText(/Completed by hand/)).toHaveLength(0);
    expect(within(dialog).queryByText(/Completed by hand/)).not.toBeInTheDocument();
  });
});
