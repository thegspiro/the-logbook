/**
 * Workflow review W53, Documents:
 *
 * - the file picker was `display: none`, so Tab never reached it and the
 *   keyboard could not upload anything;
 * - the upload and delete dialogs were not announced as dialogs;
 * - nothing said which folders members cannot see, so a confidential file
 *   could be filed into a members' folder without anyone noticing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const mockGetFolders = vi.fn();
const mockGetDocuments = vi.fn();
const mockGetSummary = vi.fn();

vi.mock('../services/api', () => ({
  documentsService: {
    getFolders: (...args: unknown[]) => mockGetFolders(...args) as unknown,
    getDocuments: (...args: unknown[]) => mockGetDocuments(...args) as unknown,
    getSummary: (...args: unknown[]) => mockGetSummary(...args) as unknown,
    downloadDocument: vi.fn(),
    uploadDocument: vi.fn(),
    deleteDocument: vi.fn(),
    createFolder: vi.fn(),
  },
}));

const mockAuthState: Record<string, unknown> = { checkPermission: () => true };
vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector?: (state: Record<string, unknown>) => unknown) =>
    selector ? selector(mockAuthState) : mockAuthState,
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'America/Chicago' }));

import DocumentsPage from './DocumentsPage';

const folder = (id: string, name: string, visibility: string) => ({
  id,
  organization_id: 'org-1',
  name,
  color: '',
  icon: '',
  document_count: 0,
  visibility,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
});

describe('DocumentsPage access cues and keyboard upload (W53)', () => {
  beforeEach(() => {
    mockGetFolders.mockReset();
    mockGetFolders.mockResolvedValue({
      folders: [
        folder('f1', 'SOPs & Procedures', 'organization'),
        folder('f2', 'Member Separations', 'leadership'),
        folder('f3', 'Pat Doe', 'owner'),
      ],
      total: 3,
      skip: 0,
      limit: 12,
    });
    mockGetDocuments.mockReset();
    mockGetDocuments.mockResolvedValue({
      documents: [
        {
          id: 'd1',
          organization_id: 'org-1',
          name: 'hose-test.txt',
          file_name: 'hose-test.txt',
          file_size: 37,
          file_type: 'text/plain',
          has_file: true,
          status: 'active',
          version: 1,
          created_at: '2026-10-04T18:24:16Z',
          updated_at: '2026-10-04T18:24:16Z',
        },
      ],
      total: 1,
      skip: 0,
      limit: 50,
    });
    mockGetSummary.mockReset();
    mockGetSummary.mockResolvedValue({
      total_documents: 1,
      total_folders: 3,
      total_size_bytes: 37,
      documents_this_month: 1,
    });
  });

  it('marks the folders members cannot open, and leaves the rest unmarked', async () => {
    renderWithRouter(<DocumentsPage />);

    const separations = await screen.findByRole('button', { name: /Member Separations/ });
    expect(within(separations).getByText('Leadership only')).toBeInTheDocument();
    expect(
      within(screen.getByRole('button', { name: /Pat Doe/ })).getByText('Owner and leadership only')
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('button', { name: /SOPs & Procedures/ })).queryByText(/only/)
    ).not.toBeInTheDocument();
  });

  it('says in the upload folder list which folders are restricted', async () => {
    const user = userEvent.setup();
    renderWithRouter(<DocumentsPage />);

    await user.click(await screen.findByRole('button', { name: 'Upload Document' }));
    const options = within(screen.getByLabelText('Folder'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toContain('Member Separations (leadership only)');
    expect(options).toContain('SOPs & Procedures');
  });

  it('lets the keyboard reach the file picker in a named upload dialog', async () => {
    const user = userEvent.setup();
    renderWithRouter(<DocumentsPage />);

    await user.click(await screen.findByRole('button', { name: 'Upload Document' }));
    const dialog = screen.getByRole('dialog', { name: 'Upload Document' });
    const picker = within(dialog).getByLabelText('Choose File');
    expect(picker).not.toHaveClass('hidden');

    picker.focus();
    expect(picker).toHaveFocus();
  });

  it('announces the delete confirmation as a named alert dialog', async () => {
    const user = userEvent.setup();
    renderWithRouter(<DocumentsPage />);

    await user.click(await screen.findByRole('button', { name: /SOPs & Procedures/ }));
    await user.click(await screen.findByTitle('Delete document'));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete Document' });
    expect(dialog).toHaveAccessibleDescription(/permanently deletes the document/);
  });
});
