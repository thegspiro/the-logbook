import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import type { DocumentRecord } from '../services/formsServices';

const mockGetFolders = vi.fn();
const mockGetDocuments = vi.fn();
const mockGetSummary = vi.fn();
const mockDownloadDocument = vi.fn();
const mockCreateFolder = vi.fn();

vi.mock('../services/api', () => ({
  documentsService: {
    getFolders: (...args: unknown[]) => mockGetFolders(...args) as unknown,
    getDocuments: (...args: unknown[]) => mockGetDocuments(...args) as unknown,
    getSummary: (...args: unknown[]) => mockGetSummary(...args) as unknown,
    downloadDocument: (...args: unknown[]) => mockDownloadDocument(...args) as unknown,
    uploadDocument: vi.fn(),
    deleteDocument: vi.fn(),
    createFolder: (...args: unknown[]) => mockCreateFolder(...args) as unknown,
  },
}));

const mockAuthState: Record<string, unknown> = {
  checkPermission: vi.fn().mockReturnValue(true),
};
vi.mock('../stores/authStore', () => ({
  useAuthStore: vi.fn((selector?: (state: Record<string, unknown>) => unknown) =>
    selector ? selector(mockAuthState) : mockAuthState
  ),
}));

vi.mock('../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

// Import AFTER mocks
import DocumentsPage from './DocumentsPage';

function makeDocument(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: 'd1',
    organization_id: 'org-1',
    name: 'Roster.pdf',
    file_name: 'Roster.pdf',
    file_size: 1024,
    file_type: 'application/pdf',
    has_file: true,
    status: 'active',
    version: 1,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetFolders.mockReset();
  mockGetDocuments.mockReset();
  mockGetSummary.mockReset();
  mockDownloadDocument.mockReset();
  mockCreateFolder.mockReset();
  mockGetFolders.mockResolvedValue({
    folders: [{ id: 'f1', name: 'SOPs', document_count: 0 }],
    total: 1,
    skip: 0,
    limit: 12,
  });
  mockGetDocuments.mockResolvedValue({ documents: [], total: 0, skip: 0, limit: 50 });
  mockCreateFolder.mockResolvedValue({ id: 'created' });
  mockGetSummary.mockResolvedValue({
    total_documents: 1,
    total_folders: 1,
    total_size_bytes: 1024,
    documents_this_month: 1,
  });
});

describe('DocumentsPage', () => {
  it('keeps folder browsing available and retries a failed summary', async () => {
    const user = userEvent.setup();
    mockGetSummary.mockRejectedValueOnce(new Error('summary unavailable')).mockResolvedValueOnce({
      total_documents: 7,
      total_folders: 3,
      total_size_bytes: 2048,
      documents_this_month: 2,
    });

    renderWithRouter(<DocumentsPage />);

    expect(await screen.findByText('Document statistics could not be loaded.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sops/i })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(mockGetSummary).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText('7')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
    expect(screen.queryByText('Document statistics could not be loaded.')).not.toBeInTheDocument();
  });

  it('lists a folderless document under "All Documents" (DOC-22)', async () => {
    const user = userEvent.setup();
    // A folderless upload has folder_id undefined and is only ever returned
    // when the caller asks for every document, not a specific folder_id.
    mockGetDocuments.mockResolvedValue({
      documents: [makeDocument({ id: 'd-no-folder', name: 'Org-level notice.pdf' })],
      total: 1,
      skip: 0,
      limit: 20,
    });

    renderWithRouter(<DocumentsPage />);

    const allDocsButton = await screen.findByRole('button', { name: /all documents/i });
    await user.click(allDocsButton);

    await waitFor(() => {
      expect(mockGetDocuments).toHaveBeenCalledWith({ skip: 0, limit: 50 });
    });
    expect(await screen.findByText('Org-level notice.pdf')).toBeInTheDocument();
  });

  it('hides the Download action for a generated document with no file (DOC-23)', async () => {
    const user = userEvent.setup();
    mockGetDocuments.mockResolvedValue({
      documents: [
        makeDocument({ id: 'd-upload', name: 'Uploaded.pdf', has_file: true }),
        makeDocument({ id: 'd-generated', name: 'Meeting Minutes', has_file: false, file_name: '' }),
      ],
      total: 2,
      skip: 0,
      limit: 20,
    });

    renderWithRouter(<DocumentsPage />);

    const folderButton = await screen.findByRole('button', { name: /sops/i });
    await user.click(folderButton);

    await screen.findByText('Uploaded.pdf');
    const generatedCard = screen.getByTestId('document-card-d-generated');
    expect(within(generatedCard).queryByTitle('Download document')).not.toBeInTheDocument();

    const uploadedCard = screen.getByTestId('document-card-d-upload');
    expect(within(uploadedCard).getByTitle('Download document')).toBeInTheDocument();
  });

  it('downloads a document via the service when Download is clicked', async () => {
    const user = userEvent.setup();
    mockGetDocuments.mockResolvedValue({
      documents: [makeDocument({ id: 'd1', name: 'Roster.pdf' })],
      total: 1,
      skip: 0,
      limit: 20,
    });
    mockDownloadDocument.mockResolvedValue(new Blob(['bytes'], { type: 'application/pdf' }));
    // jsdom has no real object URL machinery for blobs.
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();

    renderWithRouter(<DocumentsPage />);
    const folderButton = await screen.findByRole('button', { name: /sops/i });
    await user.click(folderButton);

    const downloadButton = await screen.findByTitle('Download document');
    await user.click(downloadButton);

    await waitFor(() => {
      expect(mockDownloadDocument).toHaveBeenCalledWith('d1');
    });
  });

  it('retains the total and loads the next result set', async () => {
    const user = userEvent.setup();
    const firstPage = Array.from({ length: 50 }, (_, index) =>
      makeDocument({ id: `d-${index + 1}`, name: `Document ${index + 1}` })
    );
    mockGetDocuments
      .mockResolvedValueOnce({ documents: firstPage, total: 51, skip: 0, limit: 50 })
      .mockResolvedValueOnce({
        documents: [makeDocument({ id: 'd-51', name: 'Document 51' })],
        total: 51,
        skip: 50,
        limit: 50,
      });

    renderWithRouter(<DocumentsPage />);
    await user.click(await screen.findByRole('button', { name: /sops/i }));

    expect(await screen.findByText('Showing 1–50 of 51')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('Document 51')).toBeInTheDocument();
    expect(screen.getByText('Showing 1–51 of 51')).toBeInTheDocument();
    expect(mockGetDocuments).toHaveBeenLastCalledWith({ folder_id: 'f1', skip: 50, limit: 50 });
  });

  it('sends a trimmed, debounced search and resets pagination', async () => {
    const user = userEvent.setup();
    mockGetDocuments
      .mockResolvedValueOnce({
        documents: [makeDocument({ id: 'first', name: 'First page' })],
        total: 75,
        skip: 0,
        limit: 50,
      })
      .mockResolvedValueOnce({
        documents: [makeDocument({ id: 'match', name: 'Incident report' })],
        total: 1,
        skip: 0,
        limit: 50,
      });

    renderWithRouter(<DocumentsPage />);
    await user.click(await screen.findByRole('button', { name: /sops/i }));
    await screen.findByText('First page');
    await user.type(screen.getByRole('textbox', { name: 'Search documents' }), '  incident  ');

    await waitFor(
      () => {
        expect(mockGetDocuments).toHaveBeenLastCalledWith({
          folder_id: 'f1',
          skip: 0,
          limit: 50,
          search: 'incident',
        });
      },
      { timeout: 1500 }
    );
    expect(await screen.findByText('Incident report')).toBeInTheDocument();
    expect(screen.getByText('Showing 1–1 of 1')).toBeInTheDocument();
  });

  it('resets to the first page when the selected folder changes', async () => {
    const user = userEvent.setup();
    mockGetFolders.mockResolvedValue({
      folders: [
        { id: 'f1', name: 'SOPs', document_count: 1 },
        { id: 'f2', name: 'Policies', document_count: 0 },
      ],
      total: 2,
      skip: 0,
      limit: 12,
    });
    mockGetDocuments
      .mockResolvedValueOnce({ documents: [makeDocument({ name: 'SOP' })], total: 1, skip: 0, limit: 50 })
      .mockResolvedValueOnce({ documents: [], total: 0, skip: 0, limit: 50 });

    renderWithRouter(<DocumentsPage />);
    await user.click(await screen.findByRole('button', { name: /sops/i }));
    await waitFor(() => expect(mockGetDocuments).toHaveBeenCalledWith({ folder_id: 'f1', skip: 0, limit: 50 }));
    await user.click(screen.getByRole('button', { name: 'All Folders' }));
    await user.click(screen.getByRole('button', { name: /policies/i }));

    expect(await screen.findByText('No Documents in This Folder')).toBeInTheDocument();
    expect(mockGetDocuments).toHaveBeenLastCalledWith({ folder_id: 'f2', skip: 0, limit: 50 });
  });

  it('does not allow an older search response to replace newer results', async () => {
    const user = userEvent.setup();
    let resolveInitial: ((value: object) => void) | undefined;
    const initialResponse = new Promise<object>((resolve) => {
      resolveInitial = resolve;
    });
    mockGetDocuments.mockReturnValueOnce(initialResponse).mockResolvedValueOnce({
      documents: [makeDocument({ id: 'new', name: 'Newest result' })],
      total: 1,
      skip: 0,
      limit: 50,
    });

    renderWithRouter(<DocumentsPage />);
    await user.click(await screen.findByRole('button', { name: /sops/i }));
    await user.type(screen.getByRole('textbox', { name: 'Search documents' }), 'new');
    expect(await screen.findByText('Newest result', {}, { timeout: 1500 })).toBeInTheDocument();

    resolveInitial?.({
      documents: [makeDocument({ id: 'old', name: 'Stale result' })],
      total: 1,
      skip: 0,
      limit: 50,
    });
    await waitFor(() => expect(screen.queryByText('Stale result')).not.toBeInTheDocument());
    expect(screen.getByText('Newest result')).toBeInTheDocument();
  });

  it('loads child folders and documents for each entered level', async () => {
    const user = userEvent.setup();
    mockGetFolders.mockImplementation((params?: { parent_id?: string }) =>
      Promise.resolve(
        params?.parent_id === 'f1'
          ? { folders: [{ id: 'f2', name: 'Training', document_count: 0 }], total: 1 }
          : params?.parent_id === 'f2'
            ? { folders: [], total: 0 }
            : { folders: [{ id: 'f1', name: 'SOPs', document_count: 0 }], total: 1 }
      )
    );
    renderWithRouter(<DocumentsPage />);
    await user.click(await screen.findByRole('button', { name: /sops/i }));
    await user.click(await screen.findByRole('button', { name: /training/i }));

    await waitFor(() => expect(mockGetFolders).toHaveBeenCalledWith({ parent_id: 'f2', skip: 0, limit: 12 }));
    expect(mockGetDocuments).toHaveBeenCalledWith({ folder_id: 'f2', skip: 0, limit: 50 });
  });

  it('traverses ancestors with accessible breadcrumb labels', async () => {
    const user = userEvent.setup();
    mockGetFolders.mockImplementation((params?: { parent_id?: string }) =>
      Promise.resolve(
        params?.parent_id === 'f1'
          ? { folders: [{ id: 'f2', name: 'Training', document_count: 0 }], total: 1 }
          : { folders: [{ id: 'f1', name: 'SOPs', document_count: 0 }], total: 1 }
      )
    );
    renderWithRouter(<DocumentsPage />);
    await user.click(await screen.findByRole('button', { name: /sops/i }));
    await user.click(await screen.findByRole('button', { name: /training/i }));
    await user.click(screen.getByRole('button', { name: 'Go to folder SOPs' }));

    await waitFor(() => expect(mockGetFolders).toHaveBeenLastCalledWith({ parent_id: 'f1', skip: 0, limit: 12 }));
    expect(screen.queryByText('Training', { selector: '[aria-current="page"]' })).not.toBeInTheDocument();
  });

  it('creates folders under the visible parent and root from All Documents', async () => {
    const user = userEvent.setup();
    renderWithRouter(<DocumentsPage />);
    await user.click(await screen.findByRole('button', { name: /sops/i }));
    await user.click(screen.getByRole('button', { name: /new folder/i }));
    expect(within(screen.getByRole('dialog')).getByText('SOPs', { selector: 'span' })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/folder name/i), 'Operations');
    await user.click(screen.getByRole('button', { name: /^create folder$/i }));
    await waitFor(() => expect(mockCreateFolder).toHaveBeenCalledWith({ name: 'Operations', parent_id: 'f1' }));

    await user.click(screen.getByRole('button', { name: 'Go to root folders' }));
    await user.click(screen.getByRole('button', { name: /all documents/i }));
    await user.click(screen.getByRole('button', { name: /new folder/i }));
    expect(screen.getByText(/folders created from all documents are placed at the root/i)).toBeInTheDocument();
  });

  it('shows the current folder as the selected upload destination', async () => {
    const user = userEvent.setup();
    renderWithRouter(<DocumentsPage />);
    await user.click(await screen.findByRole('button', { name: /sops/i }));
    await user.click(screen.getByRole('button', { name: /upload document/i }));

    expect(screen.getByRole('combobox', { name: 'Folder' })).toHaveValue('f1');
    expect(screen.getByRole('option', { name: 'SOPs (current)' })).toBeInTheDocument();
  });

  it('keeps the folder selected when only its documents fail to load', async () => {
    const user = userEvent.setup();
    mockGetDocuments.mockRejectedValue(new Error('documents unavailable'));
    renderWithRouter(<DocumentsPage />);
    await user.click(await screen.findByRole('button', { name: /sops/i }));

    expect(await screen.findByText(/unable to load documents/i)).toBeInTheDocument();
    expect(screen.getByText('SOPs', { selector: '[aria-current="page"]' })).toBeInTheDocument();
  });

  describe('folder pagination', () => {
    const page = (ids: string[], total: number, skip: number) => ({
      folders: ids.map((id) => ({ id, name: `Folder ${id}`, document_count: 0 })),
      total,
      skip,
      limit: 12,
    });

    beforeEach(() => {
      mockGetFolders.mockReset();
    });

    it('does not offer pagination for a level that fits on one page', async () => {
      mockGetFolders.mockResolvedValue(page(['f1'], 1, 0));

      renderWithRouter(<DocumentsPage />);

      await screen.findByRole('button', { name: /folder f1/i });
      expect(screen.queryByRole('navigation', { name: /pagination/i })).not.toBeInTheDocument();
    });

    it('pages a level without leaving it', async () => {
      const user = userEvent.setup();
      mockGetFolders.mockImplementation((params?: { skip?: number }) =>
        Promise.resolve(params?.skip === 12 ? page(['f13'], 13, 12) : page(['f1'], 13, 0))
      );

      renderWithRouter(<DocumentsPage />);
      await screen.findByRole('button', { name: /folder f1/i });
      await user.click(screen.getByRole('button', { name: 'Next page' }));

      expect(await screen.findByRole('button', { name: /folder f13/i })).toBeInTheDocument();
      // The level did not change, so the parent stays as it was and only the
      // offset moves.
      expect(mockGetFolders).toHaveBeenLastCalledWith({ skip: 12, limit: 12 });
    });

    it('starts a newly entered level at its first page', async () => {
      // Regression guard: folderSkip is page state, not level state. Carrying
      // page 2's offset into a child that has one page shows an empty folder
      // that is not empty.
      const user = userEvent.setup();
      mockGetFolders.mockImplementation((params?: { parent_id?: string; skip?: number }) => {
        if (params?.parent_id === 'f13') return Promise.resolve(page(['child'], 1, 0));
        return Promise.resolve(params?.skip === 12 ? page(['f13'], 13, 12) : page(['f1'], 13, 0));
      });

      renderWithRouter(<DocumentsPage />);
      await screen.findByRole('button', { name: /folder f1/i });
      await user.click(screen.getByRole('button', { name: 'Next page' }));
      await user.click(await screen.findByRole('button', { name: /folder f13/i }));

      await waitFor(() => expect(mockGetFolders).toHaveBeenLastCalledWith({ parent_id: 'f13', skip: 0, limit: 12 }));
      expect(await screen.findByRole('button', { name: /folder child/i })).toBeInTheDocument();
    });

    it('reports the level total, not the page length', async () => {
      // A full page of twelve out of thirty. Measuring the returned array for
      // the total would call it "of 12" and hide the other eighteen behind a
      // control that thinks there is nowhere to go.
      // Zero-padded so "Folder f01" cannot also match f10 through f12.
      const ids = Array.from({ length: 12 }, (_unused, index) => `f${String(index + 1).padStart(2, '0')}`);
      mockGetFolders.mockResolvedValue(page(ids, 30, 0));

      renderWithRouter(<DocumentsPage />);

      await screen.findByRole('button', { name: /folder f01/i });
      // The count is split across spans, so match on the assembled text.
      const range = await screen.findByText(
        (_content, element) => element?.textContent?.replace(/\s+/g, ' ').trim() === 'Showing 1 – 12 of 30'
      );
      expect(range).toBeInTheDocument();
    });
  });

  it('ignores stale child-folder responses after returning to root', async () => {
    const user = userEvent.setup();
    let resolveChildren: ((value: object) => void) | undefined;
    mockGetFolders.mockImplementation((params?: { parent_id?: string }) => {
      if (params?.parent_id === 'f1') return new Promise<object>((resolve) => (resolveChildren = resolve));
      return Promise.resolve({ folders: [{ id: 'f1', name: 'SOPs', document_count: 0 }], total: 1 });
    });
    renderWithRouter(<DocumentsPage />);
    await user.click(await screen.findByRole('button', { name: /sops/i }));
    await user.click(screen.getByRole('button', { name: 'Go to root folders' }));
    resolveChildren?.({ folders: [{ id: 'f2', name: 'Stale child', document_count: 0 }], total: 1 });

    await waitFor(() => expect(screen.queryByText('Stale child')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /sops/i })).toBeInTheDocument();
  });
});
