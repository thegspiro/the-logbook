/**
 * FollowUpAnswersPanel — the applicant's follow-up answers on the Interview
 * page, with sensitive answers shown or withheld as the backend decided.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { FollowUpAnswers, FollowUpFormRequest } from '../types';

const mockList = vi.fn();
const mockGetAnswers = vi.fn();

vi.mock('../services/api', () => ({
  followUpFormService: {
    list: (...a: unknown[]) => mockList(...a) as unknown,
    getAnswers: (...a: unknown[]) => mockGetAnswers(...a) as unknown,
  },
}));

import FollowUpAnswersPanel from './FollowUpAnswersPanel';

const request = (overrides: Partial<FollowUpFormRequest> = {}): FollowUpFormRequest => ({
  id: 'request-1',
  prospect_id: 'prospect-1',
  step_id: 'step-2',
  step_name: 'Background Questionnaire',
  form_name: 'Background Questionnaire',
  status: 'submitted',
  submitted_at: '2026-10-29T14:00:00Z',
  changes: [],
  contact_changed: false,
  ...overrides,
});

const answers = (overrides: Partial<FollowUpAnswers> = {}): FollowUpAnswers => ({
  request_id: 'request-1',
  step_name: 'Background Questionnaire',
  form_name: 'Background Questionnaire',
  submitted_at: '2026-10-29T14:00:00Z',
  answers: [
    { field_id: 'f1', label: 'Why now?', answer: 'I moved to the district.', is_sensitive: false, withheld: false },
    { field_id: 'f2', label: 'Criminal history', answer: null, is_sensitive: true, withheld: true },
  ],
  ...overrides,
});

describe('FollowUpAnswersPanel', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockGetAnswers.mockReset();
    mockList.mockResolvedValue([request()]);
    mockGetAnswers.mockResolvedValue(answers());
  });

  it('lists each answer under its question', async () => {
    render(<FollowUpAnswersPanel applicantId="prospect-1" timezone="UTC" />);

    expect(await screen.findByText('I moved to the district.')).toBeInTheDocument();
    expect(screen.getByText('Why now?')).toBeInTheDocument();
    expect(mockGetAnswers).toHaveBeenCalledWith('prospect-1', 'request-1');
  });

  it('says a sensitive answer was withheld rather than leaving it blank', async () => {
    render(<FollowUpAnswersPanel applicantId="prospect-1" timezone="UTC" />);

    expect(await screen.findByText(/Withheld: you do not have permission/)).toBeInTheDocument();
    expect(screen.queryByText('(no answer)')).not.toBeInTheDocument();
  });

  it('shows a revealed sensitive answer, marked as sensitive', async () => {
    mockGetAnswers.mockResolvedValue(
      answers({
        answers: [
          { field_id: 'f2', label: 'Criminal history', answer: 'DUI in 2019', is_sensitive: true, withheld: false },
        ],
      })
    );
    render(<FollowUpAnswersPanel applicantId="prospect-1" timezone="UTC" />);

    expect(await screen.findByText('DUI in 2019')).toBeInTheDocument();
    expect(screen.getByText('Sensitive')).toBeInTheDocument();
  });

  it('asks only for the forms that were submitted', async () => {
    mockList.mockResolvedValue([request(), request({ id: 'request-2', status: 'sent', submitted_at: null })]);
    render(<FollowUpAnswersPanel applicantId="prospect-1" timezone="UTC" />);

    await screen.findByText('I moved to the district.');
    expect(mockGetAnswers).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when no form has been submitted', async () => {
    mockList.mockResolvedValue([request({ status: 'sent', submitted_at: null })]);
    const { container } = render(<FollowUpAnswersPanel applicantId="prospect-1" timezone="UTC" />);

    await vi.waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(mockGetAnswers).not.toHaveBeenCalled();
  });

  it('says so when the answers cannot be loaded', async () => {
    mockGetAnswers.mockRejectedValue(new Error('Network Error'));
    render(<FollowUpAnswersPanel applicantId="prospect-1" timezone="UTC" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
  });
});
