import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const getRequestFeedback = vi.fn();
vi.mock('../../services/api', () => ({
  eventRequestService: { getRequestFeedback: (...args: unknown[]) => getRequestFeedback(...args) as unknown },
}));
vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));

import RequestFeedbackSection from './RequestFeedbackSection';

describe('RequestFeedbackSection', () => {
  beforeEach(() => {
    getRequestFeedback.mockReset();
  });

  it('shows the rating and each answer, and counts the Sensitive ones', async () => {
    getRequestFeedback.mockResolvedValue({
      rating: 2,
      submitted_at: '2026-11-23T17:00:00Z',
      form_name: 'Outreach feedback',
      answers: [
        { question: 'How did the visit go?', answer: '2' },
        { question: 'What could we do better?', answer: 'Arrive earlier' },
      ],
      sensitive_answers: 1,
    });
    render(<RequestFeedbackSection requestId="r1" />);

    expect(await screen.findByText('Rated 2')).toBeInTheDocument();
    expect(screen.getByText('Arrive earlier')).toBeInTheDocument();
    expect(screen.getByText(/1 answer is to a question marked Sensitive/)).toBeInTheDocument();
    expect(getRequestFeedback).toHaveBeenCalledWith('r1');
  });

  it('says so when the requester has not answered', async () => {
    getRequestFeedback.mockResolvedValue(null);
    render(<RequestFeedbackSection requestId="r1" />);

    expect(await screen.findByText('The requester has not sent feedback.')).toBeInTheDocument();
  });
});
