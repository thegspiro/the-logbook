/**
 * DOC2-10: a page of folders that comes back empty — its last folder deleted
 * or moved, by this manager or anyone else — kept its offset. The server
 * answers a page past the end with an empty list, the pager hides itself once
 * the level fits on one page, and the screen read "No folders yet" with no
 * way back to the folders that still exist. The page now steps back to the
 * last one that has folders on it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const mockGetFolders = vi.fn();
const mockGetDocuments = vi.fn();
const mockGetSummary = vi.fn();
const mockDeleteDocument = vi.fn();
const mockGetAdminOnlyFolders = vi.fn();

vi.mock('../services/api', () => ({
  documentsService: {
    getFolders: (...args: unknown[]) => mockGetFolders(...args) as unknown,
    getDocuments: (...args: unknown[]) => mockGetDocuments(...args) as unknown,
    getSummary: (...args: unknown[]) => mockGetSummary(...args) as unknown,
    deleteDocument: (...args: unknown[]) => mockDeleteDocument(...args) as unknown,
    getAdminOnlyFolders: (...args: unknown[]) => mockGetAdminOnlyFolders(...args) as unknown,
    downloadDocument: vi.fn(),
    uploadDocument: vi.fn(),
    createFolder: vi.fn(),
  },
  roleService: {
    getPermissionsByCategory: () => Promise.resolve([]),
  },
}));

const mockAuthState: Record<string, unknown> = {};
vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector?: (state: Record<string, unknown>) => unknown) =>
    selector ? selector(mockAuthState) : mockAuthState,
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

import DocumentsPage from './DocumentsPage';

const folder = (n: number) => ({
  id: `f${String(n)}`,
  organization_id: 'org-1',
  name: `Folder ${String(n).padStart(2, '0')}`,
  color: 'blue',
  icon: 'folder',
  document_count: 0,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
});

describe('DocumentsPage folder pages', () => {
  beforeEach(() => {
    mockAuthState.checkPermission = () => true;
    mockGetDocuments.mockReset();
    mockGetDocuments.mockResolvedValue({ documents: [], total: 0, skip: 0, limit: 50 });
    mockGetSummary.mockReset();
    mockGetSummary.mockResolvedValue({
      total_documents: 0,
      total_folders: 12,
      total_size_bytes: 0,
      documents_this_month: 0,
    });
    mockGetAdminOnlyFolders.mockReset();
    mockGetAdminOnlyFolders.mockResolvedValue([]);
    mockGetFolders.mockReset();
  });

  it('steps back to a page with folders when the one asked for has emptied', async () => {
    const firstPage = Array.from({ length: 12 }, (_, i) => folder(i + 1));
    // Thirteen folders when the first page loads; the thirteenth is deleted
    // before page two is asked for, so the server answers it with nothing.
    mockGetFolders
      .mockResolvedValueOnce({ folders: firstPage, total: 13, skip: 0, limit: 12 })
      .mockResolvedValueOnce({ folders: [], total: 12, skip: 12, limit: 12 })
      .mockResolvedValue({ folders: firstPage, total: 12, skip: 0, limit: 12 });
    const user = userEvent.setup();
    renderWithRouter(<DocumentsPage />);

    await screen.findByText('Folder 01');
    await user.click(screen.getByRole('button', { name: 'Next page' }));

    await waitFor(() => expect(mockGetFolders).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 0 })));
    expect(await screen.findByText('Folder 01')).toBeInTheDocument();
    expect(screen.queryByText('No folders yet.')).not.toBeInTheDocument();
  });
});
