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
const mockGetMyTrainingRecords = vi.fn();
const mockGetTests = vi.fn();

vi.mock('../services/api', () => ({
  trainingModuleConfigService: {
    getMyTraining: (...args: unknown[]) => mockGetMyTraining(...args) as unknown,
    getConfig: (...args: unknown[]) => mockGetConfig(...args) as unknown,
    getVisibility: (...args: unknown[]) => mockGetVisibility(...args) as unknown,
    exportMyTraining: (...args: unknown[]) => mockExportMyTraining(...args) as unknown,
    getMyTrainingRecords: (...args: unknown[]) => mockGetMyTrainingRecords(...args) as unknown,
  },
  skillsTestingService: {
    getTests: (...args: unknown[]) => mockGetTests(...args) as unknown,
  },
}));

// The department's practical-skills method. Null is "unknown", which shows
// Skills Testing — what every test below that does not set it expects.
const skills = vi.hoisted(() => ({ method: null as string | null }));

vi.mock('../stores/practicalSkillsStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../stores/practicalSkillsStore')>()),
  usePracticalSkillsMethod: () => skills.method,
}));

vi.mock('../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

vi.mock('../utils/dateFormatting', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/dateFormatting')>()),
  formatDate: (date: string) => date || 'N/A',
  getTodayLocalDate: () => '2026-05-24',
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
    skills.method = null;
    mockGetTests.mockReset();
    mockGetTests.mockResolvedValue({ items: [], total: 0 });
    mockGetMyTraining.mockResolvedValue(mockTrainingData);
    mockGetConfig.mockResolvedValue({});
    mockGetVisibility.mockResolvedValue(mockTrainingData.visibility);
    mockExportMyTraining.mockResolvedValue(new Blob(['csv'], { type: 'text/csv' }));
    mockGetMyTrainingRecords.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25, years: [] });
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

  it('names each enrolled program and its requirements on the pipeline card', async () => {
    mockGetMyTraining.mockResolvedValue({
      ...mockTrainingData,
      enrollments: [
        {
          id: 'enr-1',
          program_id: 'prog-1',
          program_name: 'Driver Candidate Program',
          status: 'active',
          progress_percentage: 0,
          enrolled_at: '2026-09-29T06:48:44Z',
          target_completion_date: '2027-03-28',
          completed_at: null,
          requirements: [
            {
              id: 'rp-1',
              requirement_id: 'req-9',
              requirement_name: 'Supervised Driving Hours',
              status: 'not_started',
              progress_value: 0,
              progress_percentage: 0,
              completed_at: null,
            },
          ],
        },
      ],
    });
    renderWithRouter(<MyTrainingPage />);

    expect(await screen.findByRole('heading', { name: 'Driver Candidate Program' })).toBeInTheDocument();
    expect(screen.getByText(/Supervised Driving Hours ·/)).toBeInTheDocument();
  });

  it('lists an undated pending record under the default date range', async () => {
    mockGetMyTraining.mockResolvedValue({
      ...mockTrainingData,
      training_records: [
        ...mockTrainingData.training_records,
        {
          id: 'rec-pending',
          course_name: 'Awaiting Sign-off',
          training_type: 'continuing_education',
          status: 'scheduled',
          completion_date: null,
          hours_completed: 0,
          expiration_date: null,
          instructor: null,
        },
      ],
    });
    renderWithRouter(<MyTrainingPage />);
    expect(await screen.findByText('Awaiting Sign-off')).toBeInTheDocument();
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

    it('offers no save bar until a setting changes, then counts the changes', async () => {
      auth.permissions = ['training.configure'];
      mockGetConfig.mockResolvedValue({
        show_training_history: true,
        show_officer_narrative: false,
        report_review_required: false,
        rating_scale_type: 'stars',
      });
      const user = userEvent.setup();
      renderWithRouter(<MyTrainingPage />);

      await user.click(await screen.findByRole('button', { name: /member visibility settings/i }));
      const history = await screen.findByRole('checkbox', { name: /training history/i });
      expect(screen.queryByRole('button', { name: /^save/i })).not.toBeInTheDocument();

      await user.click(history);
      expect(screen.getByRole('status')).toHaveTextContent('1 unsaved change');
      expect(screen.getByRole('button', { name: 'Save 1 Change' })).toBeInTheDocument();

      await user.click(screen.getByRole('checkbox', { name: /officer narrative/i }));
      expect(screen.getByRole('status')).toHaveTextContent('2 unsaved changes');
      expect(screen.getByRole('button', { name: 'Save 2 Changes' })).toBeInTheDocument();
    });

    it('keeps the overview usable when the settings fetch fails', async () => {
      auth.permissions = ['training.manage'];
      mockGetConfig.mockRejectedValue(new Error('config unavailable'));
      renderWithRouter(<MyTrainingPage />);

      // The overview loaded; an editor-only outage must not replace it with a
      // full-page error.
      expect(await screen.findByText(/Completed Courses/)).toBeInTheDocument();
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
      expect(await screen.findByText(/Completed Courses/)).toBeInTheDocument();
      expect(screen.queryByText(/Completed Hours/)).not.toBeInTheDocument();
    });

    it('shows the completed-hours stat when show_training_hours is on', async () => {
      renderWithRouter(<MyTrainingPage />);
      expect(await screen.findByText(/Completed Hours/)).toBeInTheDocument();
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

    it('shows each evaluation form average on its own scale beside the report rating', async () => {
      mockGetMyTraining.mockResolvedValue({
        ...mockTrainingData,
        shift_stats: {
          shifts_completed: 4,
          hours_reported: 48,
          total_calls: 11,
          avg_rating: 4.5,
          evaluation_averages: [
            { template_id: 't-1', form_name: 'EMT Shift Evaluation', scale_max: 4, average: 3.3, evaluations: 5 },
          ],
        },
      });
      renderWithRouter(<MyTrainingPage />);

      expect(await screen.findByText('EMT Shift Evaluation')).toBeInTheDocument();
      expect(screen.getByText('3.3 / 4')).toBeInTheDocument();
      expect(screen.getByText('5 evaluations')).toBeInTheDocument();
      expect(screen.getByText('4.5/5')).toBeInTheDocument();
    });

    it('shows evaluation averages before any shift report exists', async () => {
      mockGetMyTraining.mockResolvedValue({
        ...mockTrainingData,
        shift_stats: {
          shifts_completed: 0,
          hours_reported: 0,
          total_calls: 0,
          avg_rating: null,
          evaluation_averages: [
            { template_id: 't-1', form_name: 'EMT Shift Evaluation', scale_max: 4, average: 2, evaluations: 1 },
          ],
        },
      });
      renderWithRouter(<MyTrainingPage />);

      expect(await screen.findByText('2 / 4')).toBeInTheDocument();
      expect(screen.getByText('1 evaluation')).toBeInTheDocument();
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

    await user.click(await screen.findByRole('button', { name: /^history$/i }));
    const exportBtn = await screen.findByRole('button', { name: /export csv/i });
    await user.click(exportBtn);

    await waitFor(() => {
      expect(mockExportMyTraining).toHaveBeenCalledWith('csv');
    });
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));

    vi.unstubAllGlobals();
  });

  describe('landing view and history tab', () => {
    const user = userEvent.setup();

    it('reports the calendar year to date rather than lifetime totals', async () => {
      mockGetMyTraining.mockResolvedValue({
        ...mockTrainingData,
        hours_summary: {
          total_records: 169,
          total_hours: 144.5,
          completed_courses: 169,
          year_to_date_courses: 18,
          year_to_date_hours: 21.5,
          year: 2026,
        },
      });
      renderWithRouter(<MyTrainingPage />);
      expect(await screen.findByText('Completed Courses · 2026')).toBeInTheDocument();
      expect(screen.getByText('Completed Hours · 2026')).toBeInTheDocument();
      expect(screen.getByText('18')).toBeInTheDocument();
      expect(screen.getByText('21.5')).toBeInTheDocument();
    });

    it('lists upcoming deadlines and expirations in one place', async () => {
      renderWithRouter(<MyTrainingPage />);
      expect(await screen.findByText('Upcoming Expirations & Due Dates')).toBeInTheDocument();
      expect(screen.getAllByText('Annual Training Hours').length).toBeGreaterThan(0);
    });

    it('announces the next early-credit window of a requirement that is already met', async () => {
      mockGetMyTraining.mockResolvedValue({
        ...mockTrainingData,
        requirements_detail: [
          {
            id: 'hipaa',
            name: 'HIPAA Privacy',
            frequency: 'annual',
            required_hours: 1,
            completed_hours: 1,
            progress_percentage: 100,
            is_met: true,
            due_date: '2026-10-31',
            days_until_due: 160,
            next_window_opens: '2026-11-01',
          },
        ],
      });
      renderWithRouter(<MyTrainingPage />);
      expect(await screen.findByText('Next completion window opens')).toBeInTheDocument();
    });

    it('shows the counting window instead of a due date for a rolling hours requirement, with its months on request', async () => {
      mockGetMyTraining.mockResolvedValue({
        ...mockTrainingData,
        requirements_detail: [
          {
            id: 'hours',
            name: 'Annual Training Hours',
            frequency: 'annual',
            required_hours: 72,
            completed_hours: 3,
            progress_percentage: 4,
            is_met: false,
            due_date: null,
            days_until_due: null,
            window_months: 12,
            monthly_hours: [
              { month: '2025-11', hours: 2 },
              { month: '2025-12', hours: 1 },
            ],
          },
        ],
      });
      renderWithRouter(<MyTrainingPage />);
      expect(await screen.findByText('Counting Nov 2025 – Dec 2025')).toBeInTheDocument();
      expect(screen.queryByText(/Due:/)).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /show monthly hours/i }));
      expect(screen.getByLabelText('Nov 2025: 2 hours')).toBeInTheDocument();
    });

    it('lists an unmet rolling hours requirement in the upcoming list by what is left to earn', async () => {
      mockGetMyTraining.mockResolvedValue({
        ...mockTrainingData,
        requirements_detail: [
          {
            id: 'hours',
            name: 'Annual Training Hours',
            frequency: 'annual',
            required_hours: 72,
            completed_hours: 19.5,
            progress_percentage: 27,
            is_met: false,
            due_date: null,
            days_until_due: null,
            window_months: 12,
            monthly_hours: [{ month: '2025-11', hours: 19.5 }],
          },
        ],
      });
      renderWithRouter(<MyTrainingPage />);
      expect(await screen.findByText('52.5 hrs to go')).toBeInTheDocument();
    });

    it('moves the full history to its own tab and shows only recent records on the landing view', async () => {
      renderWithRouter(<MyTrainingPage />);
      expect(await screen.findByText('Recent Training')).toBeInTheDocument();
      expect(screen.queryByText('Training records date range')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /^history$/i }));
      expect(await screen.findByText('All-time courses completed')).toBeInTheDocument();
      expect(mockGetMyTrainingRecords).toHaveBeenCalled();
    });

    it('opens the history tab from the recent-training link', async () => {
      renderWithRouter(<MyTrainingPage />);
      await user.click(await screen.findByRole('button', { name: /view full history/i }));
      expect(await screen.findByText('All-time courses completed')).toBeInTheDocument();
    });

    it('draws no History tab when the department hides training history', async () => {
      mockGetMyTraining.mockResolvedValue({
        ...mockTrainingData,
        visibility: { ...mockTrainingData.visibility, show_training_history: false },
      });
      renderWithRouter(<MyTrainingPage />);
      await screen.findByText('Upcoming Expirations & Due Dates');
      expect(screen.queryByRole('button', { name: /^history$/i })).not.toBeInTheDocument();
      expect(screen.queryByText('Recent Training')).not.toBeInTheDocument();
    });
  });

  describe('first-time member guidance', () => {
    const emptyRecord = {
      ...mockTrainingData,
      requirements_detail: [],
      requirements_summary: { total_requirements: 0, met_requirements: 0, avg_compliance: null },
      hours_summary: { total_records: 0, total_hours: 0, hours_this_month: 0, completed_courses: 0 },
      certifications: [],
      training_records: [],
    };

    it('explains how training reaches an empty record and links the walkthrough', async () => {
      mockGetMyTraining.mockResolvedValue(emptyRecord);
      renderWithRouter(<MyTrainingPage />);

      expect(
        await screen.findByRole('heading', { name: 'Nothing is on your training record yet' })
      ).toBeInTheDocument();
      expect(screen.getByText('Attend a department training.')).toBeInTheDocument();
      expect(screen.getByText('Submit training you did elsewhere.')).toBeInTheDocument();
      expect(screen.getByText('Take a skills test.')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /walkthrough in the Learning Center/ })).toHaveAttribute(
        'href',
        '/learning/training'
      );
      expect(screen.getByRole('button', { name: 'Submit External Training' })).toBeInTheDocument();
    });

    it('says no required training is assigned rather than N/A', async () => {
      mockGetMyTraining.mockResolvedValue(emptyRecord);
      renderWithRouter(<MyTrainingPage />);

      expect(await screen.findByText('None assigned')).toBeInTheDocument();
      expect(screen.getByText('Your department has not assigned you any required training yet.')).toBeInTheDocument();
      expect(screen.queryByText('N/A')).not.toBeInTheDocument();
    });

    it('reports how many requirements are met beside the average', async () => {
      renderWithRouter(<MyTrainingPage />);

      expect(await screen.findByText('72%')).toBeInTheDocument();
      expect(screen.getByText('3 of 5 requirements met')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Nothing is on your training record yet' })).not.toBeInTheDocument();
    });
  });

  describe('past skills test results under shift-report sign-offs', () => {
    const pastResult = {
      id: 'test-1',
      template_id: 'tpl-1',
      template_name: 'SCBA Donning',
      candidate_id: 'user-1',
      candidate_name: 'Test User',
      examiner_id: 'user-2',
      examiner_name: 'Captain Jones',
      status: 'completed' as const,
      result: 'pass' as const,
      is_practice: false,
      overall_score: 94,
      completed_at: '2026-03-01T12:00:00Z',
      created_at: '2026-03-01T11:00:00Z',
    };

    it('offers a read-only section to a member with results on file', async () => {
      skills.method = 'shift_signoffs';
      mockGetTests.mockResolvedValue({ items: [pastResult], total: 1 });
      const user = userEvent.setup();
      renderWithRouter(<MyTrainingPage />);

      const toggle = await screen.findByRole('button', { name: /Past skills test results/ });
      expect(screen.queryByRole('button', { name: /^Skills Tests$/ })).not.toBeInTheDocument();
      // Scoped to the member's own tests, not the department's.
      expect(mockGetTests).toHaveBeenCalledWith(expect.objectContaining({ candidate_id: 'user-1' }));

      await user.click(toggle);
      expect(await screen.findByText(/no new skills tests are taken/)).toBeInTheDocument();
      expect(await screen.findByText('SCBA Donning')).toBeInTheDocument();
    });

    it('draws nothing for a member with no results on file', async () => {
      skills.method = 'shift_signoffs';
      renderWithRouter(<MyTrainingPage />);

      await waitFor(() => expect(mockGetTests).toHaveBeenCalled());
      expect(screen.queryByRole('button', { name: /Past skills test results/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Skills Tests$/ })).not.toBeInTheDocument();
    });

    it('keeps the ordinary Skills Tests section for a Skills Testing department', async () => {
      skills.method = 'skills_testing';
      renderWithRouter(<MyTrainingPage />);

      expect(await screen.findByRole('button', { name: /^Skills Tests$/ })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Past skills test results/ })).not.toBeInTheDocument();
    });
  });
});
