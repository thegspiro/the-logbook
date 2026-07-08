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
