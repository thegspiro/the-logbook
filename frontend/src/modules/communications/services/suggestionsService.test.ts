import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock('../../../services/apiClient', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: (...args: unknown[]) => mockPost(...args) as unknown,
  },
}));

import { suggestionsService } from './suggestionsService';

describe('suggestionsService', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockPost.mockResolvedValue({ data: {} });
    mockGet.mockResolvedValue({ data: new Blob() });
  });

  it('sends a submission and its screenshots as one multipart request', async () => {
    const shot = new File(['x'], 'shot.png', { type: 'image/png' });
    await suggestionsService.submit('box-1', { title: 'T', details: 'D', anonymous: true, screenshots: [shot] });

    const [url, body] = mockPost.mock.calls[0] as [string, FormData];
    expect(url).toBe('/suggestions/boxes/box-1/submissions');
    expect(body.get('anonymous')).toBe('true');
    expect(body.getAll('screenshots')).toHaveLength(1);
  });

  it('sends intake answers as one JSON field, and none when there are none', async () => {
    await suggestionsService.submit('box-1', {
      title: 'T',
      details: 'D',
      anonymous: false,
      screenshots: [],
      answers: { safety: 'yes' },
    });
    await suggestionsService.submit('box-1', {
      title: 'T',
      details: 'D',
      anonymous: false,
      screenshots: [],
      answers: {},
    });

    const [, withAnswers] = mockPost.mock.calls[0] as [string, FormData];
    const [, without] = mockPost.mock.calls[1] as [string, FormData];
    expect(withAnswers.get('answers')).toBe('{"safety":"yes"}');
    expect(without.has('answers')).toBe(false);
  });

  it('keeps a follow-up key out of every URL', async () => {
    const key = 'k'.repeat(43);
    await suggestionsService.lookupByKey(key);
    await suggestionsService.replyByKey(key, 'hi');
    await suggestionsService.getAttachmentByKey(key, 'att-1');

    for (const call of mockPost.mock.calls) {
      const [url, body] = call as [string, { key: string }];
      expect(url).not.toContain(key);
      expect(body.key).toBe(key);
    }
  });

  it('omits empty review filters from the query', async () => {
    mockGet.mockResolvedValue({ data: { items: [], total: 0 } });
    await suggestionsService.listForReview({ boxId: '', disposition: '' });

    expect(mockGet).toHaveBeenCalledWith('/suggestions/review', {
      params: { box_id: undefined, disposition: undefined, skip: undefined, limit: undefined },
    });
  });
});
