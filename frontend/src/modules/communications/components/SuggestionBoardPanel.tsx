/**
 * The idea board: what a department's reviewers chose to publish, in the
 * words they wrote for it, with one vote per member.
 *
 * Nothing here is the original submission. The backend sends only the
 * published copy, so no submitter, detail or screenshot can reach this screen.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ChevronUp, Lightbulb, Loader2 } from 'lucide-react';
import { EmptyState } from '../../../components/ux';
import {
  SUGGESTION_DISPOSITION_COLORS,
  SUGGESTION_DISPOSITION_LABELS,
  SuggestionDisposition,
} from '../../../constants/enums';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { suggestionsService } from '../services/suggestionsService';
import type { BoardEntry, BoardSort, ReviewFilter, SuggestionBoxPublic } from '../types/suggestions';

const PAGE_SIZE = 25;

const STATUS_FILTERS: { value: ReviewFilter; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: SuggestionDisposition.ACCEPTED, label: 'Accepted' },
  { value: SuggestionDisposition.IMPLEMENTED, label: 'Implemented' },
  { value: SuggestionDisposition.DECLINED, label: 'Declined' },
];

interface SuggestionBoardPanelProps {
  /** Boxes with a board, for the box filter. */
  boxes: SuggestionBoxPublic[];
}

interface BoardCardProps {
  entry: BoardEntry;
  isVoting: boolean;
  onToggleVote: (entry: BoardEntry) => void;
}

const BoardCard: React.FC<BoardCardProps> = ({ entry, isVoting, onToggleVote }) => {
  const tz = useTimezone();
  return (
    <article className="card flex gap-3 p-4" aria-labelledby={`board-${entry.id}-title`}>
      <button
        type="button"
        className={`flex min-h-[44px] min-w-[44px] shrink-0 flex-col items-center justify-center self-start rounded-md border px-2 py-1 text-sm font-semibold disabled:opacity-60 ${
          entry.hasVoted
            ? 'border-blue-800 bg-blue-800 text-white'
            : 'border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-hover'
        }`}
        aria-pressed={entry.hasVoted}
        aria-label={`${entry.hasVoted ? 'Remove your vote for' : 'Vote for'} ${entry.title}, ${entry.voteCount} ${
          entry.voteCount === 1 ? 'vote' : 'votes'
        }`}
        disabled={isVoting}
        onClick={() => onToggleVote(entry)}
      >
        <ChevronUp className="h-4 w-4" aria-hidden="true" />
        {entry.voteCount}
      </button>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={`board-${entry.id}-title`} className="text-theme-text-primary font-semibold">
            {entry.title}
          </h3>
          <span className={`badge ${SUGGESTION_DISPOSITION_COLORS[entry.disposition] ?? ''}`}>
            {SUGGESTION_DISPOSITION_LABELS[entry.disposition] ?? entry.disposition}
          </span>
        </div>
        <p className="text-theme-text-primary text-sm whitespace-pre-wrap">{entry.summary}</p>
        {entry.publicResponse && (
          <blockquote className="bg-theme-surface-secondary text-theme-text-primary rounded-md p-3 text-sm whitespace-pre-wrap">
            <span className="text-theme-text-muted mb-1 block text-xs font-medium">Reviewers</span>
            {entry.publicResponse}
          </blockquote>
        )}
        <p className="text-theme-text-muted text-xs">
          {entry.boxName} · Published {formatDate(entry.publishedAt, tz)}
        </p>
      </div>
    </article>
  );
};

const SuggestionBoardPanel: React.FC<SuggestionBoardPanelProps> = ({ boxes }) => {
  const [sort, setSort] = useState<BoardSort>('top');
  const [status, setStatus] = useState<ReviewFilter>('');
  const [boxId, setBoxId] = useState('');
  const [items, setItems] = useState<BoardEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [votingId, setVotingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const page = await suggestionsService.listBoard({ boxId, disposition: status, sort, skip: 0, limit: PAGE_SIZE });
      setItems(page.items);
      setTotal(page.total);
    } catch {
      setError('Unable to load the idea board. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [boxId, status, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    setIsLoadingMore(true);
    try {
      const page = await suggestionsService.listBoard({
        boxId,
        disposition: status,
        sort,
        skip: items.length,
        limit: PAGE_SIZE,
      });
      setItems((current) => [...current, ...page.items]);
      setTotal(page.total);
    } catch {
      toast.error('Unable to load more ideas.');
    } finally {
      setIsLoadingMore(false);
    }
  };

  // The list keeps its order after a vote. Re-sorting under the member's
  // finger would move the card they just tapped.
  const toggleVote = async (entry: BoardEntry) => {
    setVotingId(entry.id);
    try {
      const updated = entry.hasVoted
        ? await suggestionsService.withdrawVote(entry.id)
        : await suggestionsService.vote(entry.id);
      setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Unable to record your vote.'));
    } finally {
      setVotingId(null);
    }
  };

  const pillClass = (active: boolean) =>
    `touch-target-phone rounded-full border px-3 py-1 text-sm whitespace-nowrap ${
      active
        ? 'border-blue-800 bg-blue-800 text-white'
        : 'border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover'
    }`;

  return (
    <div className="space-y-4">
      <p className="text-theme-text-secondary text-sm">
        Ideas reviewers have shared from the suggestion boxes. Vote for the ones you would like to see happen; each
        member has one vote per idea.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div role="group" aria-label="Sort" className="flex gap-2">
          <button
            type="button"
            className={pillClass(sort === 'top')}
            aria-pressed={sort === 'top'}
            onClick={() => setSort('top')}
          >
            Top
          </button>
          <button
            type="button"
            className={pillClass(sort === 'new')}
            aria-pressed={sort === 'new'}
            onClick={() => setSort('new')}
          >
            New
          </button>
        </div>
        {boxes.length > 1 && (
          <div>
            <label htmlFor="board-box" className="form-label">
              Box
            </label>
            <select id="board-box" className="form-input" value={boxId} onChange={(e) => setBoxId(e.target.value)}>
              <option value="">All boxes</option>
              {boxes.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div role="group" aria-label="Status" className="hscroll flex gap-2">
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter.value || 'all'}
            type="button"
            className={pillClass(status === filter.value)}
            aria-pressed={status === filter.value}
            onClick={() => setStatus(filter.value)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="alert-danger text-sm">
          {error}
        </p>
      )}

      {isLoading ? (
        <p className="text-theme-text-muted text-sm">Loading…</p>
      ) : error ? null : items.length === 0 ? (
        <EmptyState
          icon={Lightbulb}
          title="No ideas here yet"
          description="When reviewers publish a suggestion to the board, it appears here for everyone to vote on."
        />
      ) : (
        <ul className="space-y-3" aria-label="Ideas">
          {items.map((entry) => (
            <li key={entry.id}>
              <BoardCard entry={entry} isVoting={votingId === entry.id} onToggleVote={(e) => void toggleVote(e)} />
            </li>
          ))}
        </ul>
      )}
      {!isLoading && items.length < total && (
        <button
          type="button"
          className="btn-secondary inline-flex items-center gap-2 px-4 py-2 disabled:opacity-60"
          disabled={isLoadingMore}
          onClick={() => void loadMore()}
        >
          {isLoadingMore && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Load more
        </button>
      )}
    </div>
  );
};

export default SuggestionBoardPanel;
