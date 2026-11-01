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
import { createMockApiError, renderWithRouter } from '../test/utils';

const mockAddProgramRequirement = vi.fn();
const mockCreateRequirementEnhanced = vi.fn();
const mockGetRequirementsEnhanced = vi.fn();
const mockGetCourses = vi.fn();
const mockCreateProgramPhase = vi.fn();
const mockUpdateProgramPhase = vi.fn();
const mockUpdateProgram = vi.fn();
const mockUpdateRequirementEnhanced = vi.fn();
const mockGetPrograms = vi.fn();
const mockUpdateProgramRequirement = vi.fn();
const mockUpdateMilestone = vi.fn();
const mockGetProgramEnrollments = vi.fn();
// The program forms load the department's evaluation forms for their picker;
// an empty list unless a test says otherwise.
const mockListShiftEvaluationTemplates = vi.fn();

vi.mock('../services/api', () => ({
  shiftEvaluationTemplateService: {
    list: (...a: unknown[]) => mockListShiftEvaluationTemplates(...a) as unknown,
  },
  trainingProgramService: {
    addProgramRequirement: (...a: unknown[]) => mockAddProgramRequirement(...a) as unknown,
    createRequirementEnhanced: (...a: unknown[]) => mockCreateRequirementEnhanced(...a) as unknown,
    getRequirementsEnhanced: (...a: unknown[]) => mockGetRequirementsEnhanced(...a) as unknown,
    createProgramPhase: (...a: unknown[]) => mockCreateProgramPhase(...a) as unknown,
    updateProgramPhase: (...a: unknown[]) => mockUpdateProgramPhase(...a) as unknown,
    updateProgram: (...a: unknown[]) => mockUpdateProgram(...a) as unknown,
    updateRequirementEnhanced: (...a: unknown[]) => mockUpdateRequirementEnhanced(...a) as unknown,
    getPrograms: (...a: unknown[]) => mockGetPrograms(...a) as unknown,
    updateProgramRequirement: (...a: unknown[]) => mockUpdateProgramRequirement(...a) as unknown,
    updateMilestone: (...a: unknown[]) => mockUpdateMilestone(...a) as unknown,
    getProgramEnrollments: (...a: unknown[]) => mockGetProgramEnrollments(...a) as unknown,
  },
  trainingService: {
    getCourses: (...a: unknown[]) => mockGetCourses(...a) as unknown,
  },
}));

const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: (...a: unknown[]) => mockToastError(...a) as unknown },
}));

// Imported after the mocks so the modal picks them up.
import { EditProgramModal, MilestoneFormModal, PhaseFormModal, RequirementFormModal } from './PipelineEditModals';

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
    mockListShiftEvaluationTemplates.mockReset();
    mockListShiftEvaluationTemplates.mockResolvedValue([]);
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
        apply_to_current_enrollments: true,
      })
    );
    // The department's requirement is reused as-is, not cloned.
    expect(mockCreateRequirementEnhanced).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('can hold only future enrollees to a newly linked requirement', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(await screen.findByRole('radio', { name: /CPR\/BLS Certification/ }));
    await user.click(screen.getByRole('radio', { name: /Only members who enroll from now on/ }));
    await user.click(screen.getByRole('button', { name: 'Link requirement' }));

    await waitFor(() =>
      expect(mockAddProgramRequirement).toHaveBeenCalledWith(
        'prog-1',
        expect.objectContaining({ requirement_id: 'req-cpr', apply_to_current_enrollments: false })
      )
    );
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

  it('clears the targets that no longer apply when the type changes', async () => {
    // An hours requirement switched to shifts has to send required_hours as
    // null. Omitting it reads as "leave alone" on the backend, which is how a
    // shifts requirement kept evaluating against a stale hours target.
    const user = userEvent.setup();
    renderModal({
      link: {
        id: 'link-1',
        program_id: 'prog-1',
        phase_id: 'phase-1',
        requirement_id: 'req-hours',
        is_required: true,
        is_prerequisite: false,
        sort_order: 0,
        owns_requirement: true,
        created_at: '2026-01-01T00:00:00Z',
        requirement: {
          ...cprRequirement,
          id: 'req-hours',
          name: 'Ride-along hours',
          requirement_type: 'hours' as const,
          required_hours: 24,
        },
      },
    });

    await user.selectOptions(await screen.findByLabelText(/type/i), 'shifts');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // objectContaining requires the key to be present and null; the old
    // payload omitted it entirely, so this fails against that behavior.
    await waitFor(() =>
      expect(mockUpdateRequirementEnhanced).toHaveBeenCalledWith(
        'req-hours',
        expect.objectContaining({ required_hours: null, requirement_type: 'shifts' })
      )
    );
  });
});

describe('RequirementFormModal — the requirement’s settings in this program', () => {
  const existingLink = {
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
    custom_deadline_days: 30,
    program_specific_description: 'Book the county class.',
    notification_message: 'Bring your card in.',
  };

  beforeEach(() => {
    mockListShiftEvaluationTemplates.mockReset();
    mockListShiftEvaluationTemplates.mockResolvedValue([]);
    vi.clearAllMocks();
    mockGetRequirementsEnhanced.mockReset();
    mockGetRequirementsEnhanced.mockResolvedValue([cprRequirement, hipaaRequirement]);
    mockGetCourses.mockReset();
    mockGetCourses.mockResolvedValue([]);
    mockAddProgramRequirement.mockReset();
    mockAddProgramRequirement.mockResolvedValue({ id: 'link-1' });
    mockUpdateRequirementEnhanced.mockReset();
    mockUpdateRequirementEnhanced.mockResolvedValue({});
    mockUpdateProgramRequirement.mockReset();
    mockUpdateProgramRequirement.mockResolvedValue({});
  });

  it('sends them when linking an existing requirement, omitting blanks', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(await screen.findByRole('radio', { name: /CPR\/BLS Certification/ }));
    await user.type(screen.getByLabelText(/Due after enrollment/), '45');
    await user.type(screen.getByLabelText('Message when completed'), 'Welcome aboard.');
    await user.click(screen.getByRole('button', { name: 'Link requirement' }));

    await waitFor(() => expect(mockAddProgramRequirement).toHaveBeenCalledTimes(1));
    const sent = mockAddProgramRequirement.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(sent.custom_deadline_days).toBe(45);
    expect(sent.notification_message).toBe('Welcome aboard.');
    expect(sent.program_specific_description).toBeUndefined();
  });

  it('loads the saved values when editing', async () => {
    renderModal({ link: existingLink });

    expect(await screen.findByLabelText(/Due after enrollment/)).toHaveValue(30);
    expect(screen.getByLabelText('Description members see')).toHaveValue('Book the county class.');
    expect(screen.getByLabelText('Message when completed')).toHaveValue('Bring your card in.');
  });

  it('sends every field on an edit, and a cleared one as null', async () => {
    const user = userEvent.setup();
    renderModal({ link: existingLink });

    await user.clear(await screen.findByLabelText(/Due after enrollment/));
    await user.clear(screen.getByLabelText('Message when completed'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(mockUpdateProgramRequirement).toHaveBeenCalledWith('prog-1', 'link-1', {
        is_required: true,
        custom_deadline_days: null,
        program_specific_description: 'Book the county class.',
        notification_message: null,
      })
    );
  });

  it('refuses a due-after value outside 1–3650', async () => {
    const user = userEvent.setup();
    renderModal({ link: existingLink });

    const days = await screen.findByLabelText(/Due after enrollment/);
    await user.clear(days);
    await user.type(days, '4000');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockUpdateProgramRequirement).not.toHaveBeenCalled();
    expect(mockUpdateRequirementEnhanced).not.toHaveBeenCalled();
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
    mockListShiftEvaluationTemplates.mockReset();
    mockListShiftEvaluationTemplates.mockResolvedValue([]);
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
  enrolled_count: 0,
  created_at: '',
  updated_at: '',
};

describe('EditProgramModal — deadline reminders', () => {
  beforeEach(() => {
    mockListShiftEvaluationTemplates.mockReset();
    mockListShiftEvaluationTemplates.mockResolvedValue([]);
    vi.clearAllMocks();
    mockUpdateProgram.mockResolvedValue(program);
    mockGetPrograms.mockReset();
    mockGetPrograms.mockResolvedValue([]);
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

describe('EditProgramModal — enrollment rules', () => {
  const others = [
    { ...program },
    { ...program, id: 'prog-hazmat', name: 'Hazmat Operations' },
    { ...program, id: 'prog-driver', name: 'Driver Operator' },
    { ...program, id: 'prog-template', name: 'Recruit Blueprint', is_template: true },
  ];
  const withPrerequisite = {
    ...program,
    allows_concurrent_enrollment: false,
    prerequisite_program_ids: ['prog-hazmat', 'prog-archived'],
    prerequisite_programs: [
      { id: 'prog-hazmat', name: 'Hazmat Operations' },
      { id: 'prog-archived', name: 'Old Academy' },
    ],
  };
  const concurrencyLabel = 'Allow members to be enrolled in other programs at the same time';

  beforeEach(() => {
    mockListShiftEvaluationTemplates.mockReset();
    mockListShiftEvaluationTemplates.mockResolvedValue([]);
    vi.clearAllMocks();
    mockGetPrograms.mockReset();
    mockGetPrograms.mockResolvedValue(others);
    mockUpdateProgram.mockReset();
    mockUpdateProgram.mockResolvedValue(program);
  });

  it('offers the other programs, never the program itself or a template', async () => {
    renderWithRouter(<EditProgramModal program={program} onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(await screen.findByRole('checkbox', { name: 'Hazmat Operations' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Driver Operator' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Recruit School' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Recruit Blueprint' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: concurrencyLabel })).toBeChecked();
  });

  it('sends every field the form owns, including both rules', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    renderWithRouter(<EditProgramModal program={program} onClose={vi.fn()} onSaved={onSaved} />);

    await user.click(await screen.findByRole('checkbox', { name: 'Driver Operator' }));
    await user.click(screen.getByRole('checkbox', { name: concurrencyLabel }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockUpdateProgram).toHaveBeenCalledWith('prog-1', {
        name: 'Recruit School',
        description: null,
        code: null,
        structure_type: 'phases',
        target_position: null,
        time_limit_days: null,
        warning_days_before: 30,
        reminder_conditions: { days_before_deadline: [], send_if_below_percentage: undefined },
        is_template: false,
        active: true,
        recert_enabled: false,
        recert_interval_months: undefined,
        recert_anchor_month: undefined,
        recert_anchor_day: undefined,
        prerequisite_program_ids: ['prog-driver'],
        allows_concurrent_enrollment: false,
        shift_evaluation_template_id: null,
      });
    });
    // The parent re-fetches the program on onSaved.
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('keeps an existing prerequisite that is no longer offered visible and removable', async () => {
    renderWithRouter(<EditProgramModal program={withPrerequisite} onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(await screen.findByRole('checkbox', { name: 'Hazmat Operations' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Old Academy' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: concurrencyLabel })).not.toBeChecked();
  });

  it('labels an inactive prerequisite as not currently required rather than hiding it', async () => {
    const withInactive = {
      ...withPrerequisite,
      prerequisite_programs: [
        { id: 'prog-hazmat', name: 'Hazmat Operations', active: true },
        { id: 'prog-archived', name: 'Old Academy', active: false },
      ],
    };
    renderWithRouter(<EditProgramModal program={withInactive} onClose={vi.fn()} onSaved={vi.fn()} />);

    // Still selected, and named with the label; the active one is not.
    expect(
      await screen.findByRole('checkbox', { name: 'Old Academy Inactive — not currently required' })
    ).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Hazmat Operations' })).toBeChecked();
  });

  it('clears the prerequisites with an empty list', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EditProgramModal program={withPrerequisite} onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.click(await screen.findByRole('checkbox', { name: 'Hazmat Operations' }));
    await user.click(screen.getByRole('checkbox', { name: 'Old Academy' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockUpdateProgram).toHaveBeenCalledWith(
        'prog-1',
        expect.objectContaining({ prerequisite_program_ids: [], allows_concurrent_enrollment: false })
      );
    });
  });

  it('shows the server’s refusal and does not report success', async () => {
    mockUpdateProgram.mockReset();
    mockUpdateProgram.mockRejectedValue(
      createMockApiError('Driver Operator already requires this program, directly or through its own prerequisites')
    );
    const user = userEvent.setup();
    const onSaved = vi.fn();
    renderWithRouter(<EditProgramModal program={program} onClose={vi.fn()} onSaved={onSaved} />);

    await user.click(await screen.findByRole('checkbox', { name: 'Driver Operator' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        'Driver Operator already requires this program, directly or through its own prerequisites'
      );
    });
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe('EditProgramModal — deactivating', () => {
  const enrollments = [
    { id: 'e1', status: 'active' },
    { id: 'e2', status: 'on_hold' },
    { id: 'e3', status: 'completed' },
    { id: 'e4', status: 'withdrawn' },
  ];

  beforeEach(() => {
    mockListShiftEvaluationTemplates.mockReset();
    mockListShiftEvaluationTemplates.mockResolvedValue([]);
    vi.clearAllMocks();
    mockGetPrograms.mockReset();
    mockGetPrograms.mockResolvedValue([]);
    mockUpdateProgram.mockReset();
    mockUpdateProgram.mockResolvedValue(program);
    mockGetProgramEnrollments.mockReset();
    mockGetProgramEnrollments.mockResolvedValue(enrollments);
  });

  it('says how many in-progress members will be withdrawn, and saves only once confirmed', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    renderWithRouter(<EditProgramModal program={program} onClose={vi.fn()} onSaved={onSaved} />);

    await user.click(screen.getByRole('checkbox', { name: 'Active' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/2 members are in progress on it and will be withdrawn/)).toBeInTheDocument();
    expect(screen.getByText(/Reactivating it later will not re-enroll anyone/)).toBeInTheDocument();
    expect(mockGetProgramEnrollments).toHaveBeenCalledWith('prog-1');
    expect(mockUpdateProgram).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Deactivate and withdraw' }));

    await waitFor(() => {
      expect(mockUpdateProgram).toHaveBeenCalledWith('prog-1', expect.objectContaining({ active: false }));
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('saves nothing when the officer keeps it active', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EditProgramModal program={program} onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.click(screen.getByRole('checkbox', { name: 'Active' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(await screen.findByRole('button', { name: 'Keep it active' }));

    await waitFor(() => {
      expect(screen.queryByText(/will be withdrawn/)).not.toBeInTheDocument();
    });
    expect(mockUpdateProgram).not.toHaveBeenCalled();
  });

  it('does not ask when the pipeline stays active', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EditProgramModal program={program} onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockUpdateProgram).toHaveBeenCalledWith('prog-1', expect.objectContaining({ active: true }));
    });
    expect(mockGetProgramEnrollments).not.toHaveBeenCalled();
  });
});

// An update is partial on the server: an omitted key keeps the stored value,
// so each of these forms must send an emptied field as null to clear it.
describe('clearing a field on an edit sends null', () => {
  beforeEach(() => {
    mockListShiftEvaluationTemplates.mockReset();
    mockListShiftEvaluationTemplates.mockResolvedValue([]);
    vi.clearAllMocks();
    mockUpdateProgram.mockReset();
    mockUpdateProgram.mockResolvedValue(program);
    mockGetPrograms.mockReset();
    mockGetPrograms.mockResolvedValue([]);
    mockUpdateProgramPhase.mockReset();
    mockUpdateProgramPhase.mockResolvedValue({ id: 'ph-2' });
    mockUpdateMilestone.mockReset();
    mockUpdateMilestone.mockResolvedValue({ id: 'ms-1' });
  });

  it('clears the program’s text, limits and recert schedule', async () => {
    const filled = {
      ...program,
      description: 'Twelve-week academy',
      code: 'RS-1',
      target_position: 'firefighter',
      time_limit_days: 90,
      warning_days_before: 30,
      recert_enabled: true,
      recert_interval_months: 24,
      recert_anchor_month: 3,
      recert_anchor_day: 30,
    };
    const user = userEvent.setup();
    renderWithRouter(<EditProgramModal program={filled} onClose={vi.fn()} onSaved={vi.fn()} />);

    for (const label of [/^Description/, /^Code/, /^Target position/, /^Time limit/, /^Cycle length/, /^Reset day/]) {
      await user.clear(screen.getByLabelText(label));
    }
    await user.selectOptions(screen.getByLabelText(/^Reset month/), '');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockUpdateProgram).toHaveBeenCalledWith(
        'prog-1',
        expect.objectContaining({
          description: null,
          code: null,
          target_position: null,
          time_limit_days: null,
          warning_days_before: 30,
          recert_enabled: true,
          recert_interval_months: null,
          recert_anchor_month: null,
          recert_anchor_day: null,
        })
      );
    });
  });

  it('refuses a blank first warning instead of sending a null the server cannot store', async () => {
    const user = userEvent.setup();
    renderWithRouter(
      <EditProgramModal program={{ ...program, warning_days_before: 30 }} onClose={vi.fn()} onSaved={vi.fn()} />
    );

    await user.clear(screen.getByLabelText(/^First warning/));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockUpdateProgram).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith('First warning is required');
  });

  it('leaves the recert schedule untouched while recert is off', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EditProgramModal program={program} onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockUpdateProgram).toHaveBeenCalled();
    });
    const payload = mockUpdateProgram.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.recert_enabled).toBe(false);
    expect(payload.recert_interval_months).toBeUndefined();
    expect(payload.recert_anchor_month).toBeUndefined();
    expect(payload.recert_anchor_day).toBeUndefined();
  });

  it('clears a phase’s description and time limit', async () => {
    const skills = {
      id: 'ph-2',
      program_id: 'prog-1',
      phase_number: 2,
      name: 'Skills',
      requires_manual_advancement: false,
      created_at: '',
      updated_at: '',
    };
    const user = userEvent.setup();
    renderWithRouter(
      <PhaseFormModal
        programId="prog-1"
        phase={{ ...skills, description: 'Hands-on drills', time_limit_days: 30 }}
        allPhases={phases}
        nextPhaseNumber={3}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    await user.clear(screen.getByLabelText(/^Description/));
    await user.clear(screen.getByLabelText(/^Time limit/));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockUpdateProgramPhase).toHaveBeenCalledWith(
        'prog-1',
        'ph-2',
        expect.objectContaining({ description: null, time_limit_days: null })
      );
    });
  });

  it('clears a milestone’s description and custom message', async () => {
    const user = userEvent.setup();
    renderWithRouter(
      <MilestoneFormModal
        programId="prog-1"
        phases={phases}
        milestone={{
          id: 'ms-1',
          program_id: 'prog-1',
          name: 'Halfway',
          description: 'Half the program done',
          completion_percentage_threshold: 50,
          notification_message: 'Nice work, keep going',
          created_at: '',
        }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    await user.clear(screen.getByLabelText(/^Description/));
    await user.clear(screen.getByLabelText(/^Notification message/));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockUpdateMilestone).toHaveBeenCalledWith(
        'prog-1',
        'ms-1',
        expect.objectContaining({ description: null, notification_message: null })
      );
    });
  });
});

describe('EditProgramModal — shift evaluation form', () => {
  const template = (id: string, name: string, isActive = true) => ({
    id,
    name,
    is_active: isActive,
    program_names: [],
    is_general_form: false,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockListShiftEvaluationTemplates.mockReset();
    mockListShiftEvaluationTemplates.mockResolvedValue([
      template('tpl-emt', 'EMT Shift Evaluation'),
      template('tpl-driver', 'Driver Evaluation'),
      template('tpl-old', 'Old Evaluation', false),
    ]);
    mockGetPrograms.mockReset();
    mockGetPrograms.mockResolvedValue([]);
    mockUpdateProgram.mockReset();
    mockUpdateProgram.mockResolvedValue(program);
  });

  it('offers the active forms, and keeps an inactive one the program already uses', async () => {
    renderWithRouter(
      <EditProgramModal
        program={{ ...program, shift_evaluation_template_id: 'tpl-old' }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    const select = await screen.findByRole('combobox', { name: 'Shift evaluation form' });
    await waitFor(() => expect(select).toBeEnabled());
    expect(select).toHaveValue('tpl-old');
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(
      expect.arrayContaining([
        'No evaluation form',
        'EMT Shift Evaluation',
        'Driver Evaluation',
        'Old Evaluation (inactive)',
      ])
    );
  });

  it('does not offer an inactive form the program does not use', async () => {
    renderWithRouter(<EditProgramModal program={program} onClose={vi.fn()} onSaved={vi.fn()} />);

    const select = await screen.findByRole('combobox', { name: 'Shift evaluation form' });
    await waitFor(() => expect(select).toBeEnabled());
    expect(screen.queryByRole('option', { name: 'Old Evaluation (inactive)' })).not.toBeInTheDocument();
  });

  it('sends the chosen form', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EditProgramModal program={program} onClose={vi.fn()} onSaved={vi.fn()} />);

    const select = await screen.findByRole('combobox', { name: 'Shift evaluation form' });
    await waitFor(() => expect(select).toBeEnabled());
    await user.selectOptions(select, 'Driver Evaluation');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockUpdateProgram).toHaveBeenCalledWith(
        'prog-1',
        expect.objectContaining({ shift_evaluation_template_id: 'tpl-driver' })
      );
    });
  });

  it('sends null when the form is removed, so the clear is saved', async () => {
    const user = userEvent.setup();
    renderWithRouter(
      <EditProgramModal
        program={{ ...program, shift_evaluation_template_id: 'tpl-emt' }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    const select = await screen.findByRole('combobox', { name: 'Shift evaluation form' });
    await waitFor(() => expect(select).toBeEnabled());
    await user.selectOptions(select, 'No evaluation form');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockUpdateProgram).toHaveBeenCalledWith(
        'prog-1',
        expect.objectContaining({ shift_evaluation_template_id: null })
      );
    });
  });
});
