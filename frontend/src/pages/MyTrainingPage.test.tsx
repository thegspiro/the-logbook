import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import MyTrainingPage from './MyTrainingPage';

// Mock the services
const mockGetMyTraining = vi.fn();
const mockGetConfig = vi.fn();
const mockGetVisibility = vi.fn();
const mockExportMyTraining = vi.fn();

vi.mock('../services/api', () => ({
  trainingModuleConfigService: {
    getMyTraining: (...args: unknown[]) => mockGetMyTraining(...args) as unknown,
    getConfig: (...args: unknown[]) => mockGetConfig(...args) as unknown,
    getVisibility: (...args: unknown[]) => mockGetVisibility(...args) as unknown,
    exportMyTraining: (...args: unknown[]) => mockExportMyTraining(...args) as unknown,
  },
}));

vi.mock('../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

vi.mock('../utils/dateFormatting', () => ({
  formatDate: (date: string) => date || 'N/A',
  getTodayLocalDate: () => '2026-05-24',
  toLocalDateString: () => '2025-05-24',
}));

// Mock auth store. `permissions` is mutable so a test can put the caller in a
// role that may configure the panel — the settings tab is gated on the grant,
// not on whether GET /config happened to return 200.
const auth = vi.hoisted(() => ({ permissions: [] as string[] }));

vi.mock('../stores/authStore', () => ({
  useAuthStore: vi.fn((selector) => {
    const state = {
      user: {
        id: 'user-1',
        first_name: 'Test',
        last_name: 'User',
        email: 'test@example.com',
        role: { slug: 'member' },
        permissions: auth.permissions,
      },
      checkPermission: (permission: string) => auth.permissions.includes(permission),
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
  hours_summary: { total_records: 15, total_hours: 120, hours_this_month: 8, completed_courses: 12 },
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
  shift_stats: { shifts_completed: 0, hours_reported: 0, total_calls: 0, avg_rating: null },
  submissions: [],
};

describe('MyTrainingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.permissions = [];
    mockGetMyTraining.mockResolvedValue(mockTrainingData);
    mockGetConfig.mockResolvedValue({});
    mockGetVisibility.mockResolvedValue(mockTrainingData.visibility);
    mockExportMyTraining.mockResolvedValue(new Blob(['csv'], { type: 'text/csv' }));
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
      expect(mockGetMyTraining).toHaveBeenCalledWith();
    });
  });

  it('shows loading state initially', () => {
    mockGetMyTraining.mockReturnValue(new Promise(() => {})); // Never resolves
    renderWithRouter(<MyTrainingPage />);
    // The page should show loading skeleton
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('handles API error gracefully', async () => {
    mockGetMyTraining.mockRejectedValue(new Error('Network error'));
    renderWithRouter(<MyTrainingPage />);
    await waitFor(() => {
      expect(mockGetMyTraining).toHaveBeenCalledWith();
    });
    // Should not crash — error message visible
    await waitFor(() => {
      expect(screen.getByText(/Network error/)).toBeInTheDocument();
    });
  });

  it('hides the export button when allow_member_report_export is disabled', async () => {
    renderWithRouter(<MyTrainingPage />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /export csv/i })).not.toBeInTheDocument();
  });

  describe('member visibility settings tab', () => {
    it('is hidden from a member who cannot configure the panel', async () => {
      renderWithRouter(<MyTrainingPage />);
      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
      });

      // The tab used to appear for everybody: it was gated on GET /config
      // returning 200, and that endpoint is open to every authenticated
      // member. A firefighter could read the department's disclosure policy
      // and press a Save button that could only 403.
      expect(screen.queryByRole('button', { name: /member visibility settings/i })).not.toBeInTheDocument();
      expect(mockGetConfig).not.toHaveBeenCalled();
    });

    it('is shown to a membership coordinator holding training.configure', async () => {
      auth.permissions = ['training.configure'];
      renderWithRouter(<MyTrainingPage />);

      expect(await screen.findByRole('button', { name: /member visibility settings/i })).toBeInTheDocument();
      await waitFor(() => {
        expect(mockGetConfig).toHaveBeenCalled();
      });
    });

    it('is shown to a training officer holding training.manage', async () => {
      auth.permissions = ['training.manage'];
      renderWithRouter(<MyTrainingPage />);

      expect(await screen.findByRole('button', { name: /member visibility settings/i })).toBeInTheDocument();
    });
  });

  describe('settings panel scope', () => {
    it('offers a training.configure holder only the disclosure settings', async () => {
      auth.permissions = ['training.configure'];
      mockGetConfig.mockResolvedValue({ report_review_required: false, rating_scale_type: 'stars' });
      const user = userEvent.setup();
      renderWithRouter(<MyTrainingPage />);

      await user.click(await screen.findByRole('button', { name: /member visibility settings/i }));

      // The backend refuses these fields without training.manage, so showing
      // them would be offering a control that can only 403.
      expect(await screen.findByText(/Control what training data members can see/)).toBeInTheDocument();
      expect(screen.queryByText('Shift Report Configuration')).not.toBeInTheDocument();
      expect(screen.queryByText('Report Review Workflow')).not.toBeInTheDocument();
      expect(screen.queryByText('Rating Scale')).not.toBeInTheDocument();
    });

    it('offers the shift-report half to a training.manage holder', async () => {
      auth.permissions = ['training.manage'];
      mockGetConfig.mockResolvedValue({ report_review_required: false, rating_scale_type: 'stars' });
      const user = userEvent.setup();
      renderWithRouter(<MyTrainingPage />);

      await user.click(await screen.findByRole('button', { name: /member visibility settings/i }));

      expect(await screen.findByText('Shift Report Configuration')).toBeInTheDocument();
      expect(screen.getByText('Report Review Workflow')).toBeInTheDocument();
    });

    it('keeps the overview usable when the settings fetch fails', async () => {
      auth.permissions = ['training.manage'];
      mockGetConfig.mockRejectedValue(new Error('config unavailable'));
      renderWithRouter(<MyTrainingPage />);

      // The overview loaded; an editor-only outage must not replace it with a
      // full-page error.
      expect(await screen.findByText('Completed Courses')).toBeInTheDocument();
      expect(screen.queryByText(/config unavailable/)).not.toBeInTheDocument();

      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /member visibility settings/i }));
      expect(await screen.findByRole('alert')).toHaveTextContent(/config unavailable/);
    });
  });

  describe('visibility flags the page had stopped honouring', () => {
    const withVisibility = (overrides: Record<string, boolean>) => ({
      ...mockTrainingData,
      visibility: { ...mockTrainingData.visibility, ...overrides },
    });

    it('hides the completed-hours stat when show_training_hours is off', async () => {
      mockGetMyTraining.mockResolvedValue({
        ...withVisibility({ show_training_hours: false }),
        // The backend withholds the figure too, rather than sending a number
        // the page merely declines to draw.
        hours_summary: { total_records: 15, completed_courses: 12 },
      });
      renderWithRouter(<MyTrainingPage />);

      // The course count is history, not hours, and stays.
      expect(await screen.findByText('Completed Courses')).toBeInTheDocument();
      expect(screen.queryByText('Completed Hours')).not.toBeInTheDocument();
    });

    it('shows the completed-hours stat when show_training_hours is on', async () => {
      renderWithRouter(<MyTrainingPage />);
      expect(await screen.findByText('Completed Hours')).toBeInTheDocument();
    });

    it('hides the requirements breakdown when show_requirement_details is off', async () => {
      mockGetMyTraining.mockResolvedValue(withVisibility({ show_requirement_details: false }));
      renderWithRouter(<MyTrainingPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
      });
      expect(screen.queryByText('Training Requirements')).not.toBeInTheDocument();
      expect(screen.queryByText('Annual Training Hours')).not.toBeInTheDocument();
    });

    it('renders shift statistics, which show_shift_stats promised and no code drew', async () => {
      mockGetMyTraining.mockResolvedValue({
        ...mockTrainingData,
        shift_stats: { shifts_completed: 4, hours_reported: 48, total_calls: 11, avg_rating: 4.5 },
      });
      renderWithRouter(<MyTrainingPage />);

      expect(await screen.findByText('Shift Statistics')).toBeInTheDocument();
      expect(screen.getByText('Shifts Completed')).toBeInTheDocument();
      expect(screen.getByText('11')).toBeInTheDocument();
    });

    it('omits shift statistics when show_shift_stats is off', async () => {
      mockGetMyTraining.mockResolvedValue({
        ...withVisibility({ show_shift_stats: false }),
        shift_stats: { shifts_completed: 4, hours_reported: 48, total_calls: 11, avg_rating: 4.5 },
      });
      renderWithRouter(<MyTrainingPage />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
      });
      expect(screen.queryByText('Shift Statistics')).not.toBeInTheDocument();
    });
  });

  it('exports the member training record when enabled', async () => {
    mockGetMyTraining.mockResolvedValue({
      ...mockTrainingData,
      visibility: { ...mockTrainingData.visibility, allow_member_report_export: true },
    });
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });

    const user = userEvent.setup();
    renderWithRouter(<MyTrainingPage />);

    const exportBtn = await screen.findByRole('button', { name: /export csv/i });
    await user.click(exportBtn);

    await waitFor(() => {
      expect(mockExportMyTraining).toHaveBeenCalledWith('csv', expect.any(String), expect.any(String));
    });
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));

    vi.unstubAllGlobals();
  });
});
