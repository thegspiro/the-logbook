import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

const mockSearch = vi.fn();

vi.mock('../services/api', () => ({
  minutesService: { searchArchive: (...a: unknown[]) => mockSearch(...a) as unknown },
}));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

import { ArchiveSearchResults } from './ArchiveSearchResults';
import { renderWithRouter } from '../../../test/utils';
import type { ArchiveHit, ArchiveSearchResponse } from '../types/minutes';

const hit = (overrides: Partial<ArchiveHit> = {}): ArchiveHit => ({
  id: 'm1',
  title: 'October business meeting',
  meeting_type: 'business',
  meeting_date: '2026-10-01T23:00:00Z',
  status: 'approved',
  match_count: 1,
  matches: [
    {
      kind: 'section',
      label: "Treasurer's Report",
      parts: [
        { text: 'We bought ', hit: false },
        { text: 'hose', hit: true },
        { text: ' today.', hit: false },
      ],
    },
  ],
  ...overrides,
});

const response = (overrides: Partial<ArchiveSearchResponse> = {}): ArchiveSearchResponse => ({
  terms: ['hose'],
  hits: [hit()],
  searched: 12,
  truncated: false,
  ...overrides,
});

const show = (query: string, meetingType = 'all') =>
  renderWithRouter(<ArchiveSearchResults query={query} meetingType={meetingType} />);

describe('ArchiveSearchResults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch.mockReset();
    mockSearch.mockResolvedValue(response());
  });

  it('shows nothing, and asks nothing, for fewer than two characters', async () => {
    const { container } = show(' h ');

    await new Promise((r) => setTimeout(r, 500));
    expect(container).toBeEmptyDOMElement();
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('groups what it found by minutes, with where it matched and the hit marked', async () => {
    show('hose');

    expect(await screen.findByRole('link', { name: 'October business meeting' })).toHaveAttribute(
      'href',
      '/minutes/m1'
    );
    expect(screen.getByText("Treasurer's Report")).toBeInTheDocument();
    expect(screen.getByText('hose').tagName).toBe('MARK');
    expect(screen.getByText('Adopted')).toBeInTheDocument();
    expect(screen.getByText(/Oct 1, 2026|10\/1\/2026/)).toBeInTheDocument();
    expect(mockSearch).toHaveBeenCalledWith('hose', undefined);
  });

  it('confines the search to the chosen meeting type', async () => {
    show('hose', 'board');

    await waitFor(() => expect(mockSearch).toHaveBeenCalledWith('hose', 'board'));
  });

  it('says how many more places matched than it shows', async () => {
    mockSearch.mockResolvedValue(response({ hits: [hit({ match_count: 4 })] }));
    show('hose');

    expect(await screen.findByText(/and 3 more places in these minutes/)).toBeInTheDocument();
  });

  it('explains an empty result, including the every-word rule', async () => {
    mockSearch.mockResolvedValue(response({ hits: [], terms: ['hose', 'ladder'] }));
    show('hose ladder');

    expect(await screen.findByText(/hose · ladder/)).toBeInTheDocument();
    expect(screen.getByText(/Every word you type must appear/)).toBeInTheDocument();
  });

  it('says when older minutes were left out of the search', async () => {
    mockSearch.mockResolvedValue(response({ truncated: true, searched: 500 }));
    show('hose');

    expect(await screen.findByText(/Only the newest 500 sets of minutes were searched/)).toBeInTheDocument();
  });

  it('shows a failure rather than an empty result', async () => {
    mockSearch.mockRejectedValue(new Error('boom'));
    show('hose');

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/No minutes contain/)).not.toBeInTheDocument();
  });

  it('renders minutes text as text, never as markup', async () => {
    mockSearch.mockResolvedValue(
      response({
        hits: [
          hit({
            matches: [
              { kind: 'section', label: 'Notes', parts: [{ text: '<img src=x onerror=alert(1)>', hit: false }] },
            ],
          }),
        ],
      })
    );
    show('img');

    expect(await screen.findByText('<img src=x onerror=alert(1)>', { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('shows only the answer to the latest words typed', async () => {
    let releaseFirst: (value: ArchiveSearchResponse) => void = () => undefined;
    mockSearch
      .mockImplementationOnce(() => new Promise<ArchiveSearchResponse>((resolve) => (releaseFirst = resolve)))
      .mockResolvedValueOnce(response({ hits: [hit({ id: 'm2', title: 'Second answer' })] }));
    const { rerender } = show('hos');
    await waitFor(() => expect(mockSearch).toHaveBeenCalledTimes(1));

    rerender(<ArchiveSearchResults query="hose" meetingType="all" />);
    expect(await screen.findByRole('link', { name: 'Second answer' })).toBeInTheDocument();
    releaseFirst(response({ hits: [hit({ id: 'm3', title: 'Stale answer' })] }));

    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('link', { name: 'Stale answer' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Second answer' })).toBeInTheDocument();
  });
});
