/**
 * The words of the minutes archive, found for whatever is typed in the search
 * box above it.
 *
 * Results are grouped by minutes, newest meeting first, each with the places it
 * matched (a section, a motion, an action item) and a snippet around the match.
 * A snippet arrives as plain and highlighted parts and is rendered as text, so
 * nothing the minutes contain is ever interpreted as markup. What a caller may
 * search is decided by the server: members search circulated and adopted
 * minutes only, managers search everything and see each result's status.
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { FileSearch, Loader2 } from 'lucide-react';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { minutesService } from '../services/api';
import type { ArchiveSearchResponse } from '../types/minutes';

const DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 2;

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Circulated for review',
  approved: 'Adopted',
  rejected: 'Returned for changes',
};

const TYPE_LABELS: Record<string, string> = {
  business: 'Business',
  special: 'Special',
  committee: 'Committee',
  board: 'Board',
  trustee: 'Trustee',
  executive: 'Executive',
  annual: 'Annual',
  other: 'Other',
};

interface ArchiveSearchResultsProps {
  query: string;
  /** A meeting type to confine the search to, or "all". */
  meetingType: string;
}

export const ArchiveSearchResults: React.FC<ArchiveSearchResultsProps> = ({ query, meetingType }) => {
  const tz = useTimezone();
  const trimmed = query.trim();
  const active = trimmed.length >= MIN_QUERY_LENGTH;
  const [result, setResult] = useState<ArchiveSearchResponse | null>(null);
  const [settled, setSettled] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let current = true;
    const timer = setTimeout(() => {
      minutesService
        .searchArchive(trimmed, meetingType === 'all' ? undefined : meetingType)
        .then((response) => {
          if (!current) return;
          setResult(response);
          setError(null);
          setSettled(`${trimmed}|${meetingType}`);
        })
        .catch((err: unknown) => {
          if (!current) return;
          setResult(null);
          setError(getErrorMessage(err, 'The minutes could not be searched'));
          setSettled(`${trimmed}|${meetingType}`);
        });
    }, DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [active, trimmed, meetingType]);

  if (!active) return null;

  const searching = settled !== `${trimmed}|${meetingType}`;

  return (
    <section className="card mb-6 p-4" aria-labelledby="archive-search-heading">
      <div className="mb-3 flex items-center gap-2">
        <FileSearch className="text-theme-text-muted h-5 w-5" aria-hidden="true" />
        <h2 id="archive-search-heading" className="text-theme-text-primary text-base font-semibold">
          Found in the minutes
        </h2>
        {searching && <Loader2 className="h-4 w-4 animate-spin text-cyan-700" aria-hidden="true" />}
      </div>

      <div role="status" aria-live="polite" className="text-theme-text-muted mb-3 text-sm">
        {searching && 'Searching the minutes…'}
        {!searching && !error && result && result.hits.length === 0 && (
          <>
            No minutes contain <strong className="text-theme-text-primary">{result.terms.join(' · ')}</strong>. Every
            word you type must appear somewhere in the minutes; put a phrase in quotes to match it exactly.
          </>
        )}
        {!searching &&
          !error &&
          result &&
          result.hits.length > 0 &&
          `${result.hits.length} set${result.hits.length === 1 ? '' : 's'} of minutes, newest first.`}
      </div>

      {!searching && error && (
        <p className="alert-danger text-sm" role="alert">
          {error}
        </p>
      )}

      {!searching && !error && result && result.hits.length > 0 && (
        <ul className="divide-theme-surface-border divide-y">
          {result.hits.map((hit) => (
            <li key={hit.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <Link
                  to={`/minutes/${hit.id}`}
                  className="text-theme-text-primary text-sm font-semibold underline-offset-2 hover:underline"
                >
                  {hit.title}
                </Link>
                <span className="text-theme-text-muted text-xs">
                  {formatDate(hit.meeting_date, tz)} · {TYPE_LABELS[hit.meeting_type] ?? hit.meeting_type}
                </span>
                <span className="bg-theme-surface-secondary text-theme-text-secondary rounded-full px-2 py-0.5 text-xs">
                  {STATUS_LABELS[hit.status] ?? hit.status}
                </span>
              </div>
              <ul className="mt-2 space-y-1.5">
                {hit.matches.map((match, index) => (
                  <li key={`${match.kind}-${match.label}-${index}`} className="text-theme-text-secondary text-sm">
                    <span className="text-theme-text-muted mr-2 text-xs font-medium uppercase">{match.label}</span>
                    {match.parts.map((part, partIndex) =>
                      part.hit ? (
                        <mark
                          key={partIndex}
                          className="text-theme-text-primary rounded-sm bg-amber-200 px-0.5 dark:bg-amber-400/30"
                        >
                          {part.text}
                        </mark>
                      ) : (
                        <React.Fragment key={partIndex}>{part.text}</React.Fragment>
                      )
                    )}
                  </li>
                ))}
              </ul>
              {hit.match_count > hit.matches.length && (
                <p className="text-theme-text-muted mt-1 text-xs">
                  and {hit.match_count - hit.matches.length} more place
                  {hit.match_count - hit.matches.length === 1 ? '' : 's'} in these minutes
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {!searching && result?.truncated && (
        <p className="text-theme-text-muted mt-3 text-xs">
          Only the newest {result.searched} sets of minutes were searched. Narrow the search by meeting type to reach
          older ones.
        </p>
      )}
    </section>
  );
};

export default ArchiveSearchResults;
