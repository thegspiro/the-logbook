import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPost = vi.fn();
const mockGet = vi.fn();
const mockSaveBlob = vi.fn();

vi.mock('./apiClient', () => ({
  default: {
    post: (...args: unknown[]) => mockPost(...args) as unknown,
    get: (...args: unknown[]) => mockGet(...args) as unknown,
  },
}));
vi.mock('../utils/saveBlob', () => ({
  saveBlob: (...args: unknown[]) => mockSaveBlob(...args) as unknown,
}));

import { waiverAttachmentProblem, waiverAttachmentService } from './waiverAttachmentService';

const file = (name: string, size = 10, type = '') => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

describe('waiverAttachmentService', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockGet.mockReset();
    mockSaveBlob.mockReset();
    mockPost.mockResolvedValue({ data: { id: 'r1' } });
  });

  it('submits the fields and files as one multipart request, omitting blanks', async () => {
    const note = file('note.pdf');
    const result = await waiverAttachmentService.submitWithAttachments(
      { event_id: 'e1', category: '', reason: 'Sick' },
      [note]
    );
    expect(result).toEqual({ id: 'r1' });
    const [url, form, config] = mockPost.mock.calls[0] as [string, FormData, unknown];
    expect(url).toBe('/training/waivers/requests/with-attachments');
    expect(form.get('event_id')).toBe('e1');
    expect(form.get('reason')).toBe('Sick');
    expect(form.has('category')).toBe(false);
    expect(form.getAll('files')).toHaveLength(1);
    expect(config).toEqual({ headers: { 'Content-Type': 'multipart/form-data' } });
  });

  it('adds files to a pending request', async () => {
    await waiverAttachmentService.addAttachments('r/1', [file('a.png'), file('b.heic')]);
    const [url, form] = mockPost.mock.calls[0] as [string, FormData];
    expect(url).toBe('/training/waivers/requests/r%2F1/attachments');
    expect(form.getAll('files')).toHaveLength(2);
  });

  it('downloads as a blob and saves under the neutral name', async () => {
    const blob = new Blob(['%PDF']);
    mockGet.mockResolvedValue({ data: blob });
    await waiverAttachmentService.downloadAttachment('r1', {
      id: 'a1',
      ordinal: 1,
      filename: 'waiver-attachment-1.pdf',
      mime_type: 'application/pdf',
      file_size: 4,
      uploaded_at: '2026-11-10T12:00:00Z',
    });
    expect(mockGet).toHaveBeenCalledWith('/training/waivers/requests/r1/attachments/a1', { responseType: 'blob' });
    expect(mockSaveBlob).toHaveBeenCalledWith(blob, 'waiver-attachment-1.pdf');
  });
});

describe('waiverAttachmentProblem', () => {
  it.each(['a.pdf', 'b.JPG', 'c.jpeg', 'd.png', 'IMG_1.HEIC', 'e.heif'])('accepts %s', (name) => {
    expect(waiverAttachmentProblem(file(name))).toBeNull();
  });

  it('refuses another type, an oversized file and an empty one', () => {
    expect(waiverAttachmentProblem(file('a.gif'))).toBe('a.gif is not a PDF, JPEG, PNG or HEIC file.');
    expect(waiverAttachmentProblem(file('noext'))).toContain('is not a');
    expect(waiverAttachmentProblem(file('big.pdf', 10 * 1024 * 1024 + 1))).toBe('big.pdf is larger than 10 MB.');
    expect(waiverAttachmentProblem(file('full.pdf', 10 * 1024 * 1024))).toBeNull();
    expect(waiverAttachmentProblem(file('empty.pdf', 0))).toBe('empty.pdf is empty.');
  });
});
