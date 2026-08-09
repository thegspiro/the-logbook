import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import MyProgramProgressPage from './MyProgramProgressPage';

const mockGetEnrollmentProgress = vi.fn();
const mockGetProgramPhases = vi.fn();
const mockGetProgramRequirements = vi.fn();
const mockWithdrawEnrollment = vi.fn();

vi.mock('../services/api', () => ({
  trainingProgramService: {
    getEnrollmentProgress: (...a: unknown[]) => mockGetEnrollmentProgress(...a) as unknown,
    getProgramPhases: (...a: unknown[]) => mockGetProgramPhases(...a) as unknown,
    getProgramRequirements: (...a: unknown[]) => mockGetProgramRequirements(...a) as unknown,
    withdrawEnrollment: (...a: unknown[]) => mockWithdrawEnrollment(...a) as unknown,
  },
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));
vi.mock('../utils/dateFormatting', () => ({ formatDate: (d: string) => d || 'N/A' }));

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ enrollmentId: 'enr-1' }),
  };
});

describe('MyProgramProgressPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEnrollmentProgress.mockResolvedValue({
      enrollment: {
        id: 'enr-1',
        current_phase_id: 'ph-1',
        progress_percentage: 50,
        enrolled_at: '2026-02-01T00:00:00Z',
        status: 'active',
      },
      program: { id: 'prog-1', name: 'Recruit School' },
      current_phase: { id: 'ph-1', phase_number: 1, name: 'Basics' },
      requirement_progress: [
        {
          id: 'rp-1',
          requirement_id: 'req-1',
          status: 'completed',
          progress_percentage: 100,
          requirement: { id: 'req-1', name: 'Hose Ops' },
        },
        {
          id: 'rp-2',
          requirement_id: 'req-2',
          status: 'in_progress',
          progress_value: 12,
          progress_percentage: 50,
          requirement: { id: 'req-2', name: 'Ladder Ops', requirement_type: 'hours', required_hours: 24 },
        },
      ],
      completed_requirements: 1,
      total_requirements: 2,
      next_milestones: [],
      is_behind_schedule: false,
    });
    mockGetProgramPhases.mockResolvedValue([
      {
        id: 'ph-1',
        program_id: 'prog-1',
        phase_number: 1,
        name: 'Basics',
        requires_manual_advancement: false,
        created_at: '',
        updated_at: '',
      },
      {
        id: 'ph-2',
        program_id: 'prog-1',
        phase_number: 2,
        name: 'Advanced',
        requires_manual_advancement: false,
        created_at: '',
        updated_at: '',
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
        created_at: '',
      },
      {
        id: 'pr-2',
        program_id: 'prog-1',
        phase_id: 'ph-2',
        requirement_id: 'req-2',
        is_required: true,
        is_prerequisite: false,
        sort_order: 0,
        created_at: '',
      },
    ]);
    mockWithdrawEnrollment.mockResolvedValue({ id: 'enr-1', status: 'withdrawn' });
  });

  it('shows the program, current phase, and requirements grouped by phase', async () => {
    renderWithRouter(<MyProgramProgressPage />);

    expect(await screen.findByRole('heading', { name: 'Recruit School' })).toBeInTheDocument();
    expect(screen.getByText(/Phase 1 — Basics/)).toBeInTheDocument();
    // Requirements land under their phase headers.
    expect(screen.getByText(/Phase 1: Basics/)).toBeInTheDocument();
    expect(screen.getByText(/Phase 2: Advanced/)).toBeInTheDocument();
    expect(screen.getByText('Hose Ops')).toBeInTheDocument();
    expect(screen.getByText('Ladder Ops')).toBeInTheDocument();
    // Current-phase marker.
    expect(screen.getByText('You are here')).toBeInTheDocument();
  });

  it('shows the numeric target for a count-based requirement', async () => {
    renderWithRouter(<MyProgramProgressPage />);

    // "12 / 24 hrs" tells the student exactly what's left, not just a status.
    expect(await screen.findByText(/12 \/ 24 hrs/)).toBeInTheDocument();
  });

  it('shows an action hint on an incomplete requirement but not a completed one', async () => {
    renderWithRouter(<MyProgramProgressPage />);

    // The in-progress hours requirement (Ladder Ops) tells the student what to do.
    expect(await screen.findByText(/Attend training sessions to log hours/)).toBeInTheDocument();
    // The completed requirement (Hose Ops) has no action hint.
    expect(screen.queryByText(/Get signed off/)).not.toBeInTheDocument();
  });

  it('lets a member leave the program after confirming', async () => {
    renderWithRouter(<MyProgramProgressPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Leave program/i }));
    // Confirm dialog appears; confirm the withdrawal.
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /Leave program/i }));

    await waitFor(() => expect(mockWithdrawEnrollment).toHaveBeenCalledWith('enr-1'));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/training'));
  });

  it('hides the Leave button when the enrollment is not active', async () => {
    mockGetEnrollmentProgress.mockResolvedValue({
      enrollment: {
        id: 'enr-1',
        current_phase_id: 'ph-1',
        progress_percentage: 100,
        enrolled_at: '2026-02-01T00:00:00Z',
        status: 'completed',
      },
      program: { id: 'prog-1', name: 'Recruit School' },
      current_phase: { id: 'ph-1', phase_number: 1, name: 'Basics' },
      requirement_progress: [],
      completed_requirements: 0,
      total_requirements: 0,
      next_milestones: [],
      is_behind_schedule: false,
    });

    renderWithRouter(<MyProgramProgressPage />);

    expect(await screen.findByRole('heading', { name: 'Recruit School' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Leave program/i })).not.toBeInTheDocument();
  });
});

describe('MyProgramProgressPage — checklist steps', () => {
  const checklistRecord = {
    id: 'rp-check',
    enrollment_id: 'enr-1',
    requirement_id: 'req-check',
    status: 'in_progress',
    progress_value: 1,
    progress_percentage: 33,
    progress_notes: { checklist_done: ['s1'] },
    created_at: '',
    updated_at: '',
    requirement: {
      id: 'req-check',
      name: 'Station Orientation',
      requirement_type: 'checklist',
      checklist_items: [
        { id: 's1', text: 'Station tour', member_visible: true },
        { id: 's2', text: 'PPE issued', member_visible: true },
        { id: 's3', text: 'References called', member_visible: false },
      ],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEnrollmentProgress.mockResolvedValue({
      enrollment: {
        id: 'enr-1',
        current_phase_id: null,
        progress_percentage: 33,
        enrolled_at: '2026-02-01T00:00:00Z',
        status: 'active',
      },
      program: { id: 'prog-1', name: 'Recruit School' },
      current_phase: null,
      requirement_progress: [checklistRecord],
      completed_requirements: 0,
      total_requirements: 1,
      next_milestones: [],
      is_behind_schedule: false,
    });
    mockGetProgramPhases.mockResolvedValue([]);
    mockGetProgramRequirements.mockResolvedValue([
      {
        id: 'pr-check',
        program_id: 'prog-1',
        phase_id: null,
        requirement_id: 'req-check',
        is_required: true,
        is_prerequisite: false,
        sort_order: 0,
        created_at: '',
      },
    ]);
  });

  it('names the steps instead of leaving the member to guess', async () => {
    renderWithRouter(<MyProgramProgressPage />);

    expect(await screen.findByText('Station tour')).toBeInTheDocument();
    expect(screen.getByText('PPE issued')).toBeInTheDocument();
  });

  it('keeps an officer-only step off the page but still counts it', async () => {
    renderWithRouter(<MyProgramProgressPage />);

    await screen.findByText('Station tour');
    // The text of a hidden step is never rendered...
    expect(screen.queryByText('References called')).not.toBeInTheDocument();
    // ...but it is accounted for, so "1 / 3 steps" still adds up on screen.
    expect(screen.getByText(/1 more step your officer records/)).toBeInTheDocument();
    expect(screen.getByText(/1 \/ 3 steps/)).toBeInTheDocument();
  });
});

describe('MyProgramProgressPage — locked requirements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEnrollmentProgress.mockResolvedValue({
      enrollment: {
        id: 'enr-1',
        current_phase_id: null,
        progress_percentage: 0,
        enrolled_at: '2026-02-01T00:00:00Z',
        status: 'active',
      },
      program: { id: 'prog-1', name: 'Recruit School' },
      requirement_progress: [
        {
          id: 'rp-gate',
          requirement_id: 'req-gate',
          status: 'not_started',
          progress_percentage: 0,
          requirement: { id: 'req-gate', name: 'Orientation' },
        },
        {
          id: 'rp-locked',
          requirement_id: 'req-locked',
          status: 'not_started',
          progress_percentage: 0,
          requirement: { id: 'req-locked', name: 'Ride-Alongs' },
        },
      ],
      completed_requirements: 0,
      total_requirements: 2,
      next_milestones: [],
      is_behind_schedule: false,
      locked_requirements: { 'req-locked': ['Orientation'] },
    });
    mockGetProgramPhases.mockResolvedValue([]);
    mockGetProgramRequirements.mockResolvedValue([
      {
        id: 'pr-gate',
        program_id: 'prog-1',
        phase_id: null,
        requirement_id: 'req-gate',
        is_required: true,
        is_prerequisite: true,
        sort_order: 0,
        created_at: '',
      },
      {
        id: 'pr-locked',
        program_id: 'prog-1',
        phase_id: null,
        requirement_id: 'req-locked',
        is_required: true,
        is_prerequisite: false,
        sort_order: 1,
        created_at: '',
      },
    ]);
  });

  it('says what unlocks a gated requirement rather than hiding it', async () => {
    renderWithRouter(<MyProgramProgressPage />);

    // The step is still listed — a step that vanishes reads as a bug.
    expect(await screen.findByText('Ride-Alongs')).toBeInTheDocument();
    expect(screen.getByText(/Locked until you finish Orientation/)).toBeInTheDocument();
  });

  it('leaves the prerequisite itself open', async () => {
    renderWithRouter(<MyProgramProgressPage />);

    await screen.findByText('Orientation');
    // Exactly one of the two requirements is gated — the prerequisite is not
    // locked behind itself.
    expect(screen.getAllByText(/Locked until/)).toHaveLength(1);
  });
});
