import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPost = vi.fn();
const mockEnqueue = vi.fn();
vi.mock('./apiClient', () => ({
  default: { post: (...a: unknown[]) => mockPost(...a) as unknown },
}));
vi.mock('../utils/genericOfflineQueue', () => ({
  enqueueGeneric: (...a: unknown[]) => mockEnqueue(...a) as unknown,
}));
vi.mock('../stores/pendingSyncStore', () => ({
  usePendingSyncStore: { getState: () => ({ refresh: () => Promise.resolve() }) },
}));

import { trainingSubmissionService } from './trainingServices';
import type { TrainingSubmissionCreate } from '../types/training';

const submission: TrainingSubmissionCreate = {
  course_name: 'Ladder drill',
  training_type: 'skills_practice',
  completion_date: '2026-10-30',
  hours_completed: 2,
};

// What the server accepts (TrainingSubmissionCreate.client_request_id).
const SERVER_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

describe('trainingSubmissionService.createSubmission resend key', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockPost.mockResolvedValue({ data: { id: 's1' } });
    mockEnqueue.mockReset();
    mockEnqueue.mockResolvedValue({});
  });

  it('queues an offline submission with a key the server will see on every resend', async () => {
    // Resent whenever an answer goes missing; without a key, a resend of a
    // submission the server had already stored was filed — and, under
    // auto-approval, credited — a second time.
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

    await trainingSubmissionService.createSubmission(submission);

    const body = mockEnqueue.mock.calls[0]?.[2] as TrainingSubmissionCreate;
    expect(body.client_request_id).toMatch(SERVER_PATTERN);
    expect(body).toMatchObject(submission);
  });

  it('gives two submissions different keys', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

    await trainingSubmissionService.createSubmission(submission);
    await trainingSubmissionService.createSubmission(submission);

    const [first, second] = mockEnqueue.mock.calls.map(
      (call) => (call[2] as TrainingSubmissionCreate).client_request_id
    );
    expect(first).not.toBe(second);
  });

  it('sends the key with an online submission too', async () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

    await trainingSubmissionService.createSubmission(submission);

    const body = mockPost.mock.calls[0]?.[1] as TrainingSubmissionCreate;
    expect(body.client_request_id).toMatch(SERVER_PATTERN);
  });

  it('keeps a key the caller already chose', async () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

    await trainingSubmissionService.createSubmission({ ...submission, client_request_id: 'caller-chosen-1' });

    expect((mockPost.mock.calls[0]?.[1] as TrainingSubmissionCreate).client_request_id).toBe('caller-chosen-1');
  });
});
