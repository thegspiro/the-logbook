import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();
const mockDelete = vi.fn();

vi.mock('./apiClient', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: (...args: unknown[]) => mockPost(...args) as unknown,
    put: (...args: unknown[]) => mockPut(...args) as unknown,
    patch: (...args: unknown[]) => mockPatch(...args) as unknown,
    delete: (...args: unknown[]) => mockDelete(...args) as unknown,
  },
}));
const mockPut = vi.fn();

import { documentsService } from './documentsService';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('documentsService', () => {
  // --- getFolders ---
  describe('getFolders', () => {
    it('should GET /documents/folders without parentId', async () => {
      const data = { folders: [{ id: 'f1', name: 'Folder 1' }], total: 1 };
      mockGet.mockResolvedValueOnce({ data });

      const result = await documentsService.getFolders();

      expect(mockGet).toHaveBeenCalledWith('/documents/folders', { params: {} });
      expect(result).toEqual(data);
    });

    it('should pass parent_id param when provided', async () => {
      const data = { folders: [], total: 0 };
      mockGet.mockResolvedValueOnce({ data });

      await documentsService.getFolders('parent-1');

      expect(mockGet).toHaveBeenCalledWith('/documents/folders', { params: { parent_id: 'parent-1' } });
    });
  });

  // --- createFolder ---
  describe('createFolder', () => {
    it('should POST to /documents/folders', async () => {
      const folderData = { name: 'New Folder', description: 'Test' };
      const created = { id: 'f1', ...folderData };
      mockPost.mockResolvedValueOnce({ data: created });

      const result = await documentsService.createFolder(folderData);

      expect(mockPost).toHaveBeenCalledWith('/documents/folders', folderData);
      expect(result).toEqual(created);
    });

    it('should propagate errors', async () => {
      mockPost.mockRejectedValueOnce(new Error('Forbidden'));

      await expect(documentsService.createFolder({ name: 'X' })).rejects.toThrow('Forbidden');
    });
  });

  // --- updateFolder ---
  describe('updateFolder', () => {
    it('should PATCH /documents/folders/:id', async () => {
      const updateData = { name: 'Updated Name' };
      const updated = { id: 'f1', name: 'Updated Name' };
      mockPatch.mockResolvedValueOnce({ data: updated });

      const result = await documentsService.updateFolder('f1', updateData);

      expect(mockPatch).toHaveBeenCalledWith('/documents/folders/f1', updateData);
      expect(result).toEqual(updated);
    });
  });

  // --- deleteFolder ---
  describe('deleteFolder', () => {
    it('should DELETE /documents/folders/:id', async () => {
      mockDelete.mockResolvedValueOnce({});

      await documentsService.deleteFolder('f1');

      expect(mockDelete).toHaveBeenCalledWith('/documents/folders/f1');
    });
  });

  // --- getDocuments ---
  describe('getDocuments', () => {
    it('should GET /documents with params', async () => {
      const data = { documents: [{ id: 'd1' }], total: 1, skip: 0, limit: 20 };
      mockGet.mockResolvedValueOnce({ data });
      const params = { folder_id: 'f1', search: 'report' };

      const result = await documentsService.getDocuments(params);

      expect(mockGet).toHaveBeenCalledWith('/documents', { params });
      expect(result).toEqual(data);
    });

    it('should GET /documents without params', async () => {
      const data = { documents: [], total: 0, skip: 0, limit: 20 };
      mockGet.mockResolvedValueOnce({ data });

      const result = await documentsService.getDocuments();

      expect(mockGet).toHaveBeenCalledWith('/documents', { params: undefined });
      expect(result).toEqual(data);
    });
  });

  // --- uploadDocument ---
  describe('uploadDocument', () => {
    it('should POST FormData to /documents/upload with multipart header', async () => {
      const formData = new FormData();
      const doc = { id: 'd1', name: 'test.pdf' };
      mockPost.mockResolvedValueOnce({ data: doc });

      const result = await documentsService.uploadDocument(formData);

      expect(mockPost).toHaveBeenCalledWith('/documents/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      expect(result).toEqual(doc);
    });
  });

  // --- getDocument ---
  describe('getDocument', () => {
    it('should GET /documents/:id', async () => {
      const doc = { id: 'd1', name: 'Report.pdf' };
      mockGet.mockResolvedValueOnce({ data: doc });

      const result = await documentsService.getDocument('d1');

      expect(mockGet).toHaveBeenCalledWith('/documents/d1');
      expect(result).toEqual(doc);
    });
  });

  // --- updateDocument ---
  describe('updateDocument', () => {
    it('should PATCH /documents/:id with update data', async () => {
      const updateData = { name: 'Updated Report', tags: 'important' };
      const updated = { id: 'd1', ...updateData };
      mockPatch.mockResolvedValueOnce({ data: updated });

      const result = await documentsService.updateDocument('d1', updateData);

      expect(mockPatch).toHaveBeenCalledWith('/documents/d1', updateData);
      expect(result).toEqual(updated);
    });
  });

  // --- deleteDocument ---
  describe('deleteDocument', () => {
    it('should DELETE /documents/:id', async () => {
      mockDelete.mockResolvedValueOnce({});

      await documentsService.deleteDocument('d1');

      expect(mockDelete).toHaveBeenCalledWith('/documents/d1');
    });
  });

  // --- getSummary ---
  describe('getSummary', () => {
    it('should GET /documents/stats/summary', async () => {
      const summary = { total_documents: 42, total_folders: 5, total_size_bytes: 1024000, documents_this_month: 3 };
      mockGet.mockResolvedValueOnce({ data: summary });

      const result = await documentsService.getSummary();

      expect(mockGet).toHaveBeenCalledWith('/documents/stats/summary');
      expect(result).toEqual(summary);
    });
  });

  // --- getMyFolder ---
  describe('getMyFolder', () => {
    it('should GET /documents/my-folder', async () => {
      const folder = { id: 'f1', name: 'My Folder' };
      mockGet.mockResolvedValueOnce({ data: folder });

      const result = await documentsService.getMyFolder();

      expect(mockGet).toHaveBeenCalledWith('/documents/my-folder');
      expect(result).toEqual(folder);
    });
  });
});
