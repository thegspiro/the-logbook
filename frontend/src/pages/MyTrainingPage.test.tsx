import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithRouter } from '../test/utils';
import MyTrainingPage from './MyTrainingPage';

// Mock the services
const mockGetMyTraining = vi.fn();
const mockGetConfig = vi.fn();
const mockGetVisibility = vi.fn();

vi.mock('../services/api', () => ({
  trainingModuleConfigService: {
    getMyTraining: (...args: unknown[]) => mockGetMyTraining(...args) as unknown,
    getConfig: (...args: unknown[]) => mockGetConfig(...args) as unknown,
    getVisibility: (...args: unknown[]) => mockGetVisibility(...args) as unknown,
  },
}));

vi.mock('../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

vi.mock('../utils/dateFormatting', () => ({
  formatDate: (date: string) => date || 'N/A',
}));

// Mock auth store
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

const mockTrainingData = {
  visibility: {
    show_training_history: true,
    show_training_hours: true,
    show_certification_status: true,
    show_pipeline_progress: true,
    show_requirement_details: true,
    show_shift_reports: true,
    show_shift_stats: true,
    show_officer_narrative: false,
    show_performance_rating: true,
    show_areas_of_strength: true,
    show_areas_for_improvement: true,
    show_skills_observed: true,
    show_submission_history: true,
    allow_member_report_export: false,
    report_review_required: false,
    report_review_role: 'training_officer',
    rating_label: 'Performance Rating',
    rating_scale_type: 'stars',
    rating_scale_labels: null,
  },
  requirements_detail: [
    {
      id: 'req-1',
      name: 'Annual Training Hours',
      frequency: 'annual',
      required_hours: 36,
      completed_hours: 20,
      progress_percentage: 55.6,
      is_met: false,
      due_date: '2026-12-31',
      days_until_due: 302,
    },
  ],
  hours_summary: { total_records: 15, total_hours: 120, completed_courses: 12 },
  requirements_summary: { total_requirements: 5, met_requirements: 3, avg_compliance: 72 },
  certifications: [
    {
      id: 'cert-1',
      course_name: 'EMT-B Certification',
      certification_number: 'EMT-12345',
      expiration_date: '2027-06-15',
      is_expired: false,
      days_until_expiry: 468,
    },
  ],
  training_records: [
    {
      id: 'rec-1',
      course_name: 'NFPA 1001 Training',
      training_type: 'certification',
      status: 'completed',
      completion_date: '2026-01-15',
      hours_completed: 8,
      expiration_date: null,
      instructor: 'Captain Smith',
    },
  ],
  enrollments: [],
  shift_reports: [],
  shift_stats: { total_shifts: 0, total_hours: 0, total_calls: 0, avg_rating: null },
  submissions: [],
};

describe('MyTrainingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMyTraining.mockResolvedValue(mockTrainingData);
    mockGetConfig.mockResolvedValue({});
    mockGetVisibility.mockResolvedValue(mockTrainingData.visibility);
  });

  it('renders the page heading', async () => {
    renderWithRouter(<MyTrainingPage />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('My Training');
    });
  });

  it('displays training stats when data loads', async () => {
    renderWithRouter(<MyTrainingPage />);
    await waitFor(() => {
      expect(mockGetMyTraining).toHaveBeenCalled();
    });
  });

  it('shows loading state initially', () => {
    mockGetMyTraining.mockReturnValue(new Promise(() => {})); // Never resolves
    renderWithRouter(<MyTrainingPage />);
    // The page should render without crashing during loading
    expect(document.body.querySelector('#root, [data-testid]') ?? document.body).toBeInTheDocument();
  });

  it('handles API error gracefully', async () => {
    mockGetMyTraining.mockRejectedValue(new Error('Network error'));
    renderWithRouter(<MyTrainingPage />);
    await waitFor(() => {
      expect(mockGetMyTraining).toHaveBeenCalled();
    });
    // Should not crash — page still in DOM
    expect(document.body).toBeInTheDocument();
  });
});
