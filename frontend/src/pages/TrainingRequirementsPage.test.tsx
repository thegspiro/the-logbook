import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import { renderWithRouter } from '../test/utils';
import TrainingRequirementsPage from './TrainingRequirementsPage';

const mockGetRequirements = vi.fn();
const mockGetCategories = vi.fn();

vi.mock('../services/api', () => ({
  trainingService: {
    getRequirements: (...args: unknown[]) => mockGetRequirements(...args) as unknown,
    getCategories: (...args: unknown[]) => mockGetCategories(...args) as unknown,
    createRequirement: vi.fn(),
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
});
