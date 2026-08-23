import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
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

vi.mock('../services/api', () => ({
  trainingSubmissionService: {
    getConfig: (...args: unknown[]) => mockGetConfig(...args) as unknown,
    getMySubmissions: (...args: unknown[]) => mockGetMySubmissions(...args) as unknown,
    createSubmission: (...args: unknown[]) => mockCreateSubmission(...args) as unknown,
    uploadAttachment: (...args: unknown[]) => mockUploadAttachment(...args) as unknown,
    updateSubmission: vi.fn(),
    submitDraft: (...args: unknown[]) => mockSubmitDraft(...args) as unknown,
    deleteSubmission: vi.fn(),
    deleteAttachment: vi.fn(),
    getAttachments: vi.fn(),
    getAttachmentDownloadUrl: (id: string, index: number) =>
      `/api/v1/training/submissions/${id}/attachments/${index}/download`,
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

/** Fill everything the form requires, so a submit attempt actually goes out. */
async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/Course or class name/), 'Wildland S130');
  await user.selectOptions(screen.getByLabelText(/Category/), 'cat-ems');
  await user.type(screen.getByLabelText(/^Date/), '2026-03-12');
  await user.type(screen.getByLabelText(/Instructor/), 'Capt. Alvarez');
  await user.type(screen.getByLabelText(/What it covered/), 'Ground fire behavior.');
}

describe('SubmitTrainingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('renders the submit training page', async () => {
    renderWithRouter(<SubmitTrainingPage />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Submit External Training' })).toBeInTheDocument();
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

    expect(await screen.findByLabelText(/Training type/)).toHaveValue('specialty');
  });

  it('offers every active requirement as a datalist suggestion, deduped and unfiltered by type', async () => {
    renderWithRouter(<SubmitTrainingPage />);

    const courseName = await screen.findByLabelText(/Course or class name/);
    expect(courseName).toHaveAttribute('list', 'dept-requirement-suggestions');

    // A datalist's options are reachable through no Testing Library query —
    // they carry no accessible role of their own and the browser never renders
    // them as a list — so this reads the element directly, as
    // PageTransition.test.tsx does for the same reason.
    // eslint-disable-next-line testing-library/no-node-access
    const options = document.getElementById('dept-requirement-suggestions')?.querySelectorAll('option');
    const values = Array.from(options ?? []).map((option) => option.value);
    // Deduped, alphabetical, archived entries dropped, and NOT narrowed by
    // training type — the free-text field is what the member submits.
    expect(values).toEqual(['CPR Certification', 'Driver Refresher']);
  });

  it('keeps the course name when the training type changes', async () => {
    const user = userEvent.setup();
    renderWithRouter(<SubmitTrainingPage />);

    const courseName = await screen.findByLabelText(/Course or class name/);
    await user.type(courseName, 'CPR Certification');
    await user.selectOptions(screen.getByLabelText(/Training type/), 'refresher');

    expect(courseName).toHaveValue('CPR Certification');
  });

  it('shows the certification block from the checkbox, not the training type', async () => {
    const user = userEvent.setup();
    renderWithRouter(<SubmitTrainingPage />);

    const checkbox = await screen.findByLabelText('This training earned a certification');
    expect(checkbox).not.toBeChecked();
    expect(screen.queryByLabelText(/Certificate no\./)).not.toBeInTheDocument();

    // Selecting `certification` seeds the checkbox...
    await user.selectOptions(screen.getByLabelText(/Training type/), 'certification');
    expect(checkbox).toBeChecked();
    await user.type(screen.getByLabelText(/Certificate no\./), 'CPR-123');

    // ...but once the member owns the checkbox, the type no longer moves it,
    // and the values they typed survive.
    await user.click(checkbox);
    await user.click(checkbox);
    await user.selectOptions(screen.getByLabelText(/Training type/), 'refresher');
    expect(checkbox).toBeChecked();
    expect(screen.getByLabelText(/Certificate no\./)).toHaveValue('CPR-123');
  });

  it('derives hours from start time plus a stepped duration', async () => {
    const user = userEvent.setup();
    renderWithRouter(<SubmitTrainingPage />);

    await screen.findByLabelText(/Course or class name/);
    expect(screen.getByText('Runs 9:00 AM to 1:00 PM. Adjust in 15-minute steps.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Increase length by 15 minutes' }));
    expect(screen.getAllByText('4h 15m').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: '2h' }));
    expect(screen.getByText('Runs 9:00 AM to 11:00 AM. Adjust in 15-minute steps.')).toBeInTheDocument();
  });

  it('submits derived hours and omits blank optional fields', async () => {
    const user = userEvent.setup();
    renderWithRouter(<SubmitTrainingPage />);

    await screen.findByLabelText(/Course or class name/);
    await fillRequiredFields(user);
    await user.click(screen.getByRole('button', { name: /Submit Training/ }));

    await waitFor(() => {
      expect(mockCreateSubmission).toHaveBeenCalledWith({
        course_name: 'Wildland S130',
        training_type: 'continuing_education',
        completion_date: '2026-03-12',
        hours_completed: 4,
        credit_hours: 4,
        description: 'Ground fire behavior.',
        instructor: 'Capt. Alvarez',
        location: undefined,
        category_id: 'cat-ems',
        certification_number: undefined,
        issuing_agency: undefined,
        expiration_date: undefined,
      });
    });

    expect(await screen.findByText('Training Submitted')).toBeInTheDocument();
    expect(screen.getByText('Sent to the training officer for review.')).toBeInTheDocument();
  });

  it('blocks submit on a missing required field and focuses it', async () => {
    const user = userEvent.setup();
    renderWithRouter(<SubmitTrainingPage />);

    await screen.findByLabelText(/Course or class name/);
    await user.click(screen.getByRole('button', { name: /Submit Training/ }));

    expect(mockCreateSubmission).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Course or class name/)).toHaveFocus();
  });

  it('saves a draft without requiring the whole form', async () => {
    const user = userEvent.setup();
    renderWithRouter(<SubmitTrainingPage />);

    await user.type(await screen.findByLabelText(/Course or class name/), 'Half-written entry');
    await user.type(screen.getByLabelText(/^Date/), '2026-03-12');
    await user.click(screen.getByRole('button', { name: 'Save Draft' }));

    await waitFor(() => {
      expect(mockCreateSubmission).toHaveBeenCalledWith(expect.objectContaining({ save_as_draft: true }));
    });
  });

  it('shows the officer note at the top when a submission comes back', async () => {
    mockGetMySubmissions.mockResolvedValue([
      {
        id: 'sub-1',
        course_name: 'Hazmat Operations Refresher',
        training_type: 'refresher',
        completion_date: '2026-03-12',
        hours_completed: 4,
        status: 'revision_requested',
        reviewer_notes: 'Certificate number does not match the roster.',
        issuing_agency: 'VDFP',
        certification_number: '00-4471-B',
        submitted_at: '2026-03-12T12:00:00Z',
        updated_at: '2026-03-14T12:00:00Z',
        organization_id: 'org-1',
        submitted_by: 'user-1',
      },
    ]);
    renderWithRouter(<SubmitTrainingPage />);

    expect(await screen.findByText('A training officer asked for a change')).toBeInTheDocument();
    expect(screen.getByText('“Certificate number does not match the roster.”')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Fix and Resubmit/ })).toBeInTheDocument();
  });

  it('lists only the three most recent submissions until the full list is opened', async () => {
    mockGetMySubmissions.mockResolvedValue(
      ['A', 'B', 'C', 'D'].map((name, index) => ({
        id: `sub-${index}`,
        course_name: `Course ${name}`,
        training_type: 'refresher',
        completion_date: '2026-03-12',
        hours_completed: 4,
        status: 'approved',
        submitted_at: '2026-03-12T12:00:00Z',
        updated_at: '2026-03-12T12:00:00Z',
        organization_id: 'org-1',
        submitted_by: 'user-1',
      }))
    );
    const user = userEvent.setup();
    renderWithRouter(<SubmitTrainingPage />);

    expect(await screen.findByText('Course A')).toBeInTheDocument();
    expect(screen.queryByText('Course D')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'View all 4' }));
    expect(screen.getByText('Course D')).toBeInTheDocument();
  });

  it('rejects an attachment that is not a PDF or image', async () => {
    renderWithRouter(<SubmitTrainingPage />);

    await screen.findByLabelText(/Course or class name/);
    const input = screen.getByLabelText(/Attach certificate/, { selector: 'input' });
    // fireEvent, not user.upload: userEvent enforces the `accept` attribute,
    // and this asserts the guard behind it — a drag-drop or an "All files"
    // pick still has to be turned away.
    fireEvent.change(input, { target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] } });

    expect(await screen.findByText('Attach a PDF, JPG, or PNG.')).toBeInTheDocument();
  });

  it('rejects an attachment over the 10 MB cap', async () => {
    const user = userEvent.setup();
    renderWithRouter(<SubmitTrainingPage />);

    await screen.findByLabelText(/Course or class name/);
    const oversized = new File(['pdf'], 'scan.pdf', { type: 'application/pdf' });
    Object.defineProperty(oversized, 'size', { value: 11 * 1024 * 1024 });
    await user.upload(screen.getByLabelText(/Attach certificate/, { selector: 'input' }), oversized);

    expect(await screen.findByText('That file is over 10 MB. Try a smaller scan or photo.')).toBeInTheDocument();
  });

  it('stages a submission with an attachment as a draft so the file lands before routing', async () => {
    // An auto-approved submission is frozen the moment it exists — the
    // attachment endpoint refuses it and its training record has already been
    // copied — so the evidence has to be attached before the handoff.
    const user = userEvent.setup();
    renderWithRouter(<SubmitTrainingPage />);

    await screen.findByLabelText(/Course or class name/);
    await fillRequiredFields(user);
    const file = new File(['pdf'], 'certificate.pdf', { type: 'application/pdf' });
    await user.upload(screen.getByLabelText(/Attach certificate/, { selector: 'input' }), file);
    await user.click(screen.getByRole('button', { name: /Submit Training/ }));

    await waitFor(() => {
      expect(mockUploadAttachment).toHaveBeenCalledWith('sub-new', file);
    });
    expect(mockCreateSubmission).toHaveBeenCalledWith(expect.objectContaining({ save_as_draft: true }));
    expect(mockSubmitDraft).toHaveBeenCalledWith('sub-new');
    expect(await screen.findByText('Attached')).toBeInTheDocument();
    expect(screen.getByText('certificate.pdf')).toBeInTheDocument();
  });

  it('keeps the receipt on screen while the lists refresh behind it', async () => {
    // Caught in a browser, not here: the refresh after a save ran the page's
    // loading branch, which unmounted the form and took the receipt with it.
    // A test whose mocks resolve instantly never renders the spinner, so the
    // confirmation screen passed its test and never appeared in the app.
    let finishRefresh: (value: unknown) => void = () => {};
    mockGetMySubmissions.mockResolvedValueOnce([]).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRefresh = resolve;
        })
    );

    const user = userEvent.setup();
    renderWithRouter(<SubmitTrainingPage />);

    await screen.findByLabelText(/Course or class name/);
    await fillRequiredFields(user);
    await user.click(screen.getByRole('button', { name: /Submit Training/ }));

    expect(await screen.findByText('Training Submitted')).toBeInTheDocument();
    // The refresh is still in flight — the page must not swap to the spinner.
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    finishRefresh([]);
    expect(await screen.findByText('Training Submitted')).toBeInTheDocument();
  });

  it('files a submission without an attachment directly, with no draft round trip', async () => {
    const user = userEvent.setup();
    renderWithRouter(<SubmitTrainingPage />);

    await screen.findByLabelText(/Course or class name/);
    await fillRequiredFields(user);
    await user.click(screen.getByRole('button', { name: /Submit Training/ }));

    await waitFor(() => expect(mockCreateSubmission).toHaveBeenCalled());
    expect(mockCreateSubmission).toHaveBeenCalledWith(expect.not.objectContaining({ save_as_draft: true }));
    expect(mockSubmitDraft).not.toHaveBeenCalled();
  });

  it('treats a department with no configured maximum as a day, not 16 hours', async () => {
    mockGetConfig.mockResolvedValue({ ...mockConfig, max_hours_per_submission: null });
    const user = userEvent.setup();
    renderWithRouter(<SubmitTrainingPage />);

    await screen.findByLabelText(/Course or class name/);
    // 16h was the old fallback and would have stopped here.
    for (let i = 0; i < 5; i++) {
      await user.click(screen.getByRole('button', { name: 'Increase length by 15 minutes' }));
    }
    expect(screen.getAllByText('5h 15m').length).toBeGreaterThan(0);
    expect(screen.queryByText(/is the longest one entry can run/)).not.toBeInTheDocument();
  });

  it('enforces every field the department marked required', async () => {
    mockGetConfig.mockResolvedValue({
      ...mockConfig,
      field_config: {
        ...mockConfig.field_config,
        location: { visible: true, required: true, label: 'Location' },
        issuing_agency: { visible: true, required: true, label: 'Agency' },
      },
    });
    const user = userEvent.setup();
    renderWithRouter(<SubmitTrainingPage />);

    await screen.findByLabelText(/Course or class name/);
    await fillRequiredFields(user);
    await user.click(screen.getByRole('button', { name: /Submit Training/ }));

    // noValidate means this custom check is the only enforcement there is.
    expect(mockCreateSubmission).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Location/)).toHaveFocus();
  });

  it('hides the attachment control when the department has turned it off', async () => {
    mockGetConfig.mockResolvedValue({
      ...mockConfig,
      field_config: {
        ...mockConfig.field_config,
        attachments: { visible: false, required: false, label: 'Supporting Documents' },
      },
    });
    renderWithRouter(<SubmitTrainingPage />);

    await screen.findByLabelText(/Course or class name/);
    expect(screen.queryByLabelText(/Attach certificate/)).not.toBeInTheDocument();
  });

  it('does not enter edit mode against the placeholder id of an offline draft', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    mockCreateSubmission.mockResolvedValue({ id: 'pending-sync', status: 'pending_review' });
    const user = userEvent.setup();
    try {
      renderWithRouter(<SubmitTrainingPage />);

      await user.type(await screen.findByLabelText(/Course or class name/), 'Logged at the station');
      await user.type(screen.getByLabelText(/^Date/), '2026-03-12');
      await user.click(screen.getByRole('button', { name: 'Save Draft' }));

      await waitFor(() => expect(mockCreateSubmission).toHaveBeenCalled());
      // Editing mode would PATCH `/pending-sync`; the form must stay on a new entry.
      expect(screen.queryByText(/Editing your submission/)).not.toBeInTheDocument();
    } finally {
      onLine.mockRestore();
    }
  });

  it('handles config load failure', async () => {
    mockGetConfig.mockRejectedValue(new Error('Failed'));
    renderWithRouter(<SubmitTrainingPage />);
    await waitFor(() => {
      expect(screen.getByText('Failed to load submission form. Please try again.')).toBeInTheDocument();
    });
  });
});
