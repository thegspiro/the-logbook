import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import SubmitTrainingPage from './SubmitTrainingPage';

const mockGetConfig = vi.fn();
const mockGetMySubmissions = vi.fn();
const mockGetCategories = vi.fn();
const mockGetRequirementsEnhanced = vi.fn();

vi.mock('../services/api', () => ({
  trainingSubmissionService: {
    getConfig: (...args: unknown[]) => mockGetConfig(...args) as unknown,
    getMySubmissions: (...args: unknown[]) => mockGetMySubmissions(...args) as unknown,
    createSubmission: vi.fn(),
  },
  trainingService: {
    getCategories: (...args: unknown[]) => mockGetCategories(...args) as unknown,
  },
  trainingProgramService: {
    getRequirementsEnhanced: (...args: unknown[]) => mockGetRequirementsEnhanced(...args) as unknown,
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
    mockGetRequirementsEnhanced.mockResolvedValue([
      {
        id: 'requirement-cpr',
        name: 'CPR Certification',
        active: true,
        requirement_type: 'certification',
      },
      {
        id: 'requirement-cpr-duplicate',
        name: 'CPR Certification',
        active: true,
        requirement_type: 'certification',
      },
      {
        id: 'requirement-driver',
        name: 'Driver Refresher',
        active: true,
        requirement_type: 'courses',
        training_type: 'refresher',
      },
      {
        id: 'requirement-archived',
        name: 'Archived Certification',
        active: false,
        requirement_type: 'certification',
      },
    ]);
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

  it('defaults to the first training type allowed by the department', async () => {
    mockGetConfig.mockResolvedValue({ ...mockConfig, allowed_training_types: ['specialty', 'certification'] });
    renderWithRouter(<SubmitTrainingPage />);

    expect(await screen.findByLabelText('Training Type *')).toHaveValue('specialty');
  });

  it('asks for training type first and suggests matching department requirements', async () => {
    const user = userEvent.setup();
    renderWithRouter(<SubmitTrainingPage />);

    const trainingType = await screen.findByLabelText('Training Type *');
    const courseName = screen.getByLabelText('Course Name *');
    expect(Boolean(trainingType.compareDocumentPosition(courseName) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);

    await user.selectOptions(trainingType, 'certification');

    const suggestion = screen.getByLabelText('Suggested Certification');
    expect(screen.getAllByRole('option', { name: 'CPR Certification' })).toHaveLength(1);
    expect(screen.queryByRole('option', { name: 'Driver Refresher' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Archived Certification' })).not.toBeInTheDocument();

    await user.selectOptions(suggestion, 'CPR Certification');
    expect(courseName).toHaveValue('CPR Certification');

    const certificateNumber = screen.getByLabelText('Certificate / ID Number');
    await user.type(certificateNumber, 'CPR-123');
    await user.selectOptions(trainingType, 'refresher');
    expect(courseName).toHaveValue('');
    expect(screen.queryByLabelText('Certificate / ID Number')).not.toBeInTheDocument();

    await user.selectOptions(trainingType, 'certification');
    expect(screen.getByLabelText('Certificate / ID Number')).toHaveValue('');

    await user.clear(courseName);
    await user.type(courseName, 'Community CPR Course');
    expect(courseName).toHaveValue('Community CPR Course');
    expect(screen.getByText('You can still enter a different course.', { exact: false })).toBeInTheDocument();
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
