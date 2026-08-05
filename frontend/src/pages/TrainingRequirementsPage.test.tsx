import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';
import { renderWithRouter } from '../test/utils';
import TrainingRequirementsPage from './TrainingRequirementsPage';

const mockGetRequirements = vi.fn();
const mockGetCategories = vi.fn();
const mockCreateRequirement = vi.fn();

vi.mock('../services/api', () => ({
  trainingService: {
    getRequirements: (...args: unknown[]) => mockGetRequirements(...args) as unknown,
    getCategories: (...args: unknown[]) => mockGetCategories(...args) as unknown,
    createRequirement: (...args: unknown[]) => mockCreateRequirement(...args) as unknown,
    updateRequirement: vi.fn(),
    deleteRequirement: vi.fn(),
  },
  trainingProgramService: {
    getRegistries: vi.fn().mockResolvedValue([]),
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
      expect(mockCreateRequirement).toHaveBeenCalledWith(
        expect.objectContaining({ frequency: 'one_time' })
      );
    });
    const payload = mockCreateRequirement.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.year).toBeUndefined();
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
