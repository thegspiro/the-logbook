import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { MySuggestionSummary, SubmitterSuggestionDetail } from '../types/suggestions';

const mockListMine = vi.fn();
const mockGetMine = vi.fn();
const mockReplyMine = vi.fn();

vi.mock('../services/suggestionsService', () => ({
  suggestionsService: {
    listMine: (...args: unknown[]) => mockListMine(...args) as unknown,
    getMine: (...args: unknown[]) => mockGetMine(...args) as unknown,
    replyMine: (...args: unknown[]) => mockReplyMine(...args) as unknown,
    getMineAttachment: vi.fn(),
  },
}));

import MySuggestionsPanel from './MySuggestionsPanel';

const summary = (id: string, title: string): MySuggestionSummary => ({
  id,
  boxId: 'b1',
  boxName: 'Ideas',
  title,
  followUpEnabled: true,
  disposition: 'new',
  messageCount: 0,
  createdAt: '2026-09-23T15:00:00Z',
});

const detail = (id: string, title: string): SubmitterSuggestionDetail => ({
  id,
  boxName: 'Ideas',
  title,
  details: `Details of ${title}`,
  isAnonymous: false,
  followUpEnabled: true,
  disposition: 'new',
  attachments: [],
  messages: [],
  createdAt: '2026-09-23T15:00:00Z',
  timestampPrecision: 'exact',
});

describe('MySuggestionsPanel', () => {
  beforeEach(() => {
    mockListMine.mockReset();
    mockGetMine.mockReset();
    mockReplyMine.mockReset();
    mockListMine.mockResolvedValue([summary('a1', 'Night drills'), summary('a2', 'Hose tester')]);
    mockGetMine.mockImplementation((id: string) =>
      Promise.resolve(id === 'a1' ? detail('a1', 'Night drills') : detail('a2', 'Hose tester'))
    );
  });

  it('files a reply against the submission on screen', async () => {
    mockReplyMine.mockResolvedValue(detail('a1', 'Night drills'));
    renderWithRouter(<MySuggestionsPanel selectedId="a1" onSelect={vi.fn()} refreshToken={0} />);

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Reply'), 'Any update?');
    await user.click(screen.getByRole('button', { name: 'Send reply' }));

    expect(mockReplyMine).toHaveBeenCalledWith('a1', 'Any update?');
  });

  it('takes the previous submission off screen while the next one loads', async () => {
    const { rerender } = renderWithRouter(<MySuggestionsPanel selectedId="a1" onSelect={vi.fn()} refreshToken={0} />);
    expect(await screen.findByText('Details of Night drills')).toBeInTheDocument();

    // The next load never settles: nothing of the old submission may remain
    // to be replied to in the meantime.
    mockGetMine.mockReturnValue(new Promise(() => undefined));
    rerender(<MySuggestionsPanel selectedId="a2" onSelect={vi.fn()} refreshToken={0} />);

    expect(await screen.findByText('Select a submission to see it.')).toBeInTheDocument();
    expect(screen.queryByText('Details of Night drills')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Reply')).not.toBeInTheDocument();
  });

  it('clears a load error once a reload succeeds', async () => {
    mockListMine.mockRejectedValueOnce(new Error('offline'));
    const { rerender } = renderWithRouter(<MySuggestionsPanel selectedId="" onSelect={vi.fn()} refreshToken={0} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load your submissions');

    rerender(<MySuggestionsPanel selectedId="" onSelect={vi.fn()} refreshToken={1} />);

    expect(await screen.findByText('Night drills')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
