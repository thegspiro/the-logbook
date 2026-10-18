import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const getUsers = vi.fn();
const getCourses = vi.fn();
const getLocations = vi.fn();
const createSession = vi.fn();
const getBasicApparatus = vi.fn();

vi.mock('../services/api', () => ({
  userService: { getUsers: (...args: unknown[]) => getUsers(...args) as unknown },
  trainingService: { getCourses: (...args: unknown[]) => getCourses(...args) as unknown },
  locationsService: { getLocations: (...args: unknown[]) => getLocations(...args) as unknown },
  trainingSessionService: {
    createSession: (...args: unknown[]) => createSession(...args) as unknown,
    createRecurringSessions: vi.fn(),
  },
}));

vi.mock('../modules/scheduling/services/api', () => ({
  schedulingService: { getBasicApparatus: (...args: unknown[]) => getBasicApparatus(...args) as unknown },
}));

vi.mock('../hooks/useTrainingLinkageData', () => ({
  useTrainingLinkageData: () => ({ categories: [], requirements: [], programs: [], phases: [] }),
}));

vi.mock('../components/training/TrainingLinkageFields', () => ({ TrainingLinkageFields: () => null }));

vi.mock('../hooks/useRanks', () => ({ useRanks: () => ({ formatRank: (rank: string) => rank }) }));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import CreateTrainingSessionPage from './CreateTrainingSessionPage';

const INSTRUCTOR_ID = '7d4c1f0e-0000-4000-8000-0000000000aa';

describe('CreateTrainingSessionPage lead instructor', () => {
  beforeEach(() => {
    getUsers.mockReset();
    getUsers.mockResolvedValue([
      { id: INSTRUCTOR_ID, username: 'rcole', first_name: 'Rita', last_name: 'Cole', status: 'active' },
    ]);
    getCourses.mockReset();
    getCourses.mockResolvedValue([]);
    getLocations.mockReset();
    getLocations.mockResolvedValue([]);
    getBasicApparatus.mockReset();
    getBasicApparatus.mockResolvedValue([]);
    createSession.mockReset();
    createSession.mockResolvedValue({ id: 'session-1', event_id: 'event-1' });
  });

  // The page kept the picked member's id locally and sent only their name,
  // so the backend's instructor qualification checks never had a member to check.
  it('sends the picked member as instructor_id alongside the name', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);

    await user.type(screen.getByPlaceholderText('e.g., CPR/AED Renewal Training'), 'Ladder Drill');
    await user.type(screen.getByLabelText(/Start Date & Time/), '2030-05-01');
    await user.type(screen.getByLabelText(/End Date & Time/), '2030-05-01');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await user.type(screen.getByPlaceholderText('e.g., CPR/AED for Healthcare Providers'), 'Ladder Operations');
    const instructor = screen.getByDisplayValue('Select instructor...');
    await waitFor(() => expect(within(instructor).getByRole('option', { name: 'Rita Cole' })).toBeInTheDocument());
    await user.selectOptions(instructor, 'Rita Cole');

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: /Create Training Session/ }));

    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({ instructor: 'Rita Cole', instructor_id: INSTRUCTOR_ID })
    );
  });

  it('omits instructor_id when no lead instructor is picked', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);

    await user.type(screen.getByPlaceholderText('e.g., CPR/AED Renewal Training'), 'Ladder Drill');
    await user.type(screen.getByLabelText(/Start Date & Time/), '2030-05-01');
    await user.type(screen.getByLabelText(/End Date & Time/), '2030-05-01');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.type(screen.getByPlaceholderText('e.g., CPR/AED for Healthcare Providers'), 'Ladder Operations');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: /Create Training Session/ }));

    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
    const payload = createSession.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.instructor_id).toBeUndefined();
    expect(payload.instructor).toBeUndefined();
  });
});
