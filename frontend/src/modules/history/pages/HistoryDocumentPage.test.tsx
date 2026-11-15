import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ConfirmProvider } from '../../../contexts/ConfirmContext';
import type { DocumentFullView, DocumentMemberView } from '../types';

const mockGetDocument = vi.fn();
const mockPublish = vi.fn();
const mockRevisions = vi.fn();

vi.mock('../services/api', () => ({
  historyDocumentService: {
    getDocument: (...args: unknown[]) => mockGetDocument(...args) as unknown,
    publish: (...args: unknown[]) => mockPublish(...args) as unknown,
    listRevisions: (...args: unknown[]) => mockRevisions(...args) as unknown,
  },
  historyMediaService: { listRevisions: vi.fn() },
  historyService: { submitForClearance: vi.fn(), listRevisions: vi.fn() },
  documentFileUrl: (id: string, which: string) => `/api/v1/history/documents/${id}/${which}`,
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));

import HistoryDocumentPage from './HistoryDocumentPage';

const catalogue = {
  id: 'd1',
  kind: 'pdf' as const,
  title: 'Letter of thanks',
  description: 'From the mayor after the parade',
  taken_date: '1962-07-01',
  taken_date_precision: 'month' as const,
  taken_date_circa: false,
  place: null,
  document_type_id: 't1',
  document_type_name: 'Letter',
  author: 'Mayor Jones',
  recipient: 'Chief Smith',
  source_id: null,
  source_name: null,
  rights_note: null,
  accession_number: null,
  original_location: null,
  transcription: 'Dear Chief, thank you for the parade.',
  text_truncated: false,
  page_count: 2,
  width: null,
  height: null,
  has_thumbnail: true,
  mime_type: 'application/pdf',
};

const memberView = (): DocumentMemberView => ({
  ...catalogue,
  publication_level: 'members',
  view: 'member',
  tags: [{ member_id: 'p1', display_name: 'John Smith' }],
});

const fullView = (overrides: Partial<DocumentFullView> = {}): DocumentFullView => ({
  ...catalogue,
  publication_level: 'draft',
  view: 'full',
  research_notes: 'Found in the attic',
  original_filename: 'scan_0042.pdf',
  original_mime_type: 'application/pdf',
  original_size_bytes: 2_400_000,
  batch_id: null,
  tags: [{ member_id: 'p2', display_name: 'Dora Jones' }],
  published_at: null,
  revision_number: 1,
  public_revision_number: null,
  public_changes_pending: false,
  clearance_required: true,
  cleared_for_public: false,
  clearance: null,
  can_edit: true,
  can_publish: true,
  created_at: '2026-11-14T00:00:00Z',
  updated_at: '2026-11-14T00:00:00Z',
  ...overrides,
});

const renderPage = () =>
  render(
    <ConfirmProvider>
      <MemoryRouter initialEntries={['/history/documents/d1']}>
        <Routes>
          <Route path="/history/documents/:documentId" element={<HistoryDocumentPage />} />
        </Routes>
      </MemoryRouter>
    </ConfirmProvider>
  );

describe('HistoryDocumentPage', () => {
  beforeEach(() => {
    mockGetDocument.mockReset();
    mockPublish.mockReset();
    mockRevisions.mockReset();
    mockRevisions.mockResolvedValue([]);
  });

  it('opens the stripped copy in a new tab and shows the first page', async () => {
    mockGetDocument.mockResolvedValue(memberView());
    renderPage();
    const open = await screen.findByRole('link', { name: /Open the PDF/ });
    expect(open).toHaveAttribute('href', '/api/v1/history/documents/d1/view');
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('img', { name: 'First page of Letter of thanks' })).toHaveAttribute(
      'src',
      '/api/v1/history/documents/d1/thumbnail'
    );
  });

  it('shows a member the catalogue and transcription, and nothing of the Historian’s', async () => {
    mockGetDocument.mockResolvedValue(memberView());
    renderPage();
    expect(await screen.findByText('Dear Chief, thank you for the parade.')).toBeInTheDocument();
    expect(screen.getByText('Mayor Jones')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'John Smith' })).toHaveAttribute('href', '/history/people/p1');
    expect(screen.queryByText('Historian only')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Original/ })).not.toBeInTheDocument();
  });

  it('publishes without a consent question: a document is not a photo', async () => {
    mockGetDocument.mockResolvedValue(fullView());
    mockPublish.mockResolvedValue(fullView({ publication_level: 'members' }));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Publish to members' }));
    expect(mockPublish).toHaveBeenCalledWith('d1', 'members');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('gives the Historian the research notes and holds public until cleared', async () => {
    mockGetDocument.mockResolvedValue(fullView());
    renderPage();
    expect(await screen.findByText('Found in the attic')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish to the public' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Submit for public clearance' })).toBeInTheDocument();
  });

  it('says when a long document was only partly read for search', async () => {
    mockGetDocument.mockResolvedValue(memberView());
    mockGetDocument.mockResolvedValueOnce({ ...memberView(), text_truncated: true });
    renderPage();
    expect(await screen.findByText(/search covers its first pages/)).toBeInTheDocument();
  });
});
