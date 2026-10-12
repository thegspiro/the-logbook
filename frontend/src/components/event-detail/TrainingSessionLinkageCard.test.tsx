/**
 * The card has two contracts worth pinning.
 *
 * The update contract: every field the editor owns goes on every save, and a
 * link the officer cleared travels as an explicit `null`. Omitting the key
 * means "leave this alone" on the backend, so a dropped null would leave the
 * old link in place behind a success toast (CLAUDE.md pitfall #1).
 *
 * The lock: the event's attendance lock, not the session's own flag, decides
 * whether details may change, and the card reports the approval the backend
 * holds rather than guessing at it (pitfall #29).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const mockGetSessionByEvent = vi.fn();
const mockUpdateSessionLinkage = vi.fn();
const mockAttachSession = vi.fn();
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
    updateSessionLinkage: (...args: unknown[]) => mockUpdateSessionLinkage(...args) as unknown,
    attachSession: (...args: unknown[]) => mockAttachSession(...args) as unknown,
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

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => mockToastSuccess(...args) as unknown,
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
}

const renderCard = (initial: CardProps = {}) => {
  const ui = ({
    canManage = false,
    canApprove = false,
    attendanceFinalized = false,
    refreshKey = 0,
    onSessionChange,
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
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
    mockReopenSession.mockReset();
    mockGetSessionByEvent.mockReset();
    mockGetSessionByEvent.mockResolvedValue(SESSION);
    mockUpdateSessionLinkage.mockReset();
    mockUpdateSessionLinkage.mockResolvedValue({ ...SESSION, category_id: undefined });
    mockAttachSession.mockReset();
    mockAttachSession.mockResolvedValue({ ...SESSION, id: 'sess-new', training_type: 'skills_practice' });
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
      expect(screen.getByRole('button', { name: 'Add training details' })).toBeInTheDocument();
    });

    it('shows a training officer the same, without the add button', async () => {
      renderCard({ canApprove: true });

      expect(await screen.findByText(/No training details: attendance will be credited as/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Add training details' })).not.toBeInTheDocument();
    });

    it('points to a reopen once attendance is finalized', async () => {
      renderCard({ canManage: true, attendanceFinalized: true });

      expect(
        await screen.findByText('Details can be added after someone who can reopen attendance reopens it.')
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Add training details' })).not.toBeInTheDocument();
    });

    it('attaches only what was picked and reports the new session', async () => {
      const onSessionChange = vi.fn();
      const user = userEvent.setup();
      renderCard({ canManage: true, onSessionChange });

      await user.click(await screen.findByRole('button', { name: 'Add training details' }));
      const addButton = screen.getByRole('button', { name: 'Add details' });
      // Nothing picked yet: attaching would change nothing about the credit.
      expect(addButton).toBeDisabled();

      await user.selectOptions(screen.getByLabelText('Training Type'), 'skills_practice');
      await user.click(addButton);

      await waitFor(() =>
        expect(mockAttachSession).toHaveBeenCalledWith('evt-1', { training_type: 'skills_practice' })
      );
      await waitFor(() =>
        expect(onSessionChange).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'sess-new' }))
      );
      expect(await screen.findByText('Skills Practice')).toBeInTheDocument();
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

    it("shows the backend's reason when the attach is refused", async () => {
      mockAttachSession.mockRejectedValue(
        Object.assign(new Error('Request failed with status code 409'), {
          response: { status: 409, data: { detail: 'This event already has training details' } },
        })
      );
      const user = userEvent.setup();
      renderCard({ canManage: true });

      await user.click(await screen.findByRole('button', { name: 'Add training details' }));
      await user.selectOptions(screen.getByLabelText('Training Type'), 'refresher');
      await user.click(screen.getByRole('button', { name: 'Add details' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('This event already has training details');
    });
  });

  describe('an event with training details', () => {
    it('shows the details read-only', async () => {
      renderCard();

      expect(await screen.findByText('Requirements & Programs')).toBeInTheDocument();
      expect(screen.getByText('CPR / BLS')).toBeInTheDocument();
      expect(screen.getByText('Certification')).toBeInTheDocument();
      expect(screen.getByText('4 hours')).toBeInTheDocument();
      expect(await screen.findByText('CPR Renewal')).toBeInTheDocument();
      expect(screen.getByText('EMS')).toBeInTheDocument();
      expect(screen.queryByText('Requires training officer approval')).not.toBeInTheDocument();
    });

    it('badges a session whose credit waits for a training officer', async () => {
      mockGetSessionByEvent.mockResolvedValue({ ...SESSION, require_completion_confirmation: true });
      renderCard();

      expect(await screen.findByText('Requires training officer approval')).toBeInTheDocument();
    });

    it('offers no edit affordance without events.manage', async () => {
      renderCard({ canApprove: true });

      await screen.findByText('CPR / BLS');
      expect(screen.queryByRole('button', { name: /Edit details/ })).not.toBeInTheDocument();
    });

    it('sends every field on save, with cleared links as explicit null', async () => {
      const user = userEvent.setup();
      renderCard({ canManage: true });

      await user.click(await screen.findByRole('button', { name: /Edit details/ }));
      expect(screen.getByText('Changes apply when attendance is next finalized.')).toBeInTheDocument();
      await screen.findByRole('option', { name: 'EMS' });
      // Clear the category; the requirement link stays as it was
      await user.selectOptions(screen.getByLabelText('Training Category'), '');
      await user.click(screen.getByRole('button', { name: 'Save details' }));

      await waitFor(() =>
        expect(mockUpdateSessionLinkage).toHaveBeenCalledWith('sess-1', {
          course_id: null,
          category_id: null,
          program_id: null,
          phase_id: null,
          requirement_id: 'req-cpr',
          training_type: 'certification',
        })
      );
    });

    it('never offers a blank type when editing, since a type cannot be cleared', async () => {
      const user = userEvent.setup();
      renderCard({ canManage: true });

      await user.click(await screen.findByRole('button', { name: /Edit details/ }));
      expect(screen.getByLabelText('Training Type')).toHaveValue('certification');
      expect(screen.queryByRole('option', { name: 'Default (Continuing Education)' })).not.toBeInTheDocument();
    });

    it('leaves edit mode without saving when cancelled', async () => {
      const user = userEvent.setup();
      renderCard({ canManage: true });

      await user.click(await screen.findByRole('button', { name: /Edit details/ }));
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(mockUpdateSessionLinkage).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: 'Save details' })).not.toBeInTheDocument();
    });

    it("follows the event's attendance lock, not the session's own flag", async () => {
      // The session reads unfinalized; the event's lock still wins.
      renderCard({ canManage: true, attendanceFinalized: true });

      expect(
        await screen.findByText('Attendance is finalized. Use Reopen Attendance on this event to make corrections.')
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Edit details/ })).not.toBeInTheDocument();
    });

    it('allows editing an open event even when the session was finalized before a reopen', async () => {
      mockGetSessionByEvent.mockResolvedValue({ ...SESSION, is_finalized: true });
      renderCard({ canManage: true });

      expect(await screen.findByRole('button', { name: /Edit details/ })).toBeInTheDocument();
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

      expect(await screen.findByText('Waiting for training officer approval (3 members)')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Review and approve' })).toHaveAttribute(
        'href',
        '/training/approve/tok-123'
      );
      expect(mockGetApprovalSummary).toHaveBeenCalledWith('evt-1');
    });

    it('shows an officer without training.manage the wait, but no link', async () => {
      mockGetApprovalSummary.mockResolvedValue({ ...PENDING, token: null });
      renderCard({ canManage: true, attendanceFinalized: true });

      expect(await screen.findByText('Waiting for training officer approval (3 members)')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Review and approve' })).not.toBeInTheDocument();
    });

    it('offers no link without training.manage even if a token arrived', async () => {
      mockGetApprovalSummary.mockResolvedValue(PENDING);
      renderCard({ canManage: true, attendanceFinalized: true });

      await screen.findByText(/Waiting for training officer approval/);
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
      expect(screen.queryByText(/Waiting for training officer approval/)).not.toBeInTheDocument();
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
