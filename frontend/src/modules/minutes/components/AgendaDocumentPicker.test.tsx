import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockSearch = vi.fn();
vi.mock('../../../services/api', () => ({
  documentsService: { getDocuments: (...a: unknown[]) => mockSearch(...a) as unknown },
}));

import { AgendaDocumentPicker } from './AgendaDocumentPicker';

describe('AgendaDocumentPicker', () => {
  const onPick = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch.mockReset();
    mockSearch.mockResolvedValue({
      documents: [
        { id: 'd1', name: 'Budget 2027' },
        { id: 'd2', name: 'Budget notes' },
      ],
      total: 2,
      skip: 0,
      limit: 8,
    });
  });

  const open = (linked: string[] = []) =>
    render(<AgendaDocumentPicker id="pick" linked={new Set(linked)} onPick={onPick} />);

  it('searches the library and offers what it finds', async () => {
    const user = userEvent.setup();
    open();
    await user.type(screen.getByLabelText('Link a document'), 'budget');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(mockSearch).toHaveBeenCalledWith({ search: 'budget', limit: 8 });
    expect(await screen.findByText('Budget 2027')).toBeInTheDocument();
    expect(screen.getByText('Budget notes')).toBeInTheDocument();
  });

  it('does not search for nothing', () => {
    open();
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
  });

  it('hands back the document chosen, with the library’s name', async () => {
    const user = userEvent.setup();
    open();
    await user.type(screen.getByLabelText('Link a document'), 'budget');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.click(await screen.findByRole('button', { name: 'Link Budget notes' }));

    expect(onPick).toHaveBeenCalledWith({ id: 'd2', name: 'Budget notes' });
  });

  it('leaves out a document already linked', async () => {
    const user = userEvent.setup();
    open(['d1']);
    await user.type(screen.getByLabelText('Link a document'), 'budget');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('Budget notes')).toBeInTheDocument();
    expect(screen.queryByText('Budget 2027')).not.toBeInTheDocument();
  });

  it('says so when the search fails', async () => {
    mockSearch.mockRejectedValueOnce(new Error('boom'));
    const user = userEvent.setup();
    open();
    await user.type(screen.getByLabelText('Link a document'), 'x');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
