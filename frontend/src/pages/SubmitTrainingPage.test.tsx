import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithRouter } from '../test/utils';
import SubmitTrainingPage from './SubmitTrainingPage';

const mockGetConfig = vi.fn();
const mockGetMySubmissions = vi.fn();
const mockGetCategories = vi.fn();

vi.mock('../services/api', () => ({
  trainingSubmissionService: {
    getConfig: (...args: unknown[]) => mockGetConfig(...args) as unknown,
    getMySubmissions: (...args: unknown[]) => mockGetMySubmissions(...args) as unknown,
    createSubmission: vi.fn(),
  },
  trainingService: {
    getCategories: (...args: unknown[]) => mockGetCategories(...args) as unknown,
  },
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: vi.fn((selector) => {
    const state = {
      user: {
        id: 'user-1',
        first_name: 'Test',
        last_name: 'User',
        email: 'test@example.com',
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

const mockConfig = {
  id: 'config-1',
  organization_id: 'org-1',
  require_approval: true,
  auto_approve_under_hours: 2,
  approval_deadline_days: 14,
  notify_officer_on_submit: true,
  notify_member_on_decision: true,
  field_config: {
    course_name: { visible: true, required: true, label: 'Course Name' },
    training_type: { visible: true, required: true, label: 'Training Type' },
    completion_date: { visible: true, required: true, label: 'Completion Date' },
    hours_completed: { visible: true, required: true, label: 'Hours' },
  },
  allowed_training_types: null,
  max_hours_per_submission: 24,
  member_instructions: 'Submit your external training for review.',
};

describe('SubmitTrainingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockResolvedValue(mockConfig);
    mockGetMySubmissions.mockResolvedValue([]);
    mockGetCategories.mockResolvedValue([]);
  });

  it('renders the submit training page', async () => {
    renderWithRouter(<SubmitTrainingPage />);
    await waitFor(() => {
      expect(screen.getByText(/Submit External Training/)).toBeInTheDocument();
    });
  });

  it('loads config on mount', async () => {
    renderWithRouter(<SubmitTrainingPage />);
    await waitFor(() => {
      expect(mockGetConfig).toHaveBeenCalledWith();
    });
  });

  it('loads submission history', async () => {
    renderWithRouter(<SubmitTrainingPage />);
    await waitFor(() => {
      expect(mockGetMySubmissions).toHaveBeenCalledWith();
    });
  });

  it('handles config load failure', async () => {
    mockGetConfig.mockRejectedValue(new Error('Failed'));
    renderWithRouter(<SubmitTrainingPage />);
    await waitFor(() => {
      expect(mockGetConfig).toHaveBeenCalledWith();
    });
    expect(document.body).toBeInTheDocument();
  });
});
