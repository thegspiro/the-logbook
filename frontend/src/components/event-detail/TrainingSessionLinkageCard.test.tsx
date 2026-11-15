/**
 * The card is a read-only summary of the session (owner decision,
 * 2026-11-10): the training form edits it, and the card links an event
 * manager there. Its contracts worth pinning:
 *
 * What it reports comes from the session, as the backend holds it, including
 * the approval (pitfall #29), and a session with no course says what its
 * credit is filed under rather than naming the title as a course.
 *
 * The lock: the event's attendance lock, not the session's own flag, decides
 * what the card says may still change.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const mockGetSessionByEvent = vi.fn();
const mockGetApprovalSummary = vi.fn();
const mockReopenSession = vi.fn();
const mockGetCourses = vi.fn();
const mockGetCategories = vi.fn();
const mockGetRequirements = vi.fn();
const mockGetPrograms = vi.fn();
const mockGetProgramPhases = vi.fn();

vi.mock('../../services/api', () => ({
  trainingSessionService: {
    getSessionByEvent: (...args: unknown[]) => mockGetSessionByEvent(...args) as unknown,
    getApprovalSummary: (...args: unknown[]) => mockGetApprovalSummary(...args) as unknown,
    reopenSession: (...args: unknown[]) => mockReopenSession(...args) as unknown,
  },
  trainingService: {
    getCourses: (...args: unknown[]) => mockGetCourses(...args) as unknown,
    getCategories: (...args: unknown[]) => mockGetCategories(...args) as unknown,
    getRequirements: (...args: unknown[]) => mockGetRequirements(...args) as unknown,
  },
  trainingProgramService: {
    getPrograms: (...args: unknown[]) => mockGetPrograms(...args) as unknown,
    getProgramPhases: (...args: unknown[]) => mockGetProgramPhases(...args) as unknown,
  },
}));

const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: (...args: unknown[]) => mockToastError(...args) as unknown,
  },
}));

import TrainingSessionLinkageCard from './TrainingSessionLinkageCard';
import type { TrainingApprovalSummary, TrainingSessionResponse } from '../../services/adminServices';

const SESSION: TrainingSessionResponse = {
  id: 'sess-1',
  organization_id: 'org-1',
  event_id: 'evt-1',
  category_id: 'cat-ems',
  requirement_id: 'req-cpr',
  course_name: 'CPR / BLS',
  training_type: 'certification',
  credit_hours: 4,
  issues_certification: true,
  counts_toward_certification: true,
  auto_create_records: true,
  require_completion_confirmation: false,
  approval_deadline_days: 7,
  is_finalized: false,
  created_at: '',
  updated_at: '',
};

const PENDING: TrainingApprovalSummary = {
  approval_id: 'appr-1',
  status: 'pending',
  approval_deadline: '2030-04-22T20:00:00Z',
  approved_at: null,
  attendee_count: 3,
  expired: false,
  token: 'tok-123',
};

interface CardProps {
  canManage?: boolean;
  canApprove?: boolean;
  attendanceFinalized?: boolean;
  refreshKey?: number;
  onSessionChange?: (session: TrainingSessionResponse | null) => void;
  customFields?: Record<string, string | number | boolean | null> | undefined;
}

const renderCard = (initial: CardProps = {}) => {
  const ui = ({
    canManage = false,
    canApprove = false,
    attendanceFinalized = false,
    refreshKey = 0,
    onSessionChange,
    customFields,
  }: CardProps) => (
    <MemoryRouter>
      <TrainingSessionLinkageCard
        eventId="evt-1"
        eventTitle="Hose drill"
        canManage={canManage}
        canApprove={canApprove}
        attendanceFinalized={attendanceFinalized}
        refreshKey={refreshKey}
        onSessionChange={onSessionChange}
        customFields={customFields}
      />
    </MemoryRouter>
  );
  const view = render(ui(initial));
  return {
    ...view,
    rerenderWithKey: (refreshKey: number) => view.rerender(ui({ ...initial, refreshKey })),
    rerenderWith: (next: CardProps) => view.rerender(ui({ ...initial, ...next })),
  };
};

describe('TrainingSessionLinkageCard', () => {
  beforeEach(() => {
    mockToastError.mockReset();
    mockReopenSession.mockReset();
    mockGetSessionByEvent.mockReset();
    mockGetSessionByEvent.mockResolvedValue(SESSION);
    mockGetApprovalSummary.mockReset();
    mockGetApprovalSummary.mockResolvedValue(null);
    mockGetCourses.mockReset();
    mockGetCourses.mockResolvedValue([]);
    mockGetCategories.mockReset();
    mockGetCategories.mockResolvedValue([
      {
        id: 'cat-ems',
        organization_id: 'org-1',
        name: 'EMS',
        sort_order: 1,
        active: true,
        created_at: '',
        updated_at: '',
      },
    ]);
    mockGetRequirements.mockReset();
    mockGetRequirements.mockResolvedValue([
      {
        id: 'req-cpr',
        organization_id: 'org-1',
        name: 'CPR Renewal',
        requirement_type: 'hours',
        source: 'department',
        frequency: 'annual',
        applies_to_all: true,
        due_date_type: 'calendar_period',
        active: true,
        created_at: '',
        updated_at: '',
      },
    ]);
    mockGetPrograms.mockReset();
    mockGetPrograms.mockResolvedValue([]);
    mockGetProgramPhases.mockReset();
    mockGetProgramPhases.mockResolvedValue([]);
  });

  // A session the old Events form attached carried none of these: they were
  // written to the event's custom_fields only.
  describe('a session attached before the training form', () => {
    const LEGACY: TrainingSessionResponse = {
      ...SESSION,
      instructor: null,
      issues_certification: false,
      issuing_agency: null,
      expiration_months: null,
      auto_create_records: true,
    };
    const CUSTOM_FIELDS = {
      instructor: 'Capt. Owen Kittredge',
      issues_certification: true,
      issuing_agency: 'AHA',
      expiration_months: 24,
      auto_create_records: false,
    };

    beforeEach(() => {
      mockGetSessionByEvent.mockResolvedValue(LEGACY);
    });

    // Nothing reads these copies: finalize credits from the session, and the
    // training form shows the session. The card substituted them for it.
    it('reports the session as in effect, and the old copies as not applied', async () => {
      renderCard({ canManage: true, customFields: CUSTOM_FIELDS });

      expect(await screen.findByText('Training records')).toBeInTheDocument();
      expect(screen.getByText('None')).toBeInTheDocument();
      expect(screen.queryByText(/^Issued/)).not.toBeInTheDocument();
      expect(screen.queryByText('Lead Instructor')).not.toBeInTheDocument();
      expect(screen.getByText('Started at check-in, completed when attendance is finalized')).toBeInTheDocument();
      expect(
        within(screen.getByRole('list', { name: 'Entered on the old form, not applied' }))
          .getAllByRole('listitem')
          .map((item) => item.textContent)
      ).toEqual([
        'Lead instructor: Capt. Owen Kittredge',
        'Issues a certification',
        'Issuing agency: AHA',
        'Expires after 24 months',
        'Training records created only when attendance is finalized',
      ]);
      expect(screen.getByText('Attendance is credited with the details above.', { exact: false })).toHaveTextContent(
        'To use any of these, enter them with Edit training details.'
      );
    });

    it('prefers what the session holds', async () => {
      mockGetSessionByEvent.mockResolvedValue({
        ...LEGACY,
        instructor: 'Lt. Dana Okafor',
        instructor_id: 'u-1',
        issues_certification: true,
        issuing_agency: 'State Fire Training',
        expiration_months: 12,
      });
      renderCard({ customFields: CUSTOM_FIELDS });

      expect(await screen.findByText('Lt. Dana Okafor')).toBeInTheDocument();
      expect(screen.getByText('Issued by State Fire Training · expires after 12 months')).toBeInTheDocument();
      expect(screen.getByText('Lead instructor: Capt. Owen Kittredge')).toBeInTheDocument();
    });

    it('lists nothing as not applied when the copies match the session', async () => {
      mockGetSessionByEvent.mockResolvedValue({
        ...LEGACY,
        instructor: 'Capt. Owen Kittredge',
        issues_certification: true,
        issuing_agency: 'AHA',
        expiration_months: 24,
        auto_create_records: false,
      });
      renderCard({ customFields: CUSTOM_FIELDS });

      expect(await screen.findByText('Issued by AHA · expires after 24 months')).toBeInTheDocument();
      expect(screen.queryByText('Entered on the old form, not applied')).not.toBeInTheDocument();
    });
  });

  // Until the requirements load, every linked id matched nothing and read as retired.
  it('names no linked requirement as retired before the requirements have loaded', async () => {
    let release: (value: unknown) => void = () => {};
    mockGetRequirements.mockReturnValue(new Promise((resolve) => (release = resolve)));
    mockGetSessionByEvent.mockResolvedValue({ ...SESSION, attendance_requirement_ids: ['req-att'] });
    renderCard({ canManage: true });

    expect(await screen.findByText('Course')).toBeInTheDocument();
    expect(screen.queryByText('A requirement no longer active')).not.toBeInTheDocument();

    await act(async () => {
      release([
        {
          id: 'req-att',
          organization_id: 'org-1',
          name: 'Company Drill Attendance',
          requirement_type: 'session_attendance',
          required_attendance_pct: 60,
          source: 'department',
          frequency: 'annual',
          applies_to_all: true,
          due_date_type: 'calendar_period',
          active: true,
          created_at: '',
          updated_at: '',
        },
      ]);
      await Promise.resolve();
    });
    expect(screen.getByText('Company Drill Attendance (60%)')).toBeInTheDocument();
  });

  describe('an event with no training details', () => {
    beforeEach(() => {
      mockGetSessionByEvent.mockResolvedValue(null);
    });

    it('renders nothing for a member who can neither manage nor approve', async () => {
      const onSessionChange = vi.fn();
      const { container } = renderCard({ onSessionChange });

      await waitFor(() => expect(onSessionChange).toHaveBeenCalledWith(null));
      expect(container).toBeEmptyDOMElement();
    });

    it('tells an officer what the credit will be filed under, and offers to add details', async () => {
      renderCard({ canManage: true });

      expect(
        await screen.findByText(
          /No training details: attendance will be credited as .Hose drill., Continuing Education\./
        )
      ).toBeInTheDocument();
      // The training form adds them, opened on its Training Info step.
      expect(screen.getByRole('link', { name: 'Add training details' })).toHaveAttribute(
        'href',
        '/events/evt-1/edit?step=training'
      );
    });

    it('shows a training officer the same, without the add link', async () => {
      renderCard({ canApprove: true });

      expect(await screen.findByText(/No training details: attendance will be credited as/)).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Add training details' })).not.toBeInTheDocument();
    });

    it('points to a reopen once attendance is finalized', async () => {
      renderCard({ canManage: true, attendanceFinalized: true });

      expect(
        await screen.findByText('Details can be added after someone who can reopen attendance reopens it.')
      ).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Add training details' })).not.toBeInTheDocument();
    });

    it('claims nothing when the session could not be loaded', async () => {
      // Only a 404 means "no details"; the service turns that into null. Any
      // other failure is unknown, and offering to add details would only earn
      // a duplicate refusal.
      mockGetSessionByEvent.mockRejectedValue(new Error('Network Error'));
      const onSessionChange = vi.fn();
      const { container } = renderCard({ canManage: true, onSessionChange });

      await waitFor(() => expect(onSessionChange).toHaveBeenCalledWith(null));
      expect(container).toBeEmptyDOMElement();
    });
  });

  describe('an event with training details', () => {
    it('shows the details read-only', async () => {
      renderCard();

      expect(await screen.findByRole('heading', { name: 'Training details' })).toBeInTheDocument();
      // A one-off name, filed under itself.
      expect(screen.getByText('CPR / BLS')).toBeInTheDocument();
      expect(screen.getByText('Training Type')).toBeInTheDocument();
      // The type's label, beside the Certification row's own label.
      expect(screen.getAllByText('Certification')).toHaveLength(2);
      expect(screen.getByText('4 hours')).toBeInTheDocument();
      expect(screen.getByText('Issued')).toBeInTheDocument();
      expect(screen.getByText('Started at check-in, completed when attendance is finalized')).toBeInTheDocument();
      expect(screen.getByText('Counts toward certification')).toBeInTheDocument();
      expect(screen.getByText('Yes')).toBeInTheDocument();
      expect(await screen.findByText('CPR Renewal')).toBeInTheDocument();
      expect(screen.getByText('EMS')).toBeInTheDocument();
      expect(screen.queryByText(/Requires sign-off/)).not.toBeInTheDocument();
      // Nothing on the card edits: the training form does.
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    it('names a session with no course as filed under the event title, not as a course', async () => {
      mockGetSessionByEvent.mockResolvedValue({ ...SESSION, course_name: 'Hose drill' });
      renderCard();

      expect(await screen.findByText('No course yet (filed under the event title)')).toBeInTheDocument();
      expect(screen.queryByText('Hose drill')).not.toBeInTheDocument();
    });

    it('names a one-off course called as the event is by its code, not as filed under the title', async () => {
      mockGetSessionByEvent.mockResolvedValue({ ...SESSION, course_name: 'Hose drill', course_code: 'HD1' });
      renderCard();

      expect(await screen.findByText('HD1 - Hose drill')).toBeInTheDocument();
      expect(screen.queryByText('No course yet (filed under the event title)')).not.toBeInTheDocument();
    });

    it('names a library course with its code', async () => {
      mockGetSessionByEvent.mockResolvedValue({ ...SESSION, course_id: 'course-1', course_code: 'CPR' });
      renderCard();

      expect(await screen.findByText('CPR - CPR / BLS')).toBeInTheDocument();
    });

    it("shows the session's instructor, saying when the name is no member's", async () => {
      mockGetSessionByEvent.mockResolvedValue({ ...SESSION, instructor: 'Capt. Owen Kittredge', instructor_id: 'u-1' });
      const { unmount } = renderCard();
      expect(await screen.findByText('Capt. Owen Kittredge')).toBeInTheDocument();
      unmount();

      mockGetSessionByEvent.mockResolvedValue({
        ...SESSION,
        course_id: 'course-1',
        instructor: 'AHA Regional Faculty',
      });
      renderCard();
      expect(await screen.findByText('AHA Regional Faculty (from the course, not a member)')).toBeInTheDocument();
    });

    it('describes the certification and how records are completed', async () => {
      mockGetSessionByEvent.mockResolvedValue({
        ...SESSION,
        issuing_agency: 'State Fire Training',
        certification_number_prefix: 'PUMP-',
        expiration_months: 24,
        auto_create_records: false,
        counts_toward_certification: false,
      });
      renderCard();

      expect(
        await screen.findByText('Issued by State Fire Training · prefix PUMP- · expires after 24 months')
      ).toBeInTheDocument();
      expect(screen.getByText('Completed when attendance is finalized')).toBeInTheDocument();
      expect(screen.getByText('No')).toBeInTheDocument();
    });

    it('marks a session-attendance requirement linked the old way', async () => {
      mockGetRequirements.mockResolvedValue([
        {
          id: 'req-cpr',
          organization_id: 'org-1',
          name: 'Company Drill Attendance',
          requirement_type: 'session_attendance',
          source: 'department',
          frequency: 'annual',
          applies_to_all: true,
          due_date_type: 'calendar_period',
          active: true,
          created_at: '',
          updated_at: '',
        },
      ]);
      renderCard();

      expect(
        await screen.findByText('Company Drill Attendance (currently linked, no longer offered)')
      ).toBeInTheDocument();
    });

    it('badges a session whose credit waits for sign-off', async () => {
      mockGetSessionByEvent.mockResolvedValue({ ...SESSION, require_completion_confirmation: true });
      renderCard();

      expect(await screen.findByText('Requires sign-off by the instructor or a training officer')).toBeInTheDocument();
    });

    it("links an event manager to the training form's Training Info step", async () => {
      renderCard({ canManage: true });

      expect(await screen.findByRole('link', { name: 'Edit training details' })).toHaveAttribute(
        'href',
        '/events/evt-1/edit?step=training'
      );
    });

    it('offers no edit affordance without events.manage', async () => {
      renderCard({ canApprove: true });

      await screen.findByText('CPR / BLS');
      expect(screen.queryByRole('link', { name: 'Edit training details' })).not.toBeInTheDocument();
    });

    it("follows the event's attendance lock, not the session's own flag", async () => {
      // The session reads unfinalized; the event's lock still wins. Counts
      // toward attendance stays editable in the form, so the link stays.
      renderCard({ canManage: true, attendanceFinalized: true });

      expect(
        await screen.findByText(
          'Attendance is finalized. Counts toward attendance can still be changed with Edit training details; anything else needs Reopen Attendance first.'
        )
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Edit training details' })).toBeInTheDocument();
    });

    it('tells someone who cannot edit it only that attendance is finalized', async () => {
      renderCard({ canApprove: true, attendanceFinalized: true });

      expect(
        await screen.findByText('Attendance is finalized. Use Reopen Attendance on this event to make corrections.')
      ).toBeInTheDocument();
    });

    it('offers the edit link on an open event even when the session was finalized before a reopen', async () => {
      mockGetSessionByEvent.mockResolvedValue({ ...SESSION, is_finalized: true });
      renderCard({ canManage: true });

      expect(await screen.findByRole('link', { name: 'Edit training details' })).toBeInTheDocument();
    });

    it('no longer offers a separate session reopen', async () => {
      mockGetSessionByEvent.mockResolvedValue({ ...SESSION, is_finalized: true });
      renderCard({ canManage: true, canApprove: true, attendanceFinalized: true });

      await screen.findByText(/Attendance is finalized/);
      expect(screen.queryByRole('button', { name: /Reopen/ })).not.toBeInTheDocument();
      expect(mockReopenSession).not.toHaveBeenCalled();
    });

    it('keeps the details shown when a refetch fails', async () => {
      const { rerenderWithKey } = renderCard({ canManage: true });
      await screen.findByText('CPR / BLS');

      mockGetSessionByEvent.mockRejectedValue(new Error('Network Error'));
      rerenderWithKey(1);
      // Let the rejected fetch settle before looking.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(mockGetSessionByEvent).toHaveBeenCalledTimes(2);
      expect(screen.getByText('CPR / BLS')).toBeInTheDocument();
      expect(screen.queryByText(/No training details/)).not.toBeInTheDocument();
    });

    it('refetches when the page bumps the refresh key', async () => {
      const { rerenderWithKey } = renderCard();
      await screen.findByText('CPR / BLS');
      expect(mockGetSessionByEvent).toHaveBeenCalledTimes(1);

      mockGetSessionByEvent.mockResolvedValue({ ...SESSION, course_name: 'Pump Operations' });
      rerenderWithKey(1);

      expect(await screen.findByText('Pump Operations')).toBeInTheDocument();
      expect(mockGetSessionByEvent).toHaveBeenCalledTimes(2);
    });
  });

  describe('the approval, once attendance is finalized', () => {
    beforeEach(() => {
      mockGetSessionByEvent.mockResolvedValue({ ...SESSION, require_completion_confirmation: true });
    });

    it('links a training officer straight to the review', async () => {
      mockGetApprovalSummary.mockResolvedValue(PENDING);
      renderCard({ canApprove: true, attendanceFinalized: true });

      expect(
        await screen.findByText('Waiting for sign-off by the instructor or a training officer (3 members)')
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Review and approve' })).toHaveAttribute(
        'href',
        '/training/approve/tok-123'
      );
      expect(mockGetApprovalSummary).toHaveBeenCalledWith('evt-1');
    });

    it('shows an officer without training.manage the wait, but no link', async () => {
      mockGetApprovalSummary.mockResolvedValue({ ...PENDING, token: null });
      renderCard({ canManage: true, attendanceFinalized: true });

      expect(
        await screen.findByText('Waiting for sign-off by the instructor or a training officer (3 members)')
      ).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Review and approve' })).not.toBeInTheDocument();
    });

    it('offers no link without training.manage even if a token arrived', async () => {
      mockGetApprovalSummary.mockResolvedValue(PENDING);
      renderCard({ canManage: true, attendanceFinalized: true });

      await screen.findByText(/Waiting for sign-off/);
      expect(screen.queryByRole('link', { name: 'Review and approve' })).not.toBeInTheDocument();
    });

    it('says when an expired link needs a fresh finalize', async () => {
      mockGetApprovalSummary.mockResolvedValue({ ...PENDING, expired: true, token: null });
      renderCard({ canApprove: true, attendanceFinalized: true });

      expect(
        await screen.findByText('Approval link expired — reopen attendance and finalize again to issue a new one.')
      ).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Review and approve' })).not.toBeInTheDocument();
    });

    it('reports an approval that was given', async () => {
      mockGetApprovalSummary.mockResolvedValue({
        ...PENDING,
        status: 'approved',
        approved_at: '2030-04-18T15:00:00Z',
        token: null,
      });
      renderCard({ canManage: true, attendanceFinalized: true });

      expect(await screen.findByText(/^Approved /)).toBeInTheDocument();
    });

    it('drops the approval it showed before a reopen instead of flashing it after the next finalize', async () => {
      mockGetApprovalSummary.mockResolvedValue({ ...PENDING, expired: true, token: null });
      const { rerenderWith } = renderCard({ canApprove: true, attendanceFinalized: true });
      expect(await screen.findByText(/Approval link expired/)).toBeInTheDocument();

      rerenderWith({ attendanceFinalized: false, refreshKey: 1 });
      await waitFor(() => expect(mockGetSessionByEvent).toHaveBeenCalledTimes(2));

      // Finalized again; the new summary has not arrived yet.
      mockGetApprovalSummary.mockReturnValue(new Promise(() => undefined));
      rerenderWith({ attendanceFinalized: true, refreshKey: 2 });
      await waitFor(() => expect(mockGetApprovalSummary).toHaveBeenCalledTimes(2));

      expect(screen.queryByText(/Approval link expired/)).not.toBeInTheDocument();
    });

    it('stays silent when there is no approval to report', async () => {
      renderCard({ canManage: true, canApprove: true, attendanceFinalized: true });

      await waitFor(() => expect(mockGetApprovalSummary).toHaveBeenCalledWith('evt-1'));
      expect(screen.queryByText(/Waiting for sign-off/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Approval/)).not.toBeInTheDocument();
      expect(mockToastError).not.toHaveBeenCalled();
    });

    it('does not ask while attendance is still open, or for a plain member', async () => {
      const { unmount } = renderCard({ canManage: true, canApprove: true });
      await screen.findByText('CPR / BLS');
      unmount();

      renderCard({ attendanceFinalized: true });
      await screen.findByText('CPR / BLS');

      expect(mockGetApprovalSummary).not.toHaveBeenCalled();
    });
  });
});
