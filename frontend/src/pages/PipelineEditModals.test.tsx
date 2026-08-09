/**
 * Covers the "Add requirement" modal's two routes: linking a requirement the
 * department already tracks, and defining a new program-specific one. The link
 * route is the reason this file exists — before it, a recruit phase could only
 * re-create a requirement like CPR, producing a duplicate that tracked
 * separately from the department's own.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const mockAddProgramRequirement = vi.fn();
const mockCreateRequirementEnhanced = vi.fn();
const mockGetRequirementsEnhanced = vi.fn();
const mockGetCourses = vi.fn();
const mockCreateProgramPhase = vi.fn();
const mockUpdateProgramPhase = vi.fn();
const mockUpdateProgram = vi.fn();

vi.mock('../services/api', () => ({
  trainingProgramService: {
    addProgramRequirement: (...a: unknown[]) => mockAddProgramRequirement(...a) as unknown,
    createRequirementEnhanced: (...a: unknown[]) => mockCreateRequirementEnhanced(...a) as unknown,
    getRequirementsEnhanced: (...a: unknown[]) => mockGetRequirementsEnhanced(...a) as unknown,
    createProgramPhase: (...a: unknown[]) => mockCreateProgramPhase(...a) as unknown,
    updateProgramPhase: (...a: unknown[]) => mockUpdateProgramPhase(...a) as unknown,
    updateProgram: (...a: unknown[]) => mockUpdateProgram(...a) as unknown,
  },
  trainingService: {
    getCourses: (...a: unknown[]) => mockGetCourses(...a) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

// Imported after the mocks so the modal picks them up.
import { EditProgramModal, PhaseFormModal, RequirementFormModal } from './PipelineEditModals';

const cprRequirement = {
  id: 'req-cpr',
  organization_id: 'org-1',
  name: 'CPR/BLS Certification',
  description: 'Maintain a current CPR/BLS provider certification',
  requirement_type: 'certification' as const,
  source: 'department' as const,
  frequency: 'biannual' as const,
  applies_to_all: true,
  due_date_type: 'calendar_period' as const,
  active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const hipaaRequirement = {
  ...cprRequirement,
  id: 'req-hipaa',
  name: 'HIPAA Privacy & Security Awareness',
  requirement_type: 'hours' as const,
  required_hours: 1,
  frequency: 'annual' as const,
};

const renderModal = (props: Partial<React.ComponentProps<typeof RequirementFormModal>> = {}) => {
  const onSaved = vi.fn();
  // The course picker inside the "new requirement" form renders a <Link>, so
  // the modal needs a router even though it owns no routes itself.
  renderWithRouter(
    <RequirementFormModal
      programId="prog-1"
      phaseId="phase-1"
      sortOrder={2}
      onClose={vi.fn()}
      onSaved={onSaved}
      {...props}
    />
  );
  return { onSaved };
};

describe('RequirementFormModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRequirementsEnhanced.mockResolvedValue([cprRequirement, hipaaRequirement]);
    mockGetCourses.mockResolvedValue([]);
    mockAddProgramRequirement.mockResolvedValue({ id: 'link-1' });
    mockCreateRequirementEnhanced.mockResolvedValue({ id: 'req-new' });
  });

  it('links an existing department requirement without creating a duplicate', async () => {
    const user = userEvent.setup();
    const { onSaved } = renderModal();

    await screen.findByLabelText(/CPR\/BLS Certification/);
    await user.click(screen.getByRole('radio', { name: /CPR\/BLS Certification/ }));
    await user.click(screen.getByRole('button', { name: 'Link requirement' }));

    await waitFor(() =>
      expect(mockAddProgramRequirement).toHaveBeenCalledWith('prog-1', {
        program_id: 'prog-1',
        phase_id: 'phase-1',
        requirement_id: 'req-cpr',
        is_required: true,
        sort_order: 2,
        owns_requirement: false,
      })
    );
    // The department's requirement is reused as-is, not cloned.
    expect(mockCreateRequirementEnhanced).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('blocks picking a requirement the program already has', async () => {
    renderModal({ linkedRequirementIds: ['req-cpr'] });

    const alreadyLinked = await screen.findByRole('radio', { name: /CPR\/BLS Certification/ });
    expect(alreadyLinked).toBeDisabled();
    expect(screen.getByRole('radio', { name: /HIPAA/ })).toBeEnabled();
  });

  it('creates a new requirement and claims ownership of it', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(await screen.findByRole('tab', { name: 'Create a new one' }));
    await user.type(screen.getByLabelText('Name'), 'Ride-along hours');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(mockAddProgramRequirement).toHaveBeenCalledWith(
        'prog-1',
        expect.objectContaining({ requirement_id: 'req-new', owns_requirement: true })
      )
    );
    expect(mockCreateRequirementEnhanced).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Ride-along hours', frequency: 'one_time' })
    );
  });

  it('warns that editing a linked-in requirement changes it everywhere', async () => {
    renderModal({
      link: {
        id: 'link-1',
        program_id: 'prog-1',
        phase_id: 'phase-1',
        requirement_id: 'req-cpr',
        is_required: true,
        is_prerequisite: false,
        sort_order: 0,
        owns_requirement: false,
        created_at: '2026-01-01T00:00:00Z',
        requirement: cprRequirement,
      },
    });

    expect(await screen.findByText(/apply everywhere it is used/)).toBeInTheDocument();
    // Editing never offers the link/create switch.
    expect(screen.queryByRole('tab', { name: 'Use an existing requirement' })).not.toBeInTheDocument();
  });
});

const phases = [
  {
    id: 'ph-1',
    program_id: 'prog-1',
    phase_number: 1,
    name: 'Classroom',
    requires_manual_advancement: false,
    created_at: '',
    updated_at: '',
  },
  {
    id: 'ph-2',
    program_id: 'prog-1',
    phase_number: 2,
    name: 'Skills',
    requires_manual_advancement: false,
    created_at: '',
    updated_at: '',
  },
];

describe('PhaseFormModal — phase prerequisites', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateProgramPhase.mockResolvedValue({ id: 'ph-3' });
    mockUpdateProgramPhase.mockResolvedValue({ id: 'ph-2' });
  });

  it('offers the program’s other phases as prerequisites', async () => {
    renderWithRouter(
      <PhaseFormModal
        programId="prog-1"
        phase={phases[1]}
        allPhases={phases}
        nextPhaseNumber={3}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    expect(screen.getByLabelText(/Phase 1: Classroom/)).toBeInTheDocument();
    // A phase can't gate itself, so it is not in its own list.
    expect(screen.queryByLabelText(/Phase 2: Skills/)).not.toBeInTheDocument();
  });

  it('sends the ticked prerequisites as ids', async () => {
    const user = userEvent.setup();
    renderWithRouter(
      <PhaseFormModal
        programId="prog-1"
        phase={phases[1]}
        allPhases={phases}
        nextPhaseNumber={3}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    await user.click(screen.getByLabelText(/Phase 1: Classroom/));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockUpdateProgramPhase).toHaveBeenCalledWith(
        'prog-1',
        'ph-2',
        expect.objectContaining({ prerequisite_phase_ids: ['ph-1'] })
      );
    });
  });

  it('hides the picker when there is nothing to pick', async () => {
    renderWithRouter(<PhaseFormModal programId="prog-1" nextPhaseNumber={1} onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(screen.queryByText(/Finish these phases first/)).not.toBeInTheDocument();
  });
});

const program = {
  id: 'prog-1',
  organization_id: 'org-1',
  name: 'Recruit School',
  version: 1,
  structure_type: 'phases' as const,
  allows_concurrent_enrollment: true,
  warning_days_before: 30,
  is_template: false,
  active: true,
  recert_enabled: false,
  created_at: '',
  updated_at: '',
};

describe('EditProgramModal — deadline reminders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateProgram.mockResolvedValue(program);
  });

  it('saves a custom reminder schedule and on-track cutoff', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EditProgramModal program={program} onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.type(screen.getByLabelText(/All reminder days/), '60, 30, 7');
    await user.type(screen.getByLabelText(/below this percent complete/), '40');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockUpdateProgram).toHaveBeenCalledWith(
        'prog-1',
        expect.objectContaining({
          reminder_conditions: {
            days_before_deadline: [60, 30, 7],
            send_if_below_percentage: 40,
          },
        })
      );
    });
  });

  it('rejects a non-numeric reminder day instead of dropping it', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EditProgramModal program={program} onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.type(screen.getByLabelText(/All reminder days/), '30, soon');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockUpdateProgram).not.toHaveBeenCalled();
    });
  });

  it('leaves the cutoff unset when the field is blank', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EditProgramModal program={program} onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockUpdateProgram).toHaveBeenCalledWith(
        'prog-1',
        expect.objectContaining({
          reminder_conditions: { days_before_deadline: [], send_if_below_percentage: undefined },
        })
      );
    });
  });
});
