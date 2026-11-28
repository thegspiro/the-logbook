/**
 * Editing a saved draft: the form shows what was saved (it used to re-seed
 * from the copy it had before the save, putting the edit back), and leaving
 * the edit empties the form (it used to keep the old values as a new
 * submission, so the next Submit filed a second copy).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import SubmitTrainingPage from './SubmitTrainingPage';

const mockGetConfig = vi.fn();
const mockGetMySubmissions = vi.fn();
const mockGetCategories = vi.fn();
const mockGetRequirementsEnhanced = vi.fn();
const mockCreateSubmission = vi.fn();
const mockUploadAttachment = vi.fn();
const mockSubmitDraft = vi.fn();
const mockCreateWithAttachment = vi.fn();
const mockGetCrewContext = vi.fn();
const mockDeleteAttachment = vi.fn();
const mockGetAttachments = vi.fn();
const mockUpdateSubmission = vi.fn();

vi.mock('../services/api', () => ({
  trainingSubmissionService: {
    getConfig: (...args: unknown[]) => mockGetConfig(...args) as unknown,
    getCrewRecordingContext: (...args: unknown[]) => mockGetCrewContext(...args) as unknown,
    getMySubmissions: (...args: unknown[]) => mockGetMySubmissions(...args) as unknown,
    createSubmission: (...args: unknown[]) => mockCreateSubmission(...args) as unknown,
    createSubmissionWithAttachment: (...args: unknown[]) => mockCreateWithAttachment(...args) as unknown,
    uploadAttachment: (...args: unknown[]) => mockUploadAttachment(...args) as unknown,
    updateSubmission: (...args: unknown[]) => mockUpdateSubmission(...args) as unknown,
    submitDraft: (...args: unknown[]) => mockSubmitDraft(...args) as unknown,
    deleteSubmission: vi.fn(),
    deleteAttachment: (...args: unknown[]) => mockDeleteAttachment(...args) as unknown,
    getAttachments: (...args: unknown[]) => mockGetAttachments(...args) as unknown,
    getAttachmentDownloadUrl: (id: string, attachment: { index: number; id?: string | null }) =>
      `/api/v1/training/submissions/${id}/attachments/${attachment.id ?? attachment.index}/download`,
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
    course_name: { visible: true, required: true, label: 'Course or class name' },
    training_type: { visible: true, required: true, label: 'Training type' },
    completion_date: { visible: true, required: true, label: 'Date' },
    hours_completed: { visible: true, required: true, label: 'Hours' },
  },
  allowed_training_types: null,
  max_hours_per_submission: 24,
  member_instructions: 'Submit your external training for review.',
};

const draft = {
  id: 'sub-draft',
  course_name: 'Course A',
  training_type: 'continuing_education',
  completion_date: '2026-03-12',
  hours_completed: 4,
  status: 'draft',
  attachments: [],
  submitted_at: '2026-03-12T12:00:00Z',
  updated_at: '2026-03-12T12:00:00Z',
};

describe('SubmitTrainingPage editing a draft', () => {
  beforeEach(() => {
    // The form keeps a local draft in sessionStorage (forms review F-6); one
    // test's typing must not come back as the next test's restored draft.
    sessionStorage.clear();
    vi.clearAllMocks();
    mockGetCrewContext.mockReset();
    mockGetCrewContext.mockResolvedValue({ can_record: false, members: [] });
    mockGetConfig.mockResolvedValue(mockConfig);
    mockGetMySubmissions.mockResolvedValue([]);
    mockGetCategories.mockResolvedValue([
      { id: 'cat-ems', name: 'EMS' },
      { id: 'cat-fire', name: 'Fire Suppression' },
      { id: 'cat-child', name: 'Airway', parent_category_id: 'cat-ems' },
    ]);
    mockCreateSubmission.mockResolvedValue({
      id: 'sub-new',
      status: 'pending_review',
      course_name: 'Wildland S130',
      training_type: 'continuing_education',
      completion_date: '2026-03-12',
      hours_completed: 4,
      organization_id: 'org-1',
      submitted_by: 'user-1',
      submitted_at: '2026-03-12T12:00:00Z',
      updated_at: '2026-03-12T12:00:00Z',
    });
    mockUploadAttachment.mockResolvedValue({
      submission_id: 'sub-new',
      attachments: [{ index: 0, file_name: 'certificate.pdf' }],
    });
    mockSubmitDraft.mockResolvedValue({ id: 'sub-new', status: 'pending_review' });
    mockCreateWithAttachment.mockResolvedValue({ id: 'sub-new', status: 'pending_review' });
    mockGetRequirementsEnhanced.mockResolvedValue([
      { id: 'requirement-cpr', name: 'CPR Certification', active: true, requirement_type: 'certification' },
      { id: 'requirement-cpr-duplicate', name: 'CPR Certification', active: true, requirement_type: 'certification' },
      {
        id: 'requirement-driver',
        name: 'Driver Refresher',
        active: true,
        requirement_type: 'courses',
        training_type: 'refresher',
      },
      { id: 'requirement-archived', name: 'Archived Certification', active: false, requirement_type: 'certification' },
    ]);
  });

  const openDraft = async (user: ReturnType<typeof userEvent.setup>) => {
    mockGetMySubmissions.mockReset();
    mockGetMySubmissions.mockResolvedValue([draft]);
    mockUpdateSubmission.mockReset();
    mockUpdateSubmission.mockImplementation((_id: string, updates: Record<string, unknown>) =>
      Promise.resolve({ ...draft, ...updates })
    );
    mockUploadAttachment.mockResolvedValue({
      submission_id: 'sub-draft',
      attachments: [{ index: 0, id: 'a-1', file_name: 'certificate.pdf' }],
    });
    renderWithRouter(<SubmitTrainingPage />);
    await user.click(await screen.findByRole('button', { name: 'Edit Course A' }));
    return screen.findByLabelText(/Course or class name/);
  };

  it('keeps the edit on screen after saving it with a file', async () => {
    const user = userEvent.setup();
    const courseName = await openDraft(user);
    await waitFor(() => expect(courseName).toHaveValue('Course A'));

    await user.clear(courseName);
    await user.type(courseName, 'Course B');
    await user.upload(
      screen.getByLabelText(/Attach certificate/),
      new File(['%PDF'], 'certificate.pdf', { type: 'application/pdf' })
    );
    await user.click(screen.getByRole('button', { name: 'Save Draft' }));

    await waitFor(() => expect(mockUploadAttachment).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByLabelText(/Course or class name/)).toHaveValue('Course B'));
  });

  it('starts a new submission empty after Cancel', async () => {
    const user = userEvent.setup();
    const courseName = await openDraft(user);
    await waitFor(() => expect(courseName).toHaveValue('Course A'));

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.getByLabelText(/Course or class name/)).toHaveValue(''));
  });
});
