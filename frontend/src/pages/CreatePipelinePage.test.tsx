/**
 * Covers the create-pipeline wizard's requirement step: the "Link Existing"
 * path (a phase attaches a requirement the department already tracks instead of
 * defining a duplicate), the one-list structure that has no phases at all, and
 * the pre-submit checks that name the offending phase rather than letting the
 * build endpoint return an unattributable 422.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockApiError, renderWithRouter } from '../test/utils';

const mockBuildProgram = vi.fn();
const mockGetRequirementsEnhanced = vi.fn();
const mockGetCourses = vi.fn();
const mockGetPrograms = vi.fn();
// The program forms load the department's evaluation forms for their picker;
// an empty list unless a test says otherwise.
const mockListShiftEvaluationTemplates = vi.fn();

vi.mock('../services/api', () => ({
  shiftEvaluationTemplateService: {
    list: (...a: unknown[]) => mockListShiftEvaluationTemplates(...a) as unknown,
  },
  trainingProgramService: {
    buildProgram: (...a: unknown[]) => mockBuildProgram(...a) as unknown,
    getPrograms: (...a: unknown[]) => mockGetPrograms(...a) as unknown,
    getRequirementsEnhanced: (...a: unknown[]) => mockGetRequirementsEnhanced(...a) as unknown,
  },
  trainingService: {
    getCourses: (...a: unknown[]) => mockGetCourses(...a) as unknown,
  },
}));

const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: (...a: unknown[]) => mockToastError(...a) as unknown },
}));

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return { ...actual, useNavigate: () => mockNavigate };
});

import CreatePipelinePage from './CreatePipelinePage';

const cprRequirement = {
  id: 'req-cpr',
  organization_id: 'org-1',
  name: 'CPR/BLS Certification',
  requirement_type: 'certification' as const,
  source: 'department' as const,
  frequency: 'biannual' as const,
  applies_to_all: true,
  due_date_type: 'calendar_period' as const,
  active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

/** Walks the wizard to the Requirements step with one named phase defined. */
const goToRequirementsWithAPhase = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByLabelText(/Program Name/), 'Recruit School');
  await user.click(screen.getByRole('button', { name: /Next/ }));
  await user.click(await screen.findByRole('button', { name: /Add Phase/ }));
  await user.type(await screen.findByPlaceholderText(/Engine Company Operations/), 'Orientation');
  await user.click(screen.getByRole('button', { name: /Next/ }));
};

describe('CreatePipelinePage — linking existing requirements', () => {
  beforeEach(() => {
    mockListShiftEvaluationTemplates.mockReset();
    mockListShiftEvaluationTemplates.mockResolvedValue([]);
    vi.clearAllMocks();
    mockGetRequirementsEnhanced.mockResolvedValue([cprRequirement]);
    mockGetCourses.mockResolvedValue([]);
    mockGetPrograms.mockReset();
    mockGetPrograms.mockResolvedValue([]);
    mockBuildProgram.mockResolvedValue({ id: 'prog-1' });
  });

  it('sends a linked requirement as an id, with no definition fields', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreatePipelinePage />);

    await goToRequirementsWithAPhase(user);
    await user.click(await screen.findByRole('button', { name: /Link Existing/ }));
    await user.click(await screen.findByRole('radio', { name: /CPR\/BLS Certification/ }));

    await user.click(screen.getByRole('button', { name: /Next/ })); // milestones
    await user.click(screen.getByRole('button', { name: /Next/ })); // review
    await user.click(screen.getByRole('button', { name: /Create Pipeline/ }));

    await waitFor(() => expect(mockBuildProgram).toHaveBeenCalledTimes(1));
    const payload = mockBuildProgram.mock.calls[0]?.[0] as {
      phases: { requirements: Record<string, unknown>[] }[];
    };
    expect(payload.phases[0]?.requirements[0]).toEqual({
      requirement_id: 'req-cpr',
      is_required: true,
      sort_order: 0,
    });
  });

  it('refuses to submit a link with nothing picked, naming the phase', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreatePipelinePage />);

    await goToRequirementsWithAPhase(user);
    await user.click(await screen.findByRole('button', { name: /Link Existing/ }));
    // Deliberately skip picking one.
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(screen.getByRole('button', { name: /Create Pipeline/ }));

    expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining('Phase 1'));
    expect(mockBuildProgram).not.toHaveBeenCalled();
  });

  it('refuses to submit an unnamed phase instead of letting the server 422', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreatePipelinePage />);

    await user.type(screen.getByLabelText(/Program Name/), 'Recruit School');
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(await screen.findByRole('button', { name: /Add Phase/ }));
    await user.click(screen.getByRole('button', { name: /Next/ })); // requirements
    await user.click(screen.getByRole('button', { name: /Next/ })); // milestones
    await user.click(screen.getByRole('button', { name: /Next/ })); // review
    await user.click(screen.getByRole('button', { name: /Create Pipeline/ }));

    expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining('Phase 1 needs a name'));
    expect(mockBuildProgram).not.toHaveBeenCalled();
  });

  it('refuses an hours requirement with no target, which nobody could complete', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreatePipelinePage />);

    await goToRequirementsWithAPhase(user);
    await user.click(await screen.findByRole('button', { name: /New Requirement/ }));
    await user.type(await screen.findByPlaceholderText(/Hose Operations Skills/), 'Ride-alongs');
    // Leave "Required Hours" blank.
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(screen.getByRole('button', { name: /Create Pipeline/ }));

    expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining('needs a number to count toward'));
    expect(mockBuildProgram).not.toHaveBeenCalled();
  });
});

describe('CreatePipelinePage — a one-list program', () => {
  beforeEach(() => {
    mockListShiftEvaluationTemplates.mockReset();
    mockListShiftEvaluationTemplates.mockResolvedValue([]);
    vi.clearAllMocks();
    mockGetRequirementsEnhanced.mockResolvedValue([cprRequirement]);
    mockGetCourses.mockResolvedValue([]);
    mockGetPrograms.mockReset();
    mockGetPrograms.mockResolvedValue([]);
    mockBuildProgram.mockResolvedValue({ id: 'prog-2' });
  });

  it('names the fields of a new requirement by their labels, and shows the target position by name', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreatePipelinePage />);

    await user.type(screen.getByLabelText(/Program Name/), 'Driver Candidate Program');
    await user.selectOptions(screen.getByLabelText(/Target Position/), 'driver_candidate');
    await user.selectOptions(screen.getByLabelText(/Structure Type/), 'flexible');
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(await screen.findByRole('button', { name: /New Requirement/ }));

    await user.type(screen.getByLabelText(/^Requirement Name/), 'Supervised Driving Hours');
    expect(screen.getByLabelText('Type')).toHaveValue('hours');
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Required Hours'), '20');

    await user.click(screen.getByRole('button', { name: /Next/ })); // milestones
    await user.click(screen.getByRole('button', { name: /Next/ })); // review
    expect(screen.getByText('Driver Candidate')).toBeInTheDocument();
    expect(screen.queryByText('driver_candidate')).not.toBeInTheDocument();
  });

  it('skips the Phases step and sends requirements at the program level', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreatePipelinePage />);

    await user.type(screen.getByLabelText(/Program Name/), 'Annual CE');
    await user.selectOptions(screen.getByLabelText(/Structure Type/), 'flexible');
    // No Phases step to pass through — Next goes straight to Requirements.
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(await screen.findByRole('button', { name: /Link Existing/ }));
    await user.click(await screen.findByRole('radio', { name: /CPR\/BLS Certification/ }));
    await user.click(screen.getByRole('button', { name: /Next/ })); // milestones
    await user.click(screen.getByRole('button', { name: /Next/ })); // review
    await user.click(screen.getByRole('button', { name: /Create Pipeline/ }));

    await waitFor(() => expect(mockBuildProgram).toHaveBeenCalledTimes(1));
    const payload = mockBuildProgram.mock.calls[0]?.[0] as {
      phases: unknown[];
      requirements: Record<string, unknown>[];
    };
    expect(payload.phases).toEqual([]);
    expect(payload.requirements[0]).toEqual({
      requirement_id: 'req-cpr',
      is_required: true,
      sort_order: 0,
    });
  });
});

describe('CreatePipelinePage — a requirement’s settings in this program', () => {
  beforeEach(() => {
    mockListShiftEvaluationTemplates.mockReset();
    mockListShiftEvaluationTemplates.mockResolvedValue([]);
    vi.clearAllMocks();
    mockGetRequirementsEnhanced.mockReset();
    mockGetRequirementsEnhanced.mockResolvedValue([cprRequirement]);
    mockGetCourses.mockReset();
    mockGetCourses.mockResolvedValue([]);
    mockGetPrograms.mockReset();
    mockGetPrograms.mockResolvedValue([]);
    mockBuildProgram.mockReset();
    mockBuildProgram.mockResolvedValue({ id: 'prog-3' });
  });

  it('sends the due-after days, member description and completion message with a linked requirement', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreatePipelinePage />);

    await goToRequirementsWithAPhase(user);
    await user.click(await screen.findByRole('button', { name: /Link Existing/ }));
    await user.click(await screen.findByRole('radio', { name: /CPR\/BLS Certification/ }));
    await user.type(screen.getByLabelText(/Due after enrollment/), '30');
    await user.type(screen.getByLabelText('Description members see'), '  Book the county class.  ');
    await user.type(screen.getByLabelText('Message when completed'), 'Bring your card to Station 2.');

    await user.click(screen.getByRole('button', { name: /Next/ })); // milestones
    await user.click(screen.getByRole('button', { name: /Next/ })); // review
    expect(screen.getByText('Due 30 days after enrollment')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Create Pipeline/ }));

    await waitFor(() => expect(mockBuildProgram).toHaveBeenCalledTimes(1));
    const payload = mockBuildProgram.mock.calls[0]?.[0] as {
      phases: { requirements: Record<string, unknown>[] }[];
    };
    expect(payload.phases[0]?.requirements[0]).toStrictEqual({
      requirement_id: 'req-cpr',
      is_required: true,
      sort_order: 0,
      custom_deadline_days: 30,
      program_specific_description: 'Book the county class.',
      notification_message: 'Bring your card to Station 2.',
    });
  });

  it('omits the settings an officer left blank on a new requirement', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreatePipelinePage />);

    await goToRequirementsWithAPhase(user);
    await user.click(await screen.findByRole('button', { name: /New Requirement/ }));
    await user.type(await screen.findByPlaceholderText(/Hose Operations Skills/), 'Ride-alongs');
    await user.type(screen.getByLabelText('Required Hours'), '12');
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(screen.getByRole('button', { name: /Create Pipeline/ }));

    await waitFor(() => expect(mockBuildProgram).toHaveBeenCalledTimes(1));
    const payload = mockBuildProgram.mock.calls[0]?.[0] as {
      phases: { requirements: Record<string, unknown>[] }[];
    };
    const sent = payload.phases[0]?.requirements[0] ?? {};
    expect(sent.custom_deadline_days).toBeUndefined();
    expect(sent.program_specific_description).toBeUndefined();
    expect(sent.notification_message).toBeUndefined();
  });

  it('refuses a due-after value of zero before the server would', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreatePipelinePage />);

    await goToRequirementsWithAPhase(user);
    await user.click(await screen.findByRole('button', { name: /Link Existing/ }));
    await user.click(await screen.findByRole('radio', { name: /CPR\/BLS Certification/ }));
    await user.type(screen.getByLabelText(/Due after enrollment/), '0');
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(screen.getByRole('button', { name: /Create Pipeline/ }));

    expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining('whole number from 1 to 3650'));
    expect(mockBuildProgram).not.toHaveBeenCalled();
  });
});

describe('CreatePipelinePage — enrollment rules', () => {
  const existing = [
    { id: 'prog-recruit', name: 'Recruit School', is_template: false },
    { id: 'prog-blueprint', name: 'Recruit Blueprint', is_template: true },
  ];

  beforeEach(() => {
    mockListShiftEvaluationTemplates.mockReset();
    mockListShiftEvaluationTemplates.mockResolvedValue([]);
    vi.clearAllMocks();
    mockGetRequirementsEnhanced.mockReset();
    mockGetRequirementsEnhanced.mockResolvedValue([]);
    mockGetCourses.mockReset();
    mockGetCourses.mockResolvedValue([]);
    mockGetPrograms.mockReset();
    mockGetPrograms.mockResolvedValue(existing);
    mockBuildProgram.mockReset();
    mockBuildProgram.mockResolvedValue({ id: 'prog-3' });
  });

  const createFlexible = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: /Next/ })); // requirements
    await user.click(screen.getByRole('button', { name: /Next/ })); // milestones
    await user.click(screen.getByRole('button', { name: /Next/ })); // review
    await user.click(screen.getByRole('button', { name: /Create Pipeline/ }));
    await waitFor(() => expect(mockBuildProgram).toHaveBeenCalledTimes(1));
    return (mockBuildProgram.mock.calls[0]?.[0] as { program: Record<string, unknown> }).program;
  };

  it('offers other programs but not templates, and sends both settings', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreatePipelinePage />);

    await user.type(screen.getByLabelText(/Program Name/), 'Driver Operator');
    await user.selectOptions(screen.getByLabelText(/Structure Type/), 'flexible');
    expect(screen.getByText('Members must complete these programs before they can enroll.')).toBeInTheDocument();
    await user.click(await screen.findByRole('checkbox', { name: 'Recruit School' }));
    expect(screen.queryByRole('checkbox', { name: 'Recruit Blueprint' })).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('checkbox', { name: 'Allow members to be enrolled in other programs at the same time' })
    );

    const program = await createFlexible(user);

    expect(program).toEqual({
      name: 'Driver Operator',
      description: undefined,
      code: undefined,
      target_position: undefined,
      structure_type: 'flexible',
      time_limit_days: undefined,
      warning_days_before: 30,
      is_template: false,
      prerequisite_program_ids: ['prog-recruit'],
      allows_concurrent_enrollment: false,
    });
  });

  it('omits prerequisites when none are picked and allows concurrency by default', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreatePipelinePage />);

    await user.type(screen.getByLabelText(/Program Name/), 'Annual CE');
    await user.selectOptions(screen.getByLabelText(/Structure Type/), 'flexible');
    await screen.findByRole('checkbox', { name: 'Recruit School' });

    const program = await createFlexible(user);

    expect(program['prerequisite_program_ids']).toBeUndefined();
    expect(program['allows_concurrent_enrollment']).toBe(true);
  });

  it('shows the server’s refusal', async () => {
    mockBuildProgram.mockReset();
    mockBuildProgram.mockRejectedValue(createMockApiError('Invalid prerequisite program'));
    const user = userEvent.setup();
    renderWithRouter(<CreatePipelinePage />);

    await user.type(screen.getByLabelText(/Program Name/), 'Driver Operator');
    await user.selectOptions(screen.getByLabelText(/Structure Type/), 'flexible');
    await user.click(await screen.findByRole('checkbox', { name: 'Recruit School' }));
    await createFlexible(user);

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Invalid prerequisite program'));
  });
});

describe('CreatePipelinePage — shift evaluation form', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListShiftEvaluationTemplates.mockReset();
    mockListShiftEvaluationTemplates.mockResolvedValue([
      { id: 'tpl-driver', name: 'Driver Evaluation', is_active: true },
      { id: 'tpl-old', name: 'Old Evaluation', is_active: false },
    ]);
    mockGetRequirementsEnhanced.mockReset();
    mockGetRequirementsEnhanced.mockResolvedValue([]);
    mockGetCourses.mockReset();
    mockGetCourses.mockResolvedValue([]);
    mockGetPrograms.mockReset();
    mockGetPrograms.mockResolvedValue([]);
    mockBuildProgram.mockReset();
    mockBuildProgram.mockResolvedValue({ id: 'prog-4' });
  });

  const create = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: /Next/ })); // requirements
    await user.click(screen.getByRole('button', { name: /Next/ })); // milestones
    await user.click(screen.getByRole('button', { name: /Next/ })); // review
    await user.click(screen.getByRole('button', { name: /Create Pipeline/ }));
    await waitFor(() => expect(mockBuildProgram).toHaveBeenCalledTimes(1));
    return (mockBuildProgram.mock.calls[0]?.[0] as { program: Record<string, unknown> }).program;
  };

  it('sends the chosen form, offering only active ones', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreatePipelinePage />);

    await user.type(screen.getByLabelText(/Program Name/), 'Driver Candidate');
    await user.selectOptions(screen.getByLabelText(/Structure Type/), 'flexible');
    const select = screen.getByRole('combobox', { name: 'Shift evaluation form' });
    await waitFor(() => expect(select).toBeEnabled());
    expect(screen.queryByRole('option', { name: /Old Evaluation/ })).not.toBeInTheDocument();
    await user.selectOptions(select, 'Driver Evaluation');

    const program = await create(user);

    expect(program.shift_evaluation_template_id).toBe('tpl-driver');
  });

  it('leaves the key out when no form is chosen', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreatePipelinePage />);

    await user.type(screen.getByLabelText(/Program Name/), 'Recruit School');
    await user.selectOptions(screen.getByLabelText(/Structure Type/), 'flexible');

    const program = await create(user);

    expect(program.shift_evaluation_template_id).toBeUndefined();
  });
});
