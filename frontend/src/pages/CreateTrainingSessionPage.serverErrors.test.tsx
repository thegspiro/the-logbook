import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const createSession = vi.fn();

vi.mock('../services/api', () => ({
  userService: { getUsers: vi.fn().mockResolvedValue([]) },
  trainingService: { getCourses: vi.fn().mockResolvedValue([]) },
  locationsService: { getLocations: vi.fn().mockResolvedValue([]) },
  trainingSessionService: {
    createSession: (...args: unknown[]) => createSession(...args) as unknown,
    createRecurringSessions: vi.fn(),
  },
}));

vi.mock('../hooks/useTrainingLinkageData', () => ({
  useTrainingLinkageData: () => ({ categories: [], requirements: [], programs: [], phases: [] }),
}));
vi.mock('../components/training/TrainingLinkageFields', () => ({ TrainingLinkageFields: () => null }));
vi.mock('../hooks/useRanks', () => ({ useRanks: () => ({ formatRank: (rank: string) => rank }) }));
vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import CreateTrainingSessionPage from './CreateTrainingSessionPage';

async function fillAndReachReview(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/Training Title/), 'CPR recert night');
  await user.type(screen.getByLabelText(/Start Date & Time/), '2030-05-01');
  await user.type(screen.getByLabelText(/End Date & Time/), '2030-05-02');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.type(screen.getByLabelText(/Course Name/), 'CPR');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByRole('button', { name: 'Next' }));
}

describe('CreateTrainingSessionPage › refusals on their fields', () => {
  beforeEach(() => {
    createSession.mockReset();
    createSession.mockResolvedValue({ id: 'session-1', event_id: 'event-1' });
  });

  it("takes the officer back to the server's refused title, flagged and announced", async () => {
    createSession.mockRejectedValueOnce({
      response: {
        status: 422,
        data: { detail: [{ field: 'title', message: 'String should have at most 200 characters' }] },
      },
    });
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);
    await fillAndReachReview(user);
    await user.click(screen.getByRole('button', { name: /Create Training Session/ }));

    const title = await screen.findByLabelText(/Training Title/);
    expect(title).toHaveAccessibleDescription('Training title is too long — keep it to 200 characters.');
    expect(title).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(title).toHaveFocus());
  });

  it('creates nothing without a course name and flags it on its step', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CreateTrainingSessionPage />);
    await user.type(screen.getByLabelText(/Training Title/), 'CPR recert night');
    await user.type(screen.getByLabelText(/Start Date & Time/), '2030-05-01');
    await user.type(screen.getByLabelText(/End Date & Time/), '2030-05-02');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: /Create Training Session/ }));

    expect(await screen.findByLabelText(/Course Name/)).toHaveAccessibleDescription(
      'Enter a course name or choose an existing course'
    );
    expect(createSession).not.toHaveBeenCalled();
  });
});
