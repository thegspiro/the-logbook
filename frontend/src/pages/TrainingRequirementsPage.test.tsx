import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';
import { renderWithRouter } from '../test/utils';
import TrainingRequirementsPage from './TrainingRequirementsPage';

const mockGetRequirements = vi.fn();
const mockGetCategories = vi.fn();
const mockCreateRequirement = vi.fn();
const mockDeleteRequirement = vi.fn();
const mockUpdateRequirement = vi.fn();
const mockGetDeletionImpact = vi.fn();
const mockPreviewRegistry = vi.fn();

vi.mock('../services/api', () => ({
  trainingService: {
    getRequirements: (...args: unknown[]) => mockGetRequirements(...args) as unknown,
    getCategories: (...args: unknown[]) => mockGetCategories(...args) as unknown,
    createRequirement: (...args: unknown[]) => mockCreateRequirement(...args) as unknown,
    updateRequirement: (...args: unknown[]) => mockUpdateRequirement(...args) as unknown,
    deleteRequirement: (...args: unknown[]) => mockDeleteRequirement(...args) as unknown,
    getRequirementDeletionImpact: (...args: unknown[]) => mockGetDeletionImpact(...args) as unknown,
    getCourses: vi.fn().mockResolvedValue([]),
  },
  trainingProgramService: {
    getRegistries: vi.fn().mockResolvedValue([]),
    previewRegistry: (...args: unknown[]) => mockPreviewRegistry(...args) as unknown,
    importRegistry: vi.fn(),
  },
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: vi.fn((selector) => {
    const state = {
      user: {
        id: 'user-1',
        role: { slug: 'admin' },
        permissions: ['training.manage'],
      },
    };
    if (typeof selector === 'function') {
      return (selector as (s: typeof state) => unknown)(state);
    }
    return state;
  }),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

describe('TrainingRequirementsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRequirements.mockResolvedValue([
      {
        id: 'req-1',
        name: 'Annual Fire Training',
        requirement_type: 'hours',
        source: 'department',
        training_type: 'certification',
        required_hours: 36,
        frequency: 'annual',
        applies_to_all: true,
        active: true,
        due_date_type: 'calendar_period',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ]);
    mockGetCategories.mockResolvedValue([]);
    mockPreviewRegistry.mockReset();
    mockPreviewRegistry.mockResolvedValue([]);
    // The real endpoint echoes back the persisted requirement, which the page
    // appends to its list — returning undefined would crash the list filter.
    mockCreateRequirement.mockResolvedValue({
      id: 'req-new',
      name: 'Created Requirement',
      requirement_type: 'checklist',
      source: 'department',
      frequency: 'one_time',
      applies_to_all: false,
      active: true,
      due_date_type: 'calendar_period',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });
  });

  it('renders the requirements page', async () => {
    renderWithRouter(<TrainingRequirementsPage />);
    await waitFor(() => {
      expect(mockGetRequirements).toHaveBeenCalledWith({ active_only: false });
    });
  });

  // Registry import used to live only in the Programs page's Requirements
  // view; the hub's Requirements tab is now where it is offered.
  it('offers registry import and opens the chosen registry', async () => {
    renderWithRouter(<TrainingRequirementsPage />);

    expect(await screen.findByRole('heading', { name: 'Import from Registry' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Import NFPA/ }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(mockPreviewRegistry).toHaveBeenCalledWith('nfpa');
  });

  // The import cards filled the first screen, so the department's own
  // requirements started below the fold on a tablet.
  it('lists the requirements before the registry import cards', async () => {
    renderWithRouter(<TrainingRequirementsPage />);

    const requirement = await screen.findByText('Annual Fire Training');
    const registry = screen.getByRole('heading', { name: 'Import from Registry' });
    const search = screen.getByRole('search', { name: 'Search and filter requirements' });
    expect(search.compareDocumentPosition(requirement) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(requirement.compareDocumentPosition(registry) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it('handles empty requirements list', async () => {
    mockGetRequirements.mockResolvedValue([]);
    const { container } = renderWithRouter(<TrainingRequirementsPage />);
    expect(container).toBeInTheDocument();
  });

  it('handles API errors gracefully', async () => {
    mockGetRequirements.mockRejectedValue(new Error('Network error'));
    renderWithRouter(<TrainingRequirementsPage />);
    await waitFor(() => {
      expect(mockGetRequirements).toHaveBeenCalledWith({ active_only: false });
    });
    expect(document.body).toBeInTheDocument();
  });

  it('opens the create form pre-filled when a template is selected instead of saving immediately', async () => {
    const user = userEvent.setup();
    renderWithRouter(<TrainingRequirementsPage />);

    await user.click(await screen.findByRole('button', { name: /use template/i }));
    await user.click(screen.getByRole('button', { name: /NREMT EMT Recertification/i }));

    expect(mockCreateRequirement).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText(/^Name/)).toHaveValue('NREMT EMT Recertification');
    expect(within(dialog).getByLabelText(/Required Hours/)).toHaveValue(40);
  });

  it.each([
    'HIPAA Privacy & Security Awareness',
    'Bloodborne Pathogens Annual Refresher',
    'Hazmat Operations Refresher',
  ])('seeds the single-topic %s template as a Courses requirement', async (templateName) => {
    // As an hours requirement scoped only by training type, any hour of that
    // type satisfied it — two CAPCE medical courses met the HIPAA refresher.
    const user = userEvent.setup();
    renderWithRouter(<TrainingRequirementsPage />);

    await user.click(await screen.findByRole('button', { name: /use template/i }));
    await user.click(screen.getByRole('button', { name: new RegExp(templateName, 'i') }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText(/^Requirement Type/)).toHaveValue('courses');
    await user.click(within(dialog).getByRole('button', { name: 'Create Requirement' }));

    expect(mockCreateRequirement).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      'Select at least one course from the library for a courses requirement'
    );
  });

  it('shows the warning the backend reports for a requirement any hour can satisfy', async () => {
    const warning =
      'Any training hour of the selected type counts toward this requirement, not only HIPAA training. Edit it into a Courses requirement linked to your HIPAA course.';
    mockGetRequirements.mockResolvedValue([
      {
        id: 'req-hipaa',
        name: 'HIPAA Privacy & Security Awareness',
        requirement_type: 'hours',
        source: 'national',
        registry_name: 'HIPAA',
        registry_code: '45 CFR 164.530(b)',
        training_type: 'continuing_education',
        required_hours: 1,
        frequency: 'annual',
        applies_to_all: true,
        active: true,
        due_date_type: 'calendar_period',
        config_warning: warning,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ]);
    renderWithRouter(<TrainingRequirementsPage />);

    expect(await screen.findByText(warning)).toBeInTheDocument();
  });

  it('labels a one-time requirement as One Time instead of showing a recurring cycle', async () => {
    mockGetRequirements.mockResolvedValue([
      {
        id: 'req-2',
        name: 'New Member Orientation Checklist',
        requirement_type: 'checklist',
        source: 'department',
        checklist_items: ['Station tour'],
        frequency: 'one_time',
        applies_to_all: false,
        required_membership_types: ['probationary'],
        active: true,
        // Persisted by older saves; must not resurface as an annual cycle
        due_date_type: 'calendar_period',
        period_start_month: 1,
        period_start_day: 1,
        year: 2026,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ]);
    renderWithRouter(<TrainingRequirementsPage />);

    expect(await screen.findByText('One Time')).toBeInTheDocument();
    expect(screen.queryByText('Calendar Period')).not.toBeInTheDocument();
    expect(screen.getByText('One time — never resets')).toBeInTheDocument();
    expect(screen.queryByText('2026')).not.toBeInTheDocument();
  });

  it('names each requirement action after its requirement', async () => {
    mockGetRequirements.mockResolvedValue([
      {
        id: 'req-3',
        name: 'Annual Hazmat Hours',
        requirement_type: 'hours',
        source: 'department',
        required_hours: 8,
        frequency: 'annual',
        applies_to_all: true,
        active: true,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ]);
    renderWithRouter(<TrainingRequirementsPage />);

    expect(await screen.findByRole('button', { name: 'Edit Annual Hazmat Hours' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Annual Hazmat Hours' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deactivate Annual Hazmat Hours' })).toBeInTheDocument();
  });

  it('hides cycle and year controls when a one-time template is selected', async () => {
    const user = userEvent.setup();
    renderWithRouter(<TrainingRequirementsPage />);

    await user.click(await screen.findByRole('button', { name: /use template/i }));
    await user.click(screen.getByRole('button', { name: /New Member Orientation Checklist/i }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Frequency')).toHaveValue('one_time');
    expect(within(dialog).queryByLabelText('Year')).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Period Start Month/)).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('radiogroup', { name: /due date type/i })).not.toBeInTheDocument();
    expect(within(dialog).getByText(/never reset/i)).toBeInTheDocument();
  });

  it('does not persist a year or calendar period for a one-time requirement', async () => {
    const user = userEvent.setup();
    renderWithRouter(<TrainingRequirementsPage />);

    await user.click(await screen.findByRole('button', { name: /use template/i }));
    await user.click(screen.getByRole('button', { name: /New Member Orientation Checklist/i }));

    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Create Requirement' }));

    await waitFor(() => {
      expect(mockCreateRequirement).toHaveBeenCalledWith(expect.objectContaining({ frequency: 'one_time' }));
    });
    const payload = mockCreateRequirement.mock.calls[0]?.[0] as Record<string, unknown>;
    // An explicit null, not an omitted key: on create both store no year, but
    // on an edit only null clears one the requirement already carried.
    expect(payload.year).toBeNull();
    expect(payload.period_start_month).toBeUndefined();
    expect(payload.period_start_day).toBeUndefined();
    expect(payload.rolling_period_months).toBeUndefined();
  });

  it('still shows the cycle controls for a recurring requirement', async () => {
    const user = userEvent.setup();
    renderWithRouter(<TrainingRequirementsPage />);

    await user.click(await screen.findByRole('button', { name: /use template/i }));
    await user.click(screen.getByRole('button', { name: /NFPA 1001 Firefighter Annual Training/i }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Frequency')).toHaveValue('annual');
    expect(within(dialog).getByLabelText('Year')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Period Start Month/)).toBeInTheDocument();
  });

  it('blocks saving a requirement that would apply to nobody', async () => {
    const user = userEvent.setup();
    renderWithRouter(<TrainingRequirementsPage />);

    await user.click(await screen.findByRole('button', { name: 'Create Requirement' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Name/), 'Test Requirement');
    await user.type(within(dialog).getByLabelText(/Required Hours/), '10');
    await user.click(within(dialog).getByLabelText(/applies to all members/i));
    await user.click(within(dialog).getByRole('button', { name: 'Create Requirement' }));

    expect(mockCreateRequirement).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      'Select at least one member category, or check "Applies to all members"'
    );
  });
});

describe('TrainingRequirementsPage duplicate', () => {
  // The create endpoint defaults allows_external_credit to false, shift_credited
  // to the type's choice and recency_days to "no window", so a copy that omits
  // them is a different requirement wearing the original's name.
  const source = {
    id: 'req-src',
    name: 'Driver Recency',
    requirement_type: 'hours',
    source: 'department',
    training_type: 'continuing_education',
    required_hours: 12,
    frequency: 'annual',
    applies_to_all: true,
    active: true,
    due_date_type: 'calendar_period',
    allows_external_credit: true,
    shift_credited: true,
    recency_days: 90,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  beforeEach(() => {
    mockGetRequirements.mockReset();
    mockGetRequirements.mockResolvedValue([source]);
    mockGetCategories.mockReset();
    mockGetCategories.mockResolvedValue([]);
    mockCreateRequirement.mockReset();
    mockCreateRequirement.mockResolvedValue({ ...source, id: 'req-copy', name: 'Driver Recency (Copy)' });
  });

  it('carries external credit, shift credit and the recency window onto the copy', async () => {
    const user = userEvent.setup();
    renderWithRouter(<TrainingRequirementsPage />);

    await user.click(await screen.findByRole('button', { name: 'Duplicate requirement' }));

    await waitFor(() => expect(mockCreateRequirement).toHaveBeenCalledTimes(1));
    expect(mockCreateRequirement).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Driver Recency (Copy)',
        allows_external_credit: true,
        shift_credited: true,
        recency_days: 90,
      })
    );
  });
});

describe('TrainingRequirementsPage delete', () => {
  // The dialog asks the backend what uses the requirement first. Nothing:
  // a plain delete. Something: deactivate (recommended) or, for a department
  // clearing out what it set up, a permanent delete behind a typed name.
  const requirement = {
    id: 'req-del',
    name: 'Annual SCBA',
    requirement_type: 'hours',
    source: 'department',
    training_type: 'certification',
    required_hours: 4,
    frequency: 'annual',
    applies_to_all: true,
    active: true,
    due_date_type: 'calendar_period',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
  const inUse = {
    requirement_id: 'req-del',
    name: 'Annual SCBA',
    active: true,
    total: 4,
    references: [
      { kind: 'requirement_progress', label: 'Member pipeline progress records', count: 3, on_delete: 'removed' },
      { kind: 'compliance_profiles', label: 'Compliance profiles', count: 1, on_delete: 'unlinked' },
    ],
  };
  const unused = { requirement_id: 'req-del', name: 'Annual SCBA', active: true, total: 0, references: [] };

  beforeEach(() => {
    mockGetRequirements.mockReset();
    mockGetRequirements.mockResolvedValue([requirement]);
    mockGetCategories.mockReset();
    mockGetCategories.mockResolvedValue([]);
    mockDeleteRequirement.mockReset();
    mockDeleteRequirement.mockResolvedValue(undefined);
    mockUpdateRequirement.mockReset();
    mockUpdateRequirement.mockResolvedValue({ ...requirement, active: false });
    mockGetDeletionImpact.mockReset();
    mockGetDeletionImpact.mockResolvedValue(inUse);
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  const openDialog = async (user: ReturnType<typeof userEvent.setup>) => {
    renderWithRouter(<TrainingRequirementsPage />);
    await user.click(await screen.findByRole('button', { name: 'Delete Annual SCBA' }));
    return screen.findByRole('dialog', { name: 'Delete requirement' });
  };

  it('deletes an unused requirement after one confirmation', async () => {
    mockGetDeletionImpact.mockResolvedValue(unused);
    const user = userEvent.setup();
    const dialog = await openDialog(user);

    expect(await within(dialog).findByText(/Nothing uses .Annual SCBA., so it will be deleted/)).toBeInTheDocument();
    mockGetRequirements.mockResolvedValue([]);
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Requirement deleted'));
    expect(mockGetDeletionImpact).toHaveBeenCalledWith('req-del');
    expect(mockDeleteRequirement).toHaveBeenCalledWith('req-del', undefined);
  });

  it('reports a deactivation when something started using it after the check', async () => {
    mockGetDeletionImpact.mockResolvedValue(unused);
    const user = userEvent.setup();
    const dialog = await openDialog(user);

    mockGetRequirements.mockResolvedValue([{ ...requirement, active: false }]);
    await user.click(await within(dialog).findByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        '"Annual SCBA" is still in use, so it was deactivated instead of deleted'
      )
    );
  });

  it('lists what uses an in-use requirement, and Keep it changes nothing', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(user);

    const uses = await within(dialog).findByRole('list', { name: 'Records that use this requirement' });
    expect(uses).toHaveTextContent('Member pipeline progress records3');
    expect(uses).toHaveTextContent('Compliance profiles1');
    expect(within(dialog).getByRole('tab', { name: 'Deactivate (recommended)' })).toHaveAttribute(
      'aria-selected',
      'true'
    );

    await user.click(within(dialog).getByRole('button', { name: 'Keep it' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mockDeleteRequirement).not.toHaveBeenCalled();
    expect(mockUpdateRequirement).not.toHaveBeenCalled();
  });

  it('deactivates an in-use requirement and hides it from the list', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(user);

    await user.click(await within(dialog).findByRole('button', { name: 'Deactivate' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('"Annual SCBA" was deactivated'));
    expect(mockUpdateRequirement).toHaveBeenCalledWith('req-del', { active: false });
    expect(mockDeleteRequirement).not.toHaveBeenCalled();
    expect(screen.queryByText('Annual SCBA')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Show inactive (1)' })).not.toBeChecked();
  });

  it('permanently deletes only once the name is typed, after saying what goes', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(user);

    await user.click(await within(dialog).findByRole('tab', { name: 'Permanently delete' }));
    expect(dialog).toHaveTextContent('This is permanent and cannot be undone.');
    expect(dialog).toHaveTextContent('If members have been graded against it, deactivate it instead');
    expect(within(dialog).getByRole('list', { name: 'Deleted with it' })).toHaveTextContent(
      'Member pipeline progress records3'
    );
    expect(within(dialog).getByRole('list', { name: 'Kept, without this requirement' })).toHaveTextContent(
      'Compliance profiles1'
    );

    const confirmButton = within(dialog).getByRole('button', { name: 'Permanently delete' });
    expect(confirmButton).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/to confirm/), 'Annual SCB');
    expect(confirmButton).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/to confirm/), 'A');
    expect(confirmButton).toBeEnabled();

    mockGetRequirements.mockResolvedValue([]);
    await user.click(confirmButton);

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('"Annual SCBA" was permanently deleted'));
    expect(mockDeleteRequirement).toHaveBeenCalledWith('req-del', { permanent: true });
  });

  it('keeps the dialog open and reports a failed permanent delete', async () => {
    mockDeleteRequirement.mockRejectedValue(new Error('Server unavailable'));
    const user = userEvent.setup();
    const dialog = await openDialog(user);

    await user.click(await within(dialog).findByRole('tab', { name: 'Permanently delete' }));
    await user.type(within(dialog).getByLabelText(/to confirm/), 'Annual SCBA');
    await user.click(within(dialog).getByRole('button', { name: 'Permanently delete' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Server unavailable'));
    expect(screen.getByRole('dialog', { name: 'Delete requirement' })).toBeInTheDocument();
  });

  it('opens an already-inactive requirement on the permanent delete', async () => {
    mockGetRequirements.mockResolvedValue([{ ...requirement, active: false }]);
    mockGetDeletionImpact.mockResolvedValue({ ...inUse, active: false });
    const user = userEvent.setup();
    renderWithRouter(<TrainingRequirementsPage />);

    await user.click(await screen.findByRole('checkbox', { name: 'Show inactive (1)' }));
    await user.click(await screen.findByRole('button', { name: 'Delete Annual SCBA' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete requirement' });

    expect(await within(dialog).findByRole('tab', { name: 'Permanently delete' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });
});

describe('TrainingRequirementsPage inactive filter', () => {
  const base = {
    requirement_type: 'hours',
    source: 'department',
    required_hours: 4,
    frequency: 'annual',
    applies_to_all: true,
    due_date_type: 'calendar_period',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  beforeEach(() => {
    mockGetRequirements.mockReset();
    mockGetCategories.mockReset();
    mockGetCategories.mockResolvedValue([]);
  });

  it('hides inactive requirements until Show inactive is checked', async () => {
    mockGetRequirements.mockResolvedValue([
      { ...base, id: 'a', name: 'Live Requirement', active: true },
      { ...base, id: 'b', name: 'Retired Requirement', active: false },
    ]);
    const user = userEvent.setup();
    renderWithRouter(<TrainingRequirementsPage />);

    expect(await screen.findByText('Live Requirement')).toBeInTheDocument();
    expect(screen.queryByText('Retired Requirement')).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Show inactive (1)' }));
    expect(screen.getByText('Retired Requirement')).toBeInTheDocument();
  });

  it('says requirements are hidden rather than that there are none', async () => {
    mockGetRequirements.mockResolvedValue([{ ...base, id: 'b', name: 'Retired Requirement', active: false }]);
    const user = userEvent.setup();
    renderWithRouter(<TrainingRequirementsPage />);

    expect(
      await screen.findByText('1 inactive requirement is hidden. Select Show inactive to see it.')
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show inactive' }));
    expect(screen.getByText('Retired Requirement')).toBeInTheDocument();
  });
});
