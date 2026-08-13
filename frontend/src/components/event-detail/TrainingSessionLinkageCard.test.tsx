/**
 * The edit card's job is the update contract: every linkage field the form
 * owns goes on every save, and a link the officer cleared travels as an
 * explicit `null`. Omitting the key means "leave this alone" on the backend,
 * so a dropped null would leave the old link in place behind a success toast
 * (CLAUDE.md pitfall #1).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetSessionByEvent = vi.fn();
const mockUpdateSessionLinkage = vi.fn();
const mockGetCategories = vi.fn();
const mockGetRequirements = vi.fn();
const mockGetPrograms = vi.fn();
const mockGetProgramPhases = vi.fn();

vi.mock('../../services/api', () => ({
  trainingSessionService: {
    getSessionByEvent: (...args: unknown[]) => mockGetSessionByEvent(...args) as unknown,
    updateSessionLinkage: (...args: unknown[]) => mockUpdateSessionLinkage(...args) as unknown,
  },
  trainingService: {
    getCategories: (...args: unknown[]) => mockGetCategories(...args) as unknown,
    getRequirements: (...args: unknown[]) => mockGetRequirements(...args) as unknown,
  },
  trainingProgramService: {
    getPrograms: (...args: unknown[]) => mockGetPrograms(...args) as unknown,
    getProgramPhases: (...args: unknown[]) => mockGetProgramPhases(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import TrainingSessionLinkageCard from './TrainingSessionLinkageCard';

const SESSION = {
  id: 'sess-1',
  organization_id: 'org-1',
  event_id: 'evt-1',
  category_id: 'cat-ems',
  requirement_id: 'req-cpr',
  course_name: 'CPR / BLS',
  training_type: 'certification',
  credit_hours: 4,
  issues_certification: true,
  auto_create_records: true,
  require_completion_confirmation: false,
  approval_deadline_days: 7,
  is_finalized: false,
  created_at: '',
  updated_at: '',
};

describe('TrainingSessionLinkageCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSessionByEvent.mockResolvedValue(SESSION);
    mockUpdateSessionLinkage.mockResolvedValue({ ...SESSION, category_id: undefined, requirement_id: undefined });
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
    mockGetPrograms.mockResolvedValue([]);
    mockGetProgramPhases.mockResolvedValue([]);
  });

  it('renders nothing for an event with no training session', async () => {
    mockGetSessionByEvent.mockResolvedValue(null);
    const { container } = render(<TrainingSessionLinkageCard eventId="evt-1" canManage />);

    await waitFor(() => expect(mockGetSessionByEvent).toHaveBeenCalledWith('evt-1'));
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the session's current links read-only", async () => {
    render(<TrainingSessionLinkageCard eventId="evt-1" canManage={false} />);

    expect(await screen.findByText('Requirements & Programs')).toBeInTheDocument();
    expect(await screen.findByText('CPR Renewal')).toBeInTheDocument();
    expect(screen.getByText('EMS')).toBeInTheDocument();
  });

  it('offers no edit affordance without events.manage', async () => {
    render(<TrainingSessionLinkageCard eventId="evt-1" canManage={false} />);

    await screen.findByText('Requirements & Programs');
    expect(screen.queryByRole('button', { name: /Edit links/ })).not.toBeInTheDocument();
  });

  it('sends every field on save, with cleared links as explicit null', async () => {
    const user = userEvent.setup();
    render(<TrainingSessionLinkageCard eventId="evt-1" canManage />);

    await user.click(await screen.findByRole('button', { name: /Edit links/ }));
    // Clear the category; the requirement link stays as it was
    await user.selectOptions(screen.getByLabelText('Training Category'), '');
    await user.click(screen.getByRole('button', { name: 'Save links' }));

    await waitFor(() =>
      expect(mockUpdateSessionLinkage).toHaveBeenCalledWith('sess-1', {
        category_id: null,
        program_id: null,
        phase_id: null,
        requirement_id: 'req-cpr',
      })
    );
  });

  it('leaves edit mode without saving when cancelled', async () => {
    const user = userEvent.setup();
    render(<TrainingSessionLinkageCard eventId="evt-1" canManage />);

    await user.click(await screen.findByRole('button', { name: /Edit links/ }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(mockUpdateSessionLinkage).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Save links' })).not.toBeInTheDocument();
  });

  it('tells the officer when nothing is linked yet', async () => {
    mockGetSessionByEvent.mockResolvedValue({ ...SESSION, category_id: undefined, requirement_id: undefined });
    render(<TrainingSessionLinkageCard eventId="evt-1" canManage />);

    expect(await screen.findByText(/won't count toward one automatically/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add links/ })).toBeInTheDocument();
  });
});
