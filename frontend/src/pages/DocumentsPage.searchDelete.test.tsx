/**
 * DOC2-8: every keystroke in the search box discarded the request in flight,
 * and when the trimmed query ended up unchanged — a space typed, or a letter
 * typed and deleted inside the debounce — nothing fetched again. The
 * discarded request's own cleanup was skipped, so "Loading documents..."
 * stayed on screen for good.
 *
 * DOC2-9: a refused delete put its reason in the page banner, under the
 * dialog's scrim, and the dialog stayed open — the manager pressed Delete and
 * nothing seemed to happen. The dialog also never named the document.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
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

const receipt = {
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
};
const page = { documents: [receipt], total: 1, skip: 0, limit: 50 };

describe('DocumentsPage search and delete', () => {
  beforeEach(() => {
    mockAuthState.checkPermission = () => true;
    mockGetFolders.mockReset();
    mockGetFolders.mockResolvedValue({ folders: [], total: 0, skip: 0, limit: 12 });
    mockGetDocuments.mockReset();
    mockGetDocuments.mockResolvedValue(page);
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
  });

  it('finishes loading when a keystroke leaves the search unchanged', async () => {
    let release: (value: unknown) => void = () => undefined;
    mockGetDocuments.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const user = userEvent.setup();
    renderWithRouter(<DocumentsPage />);

    await user.click(await screen.findByRole('button', { name: /all documents/i }));
    const search = screen.getByPlaceholderText('Search all documents...');
    await user.type(search, ' ');
    await act(async () => {
      release(page);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(await screen.findAllByText('Hose receipt.pdf')).not.toHaveLength(0);
    expect(screen.queryByText('Loading documents...')).not.toBeInTheDocument();
  });

  it('names the document and shows a refusal inside the dialog', async () => {
    const refusal = 'This document is attached to a facility record you cannot change';
    mockDeleteDocument.mockRejectedValue({
      isAxiosError: true,
      message: 'Request failed with status code 403',
      response: { status: 403, data: { detail: refusal } },
    });
    const user = userEvent.setup();
    renderWithRouter(<DocumentsPage />);

    await user.click(await screen.findByRole('button', { name: /all documents/i }));
    await screen.findAllByText('Hose receipt.pdf');
    await user.click(screen.getAllByTitle('Delete document')[0] ?? document.body);
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText(/Hose receipt\.pdf/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Delete Document' }));

    await waitFor(() => expect(mockDeleteDocument).toHaveBeenCalledWith('d1'));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(refusal);
  });
});
