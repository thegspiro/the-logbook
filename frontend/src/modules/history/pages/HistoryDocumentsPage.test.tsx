import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const mockList = vi.fn();
const mockTypes = vi.fn();
const mockCheckPermission = vi.fn();

vi.mock('../services/api', () => ({
  historyDocumentService: {
    listDocuments: (...args: unknown[]) => mockList(...args) as unknown,
    listTypes: (...args: unknown[]) => mockTypes(...args) as unknown,
  },
  documentFileUrl: (id: string, which: string) => `/api/v1/history/documents/${id}/${which}`,
}));

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector?: (state: { checkPermission: (p: string) => boolean }) => unknown) => {
    const state = { checkPermission: (p: string) => mockCheckPermission(p) as boolean };
    return selector ? selector(state) : state;
  },
}));

import HistoryDocumentsPage from './HistoryDocumentsPage';

const summary = {
  id: 'd1',
  kind: 'pdf' as const,
  title: 'Letter of thanks',
  taken_date: '1962-07-01',
  taken_date_precision: 'month' as const,
  taken_date_circa: false,
  document_type_name: 'Letter',
  page_count: 2,
  has_thumbnail: false,
  publication_level: 'members' as const,
};

const renderPage = () =>
  render(
    <MemoryRouter>
      <HistoryDocumentsPage />
    </MemoryRouter>
  );

describe('HistoryDocumentsPage', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockTypes.mockReset();
    mockCheckPermission.mockReset();
    mockList.mockResolvedValue({ items: [summary], total: 1 });
    mockTypes.mockResolvedValue([{ id: 't1', name: 'Letter', sort_order: 0, is_retired: false, usage_count: 1 }]);
    mockCheckPermission.mockReturnValue(false);
  });

  it('shows a member the published documents, with no upload and no publication filter', async () => {
    renderPage();
    const tile = await screen.findByRole('link', { name: /Letter of thanks/ });
    expect(tile).toHaveAttribute('href', '/history/documents/d1');
    expect(tile).toHaveTextContent('2 pages');
    expect(screen.queryByRole('link', { name: 'Upload' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Publication')).not.toBeInTheDocument();
  });

  it('searches the words in the documents and filters by type', async () => {
    renderPage();
    await screen.findByText('Letter of thanks');
    await userEvent.type(screen.getByLabelText('Search'), 'parade');
    await userEvent.selectOptions(screen.getByLabelText('Type'), 't1');
    await waitFor(() =>
      expect(mockList).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: 'parade', document_type_id: 't1', offset: 0 })
      )
    );
  });

  it('gives the Historian the upload link', async () => {
    mockCheckPermission.mockImplementation((p: string) => p === 'history.manage');
    renderPage();
    expect(await screen.findByRole('link', { name: 'Upload' })).toHaveAttribute('href', '/history/documents/upload');
    expect(screen.getByLabelText('Publication')).toBeInTheDocument();
  });
});
