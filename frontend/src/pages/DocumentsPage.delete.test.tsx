/**
 * A refused document delete says why — for instance, that the document is the
 * receipt on a submitted purchase request — instead of "Check your
 * connection", which no refusal is.
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

const REFUSAL = 'This document is the receipt on purchase request PR-0007 and cannot be deleted';

describe('DocumentsPage delete', () => {
  beforeEach(() => {
    mockAuthState.checkPermission = () => true;
    mockGetFolders.mockReset();
    mockGetFolders.mockResolvedValue({ folders: [], total: 0, skip: 0, limit: 12 });
    mockGetDocuments.mockReset();
    mockGetDocuments.mockResolvedValue({
      documents: [
        {
          id: 'd1',
          organization_id: 'org-1',
          name: 'Hose receipt.pdf',
          file_name: 'Hose receipt.pdf',
          file_size: 1024,
          file_type: 'application/pdf',
          has_file: true,
          status: 'active',
          version: 1,
          created_at: '2026-08-01T00:00:00Z',
          updated_at: '2026-08-01T00:00:00Z',
        },
      ],
      total: 1,
      skip: 0,
      limit: 50,
    });
    mockGetSummary.mockReset();
    mockGetSummary.mockResolvedValue({
      total_documents: 1,
      total_folders: 0,
      total_size_bytes: 1024,
      documents_this_month: 1,
    });
    mockGetAdminOnlyFolders.mockReset();
    mockGetAdminOnlyFolders.mockResolvedValue([]);
    mockDeleteDocument.mockReset();
    mockDeleteDocument.mockRejectedValue({
      isAxiosError: true,
      message: 'Request failed with status code 409',
      response: { status: 409, data: { detail: REFUSAL } },
    });
  });

  it("shows the server's reason when the delete is refused", async () => {
    const user = userEvent.setup();
    renderWithRouter(<DocumentsPage />);

    await user.click(await screen.findByRole('button', { name: /all documents/i }));
    await screen.findByText('Hose receipt.pdf');
    // The grid and the table each render the row's actions; either opens the same dialog.
    await user.click(screen.getAllByTitle('Delete document')[0] ?? document.body);
    await user.click(screen.getByRole('button', { name: 'Delete Document' }));

    await waitFor(() => expect(mockDeleteDocument).toHaveBeenCalledWith('d1'));
    expect(await screen.findByText(REFUSAL)).toBeInTheDocument();
    expect(screen.queryByText(/Check your connection/)).not.toBeInTheDocument();
  });
});
