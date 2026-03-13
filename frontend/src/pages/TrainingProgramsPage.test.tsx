import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithRouter } from '../test/utils';
import TrainingProgramsPage from './TrainingProgramsPage';

const mockGetPrograms = vi.fn();
const mockGetRequirementsEnhanced = vi.fn();
const mockGetRegistries = vi.fn();

vi.mock('../services/api', () => ({
  trainingProgramService: {
    getPrograms: (...args: unknown[]) => mockGetPrograms(...args) as unknown,
    getRequirementsEnhanced: (...args: unknown[]) => mockGetRequirementsEnhanced(...args) as unknown,
    getRegistries: (...args: unknown[]) => mockGetRegistries(...args) as unknown,
  },
}));

vi.mock('../utils/errorHandling', () => ({
  getErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: vi.fn((selector) => {
    const state = {
      user: {
        id: 'user-1',
        first_name: 'Test',
        last_name: 'User',
        role: { slug: 'member' },
        permissions: [],
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

describe('TrainingProgramsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPrograms.mockResolvedValue([
      {
        id: 'prog-1',
        name: 'Probationary Firefighter',
        description: '12-month probationary program',
        structure_type: 'sequential',
        target_position: 'probationary',
        active: true,
        is_template: false,
        version: 1,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ]);
    mockGetRequirementsEnhanced.mockResolvedValue([]);
    mockGetRegistries.mockResolvedValue([]);
  });

  it('renders the programs page', async () => {
    renderWithRouter(<TrainingProgramsPage />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Training Programs');
    });
  });

  it('loads programs on mount', async () => {
    renderWithRouter(<TrainingProgramsPage />);
    await waitFor(() => {
      expect(mockGetPrograms).toHaveBeenCalledWith();
    });
  });

  it('renders without crashing on empty data', async () => {
    mockGetPrograms.mockResolvedValue([]);
    const { container } = renderWithRouter(<TrainingProgramsPage />);
    expect(container).toBeInTheDocument();
  });
});
