/**
 * The shift history import service speaks the backend's routes and shapes:
 * a multipart upload with an optional time zone, a list that tolerates a
 * malformed body, and the review calls under the import's own path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();
const mockPut = vi.fn();
const mockDelete = vi.fn();

vi.mock('../../../utils/createApiClient', () => ({
  createApiClient: () => ({
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: (...args: unknown[]) => mockPost(...args) as unknown,
    patch: (...args: unknown[]) => mockPatch(...args) as unknown,
    put: (...args: unknown[]) => mockPut(...args) as unknown,
    delete: (...args: unknown[]) => mockDelete(...args) as unknown,
  }),
}));

import { historyImportService } from './historyImportApi';

beforeEach(() => {
  for (const mock of [mockGet, mockPost, mockPatch, mockPut, mockDelete]) {
    mock.mockReset();
    mock.mockResolvedValue({ data: {} });
  }
});

describe('historyImportService', () => {
  it('lists imports, and an unexpected body reads as none', async () => {
    mockGet.mockResolvedValueOnce({ data: { imports: [{ id: 'a' }] } });
    expect(await historyImportService.listImports()).toEqual([{ id: 'a' }]);

    mockGet.mockResolvedValueOnce({ data: {} });
    expect(await historyImportService.listImports()).toEqual([]);
    expect(mockGet).toHaveBeenCalledWith('/scheduling/history-import');
  });

  it('uploads the file as multipart, with the time zone only when one was chosen', async () => {
    const file = new File(['a,b\n'], 'history.csv', { type: 'text/csv' });

    await historyImportService.upload(file, 'America/Chicago');
    const [url, form, config] = mockPost.mock.calls[0] as [string, FormData, { headers: Record<string, string> }];
    expect(url).toBe('/scheduling/history-import');
    expect(form.get('file')).toBe(file);
    expect(form.get('timezone')).toBe('America/Chicago');
    expect(config.headers['Content-Type']).toBe('multipart/form-data');

    await historyImportService.upload(file);
    const [, withoutZone] = mockPost.mock.calls[1] as [string, FormData];
    expect(withoutZone.has('timezone')).toBe(false);
  });

  it('downloads the template as a blob', async () => {
    const blob = new Blob(['member_name\n']);
    mockGet.mockResolvedValueOnce({ data: blob });
    expect(await historyImportService.downloadTemplate()).toBe(blob);
    expect(mockGet).toHaveBeenCalledWith('/scheduling/history-import/template', { responseType: 'blob' });
  });

  it('sends review decisions to the import they belong to', async () => {
    await historyImportService.updateSettings('imp-1', { timezone: 'UTC' });
    expect(mockPatch).toHaveBeenCalledWith('/scheduling/history-import/imp-1', { timezone: 'UTC' }, { timeout: 0 });

    await historyImportService.updateRow('imp-1', 'row-9', { match_decision: null });
    expect(mockPatch).toHaveBeenCalledWith(
      '/scheduling/history-import/imp-1/rows/row-9',
      { match_decision: null },
      { timeout: 0 }
    );

    const mappings = { members: { 'number:77': { action: 'create' as const } } };
    await historyImportService.updateMappings('imp-1', mappings);
    expect(mockPut).toHaveBeenCalledWith('/scheduling/history-import/imp-1/mappings', mappings, { timeout: 0 });
  });

  it('commits and discards by id', async () => {
    await historyImportService.commit('imp-1');
    expect(mockPost).toHaveBeenCalledWith('/scheduling/history-import/imp-1/commit', null, { timeout: 0 });

    await historyImportService.discard('imp-1');
    expect(mockDelete).toHaveBeenCalledWith('/scheduling/history-import/imp-1');
  });
});
