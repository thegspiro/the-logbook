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
  mockGetFolders.mockResolvedValue({ folders: [{ id: 'f1', name: 'SOPs', document_count: 0 }], total: 1 });
  mockGetDocuments.mockResolvedValue({ documents: [], total: 0, skip: 0, limit: 20 });
  mockCreateFolder.mockResolvedValue({ id: 'created' });
  mockGetSummary.mockResolvedValue({
    total_documents: 1,
    total_folders: 1,
    total_size_bytes: 1024,
    documents_this_month: 1,
  });
});

describe('DocumentsPage', () => {
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
      expect(mockGetDocuments).toHaveBeenCalledWith({});
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

  it('loads and enters child folders alongside the current folder documents', async () => {
    const user = userEvent.setup();
    mockGetFolders.mockImplementation((parentId?: string) =>
      Promise.resolve(
        parentId === 'f1'
          ? { folders: [{ id: 'f2', name: 'Training', document_count: 0 }], total: 1 }
          : parentId === 'f2'
            ? { folders: [], total: 0 }
            : { folders: [{ id: 'f1', name: 'SOPs', document_count: 0 }], total: 1 }
      )
    );

    renderWithRouter(<DocumentsPage />);
    await user.click(await screen.findByRole('button', { name: /sops/i }));

    expect(await screen.findByRole('button', { name: /training/i })).toBeInTheDocument();
    expect(mockGetFolders).toHaveBeenCalledWith('f1');
    expect(mockGetDocuments).toHaveBeenCalledWith({ folder_id: 'f1' });

    await user.click(screen.getByRole('button', { name: /training/i }));
    await waitFor(() => expect(mockGetFolders).toHaveBeenCalledWith('f2'));
    expect(mockGetDocuments).toHaveBeenCalledWith({ folder_id: 'f2' });
  });

  it('traverses ancestors with accessible breadcrumb labels', async () => {
    const user = userEvent.setup();
    mockGetFolders.mockImplementation((parentId?: string) =>
      Promise.resolve(
        parentId === 'f1'
          ? { folders: [{ id: 'f2', name: 'Training', document_count: 0 }], total: 1 }
          : { folders: [{ id: 'f1', name: 'SOPs', document_count: 0 }], total: 1 }
      )
    );
    renderWithRouter(<DocumentsPage />);
    await user.click(await screen.findByRole('button', { name: /sops/i }));
    await user.click(await screen.findByRole('button', { name: /training/i }));

    await user.click(screen.getByRole('button', { name: 'Go to folder SOPs' }));
    await waitFor(() => expect(mockGetFolders).toHaveBeenLastCalledWith('f1'));
    expect(screen.queryByRole('button', { name: 'Go to folder Training' })).not.toBeInTheDocument();
  });

  it('creates a folder under the current folder and shows the intended parent', async () => {
    const user = userEvent.setup();
    renderWithRouter(<DocumentsPage />);
    await user.click(await screen.findByRole('button', { name: /sops/i }));
    await user.click(screen.getByRole('button', { name: /new folder/i }));

    expect(screen.getByText('SOPs', { selector: 'span' })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/folder name/i), 'Operations');
    await user.click(screen.getByRole('button', { name: /^create folder$/i }));

    await waitFor(() => expect(mockCreateFolder).toHaveBeenCalledWith({ name: 'Operations', parent_id: 'f1' }));
  });

  it('creates root folders from the all-documents pseudo-view', async () => {
    const user = userEvent.setup();
    renderWithRouter(<DocumentsPage />);
    await user.click(await screen.findByRole('button', { name: /all documents/i }));
    await user.click(screen.getByRole('button', { name: /new folder/i }));

    expect(screen.getByText(/folders created from all documents are placed at the root/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/folder name/i), 'Root Folder');
    await user.click(screen.getByRole('button', { name: /^create folder$/i }));
    await waitFor(() => expect(mockCreateFolder).toHaveBeenCalledWith({ name: 'Root Folder' }));
  });

  it('shows independent empty states for child folders and documents', async () => {
    const user = userEvent.setup();
    mockGetFolders.mockImplementation((parentId?: string) =>
      Promise.resolve(
        parentId ? { folders: [], total: 0 } : { folders: [{ id: 'f1', name: 'SOPs', document_count: 0 }], total: 1 }
      )
    );
    renderWithRouter(<DocumentsPage />);
    await user.click(await screen.findByRole('button', { name: /sops/i }));

    expect(await screen.findByText('No folders in this location.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No Documents in This Folder' })).toBeInTheDocument();
  });

  it('returns to the nearest accessible ancestor when a child level fails', async () => {
    const user = userEvent.setup();
    mockGetFolders.mockImplementation((parentId?: string) => {
      if (parentId === 'f2') return Promise.reject(new Error('Forbidden'));
      if (parentId === 'f1') {
        return Promise.resolve({ folders: [{ id: 'f2', name: 'Training', document_count: 0 }], total: 1 });
      }
      return Promise.resolve({ folders: [{ id: 'f1', name: 'SOPs', document_count: 0 }], total: 1 });
    });
    renderWithRouter(<DocumentsPage />);
    await user.click(await screen.findByRole('button', { name: /sops/i }));
    await user.click(await screen.findByRole('button', { name: /training/i }));

    expect(await screen.findByText(/folder “Training” is no longer accessible/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Go to folder Training' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to folder SOPs' })).toBeInTheDocument();
  });
});
