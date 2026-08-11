/**
 * Debounced member lookup for the skills-testing pickers.
 *
 * Wraps `GET /training/skills-testing/candidates`, which is deliberately a
 * *search* rather than a listing: the fragment is required and the result set
 * is capped, so no request returns the roster. That matters more than it looks
 * — examining is open to every member, and `GET /users` needs `users.view`,
 * which the baseline member position does not carry. This endpoint is how a
 * member names someone without the full member-admin payload being opened up.
 *
 * Shared so every picker over the same population behaves the same way. The
 * viewers panel used to fetch the entire roster into a `<select>`, which both
 * scanned badly past a few dozen members and asked for far more data than
 * naming one person needs.
 *
 * The endpoint is named for its first caller. It is a member lookup; testing is
 * simply what the first picker wanted one for.
 */

import { useEffect, useState } from 'react';
import { skillsTestingService } from '../services/api';
import { getErrorMessage } from '../utils/errorHandling';
import { MEMBER_SEARCH_DEBOUNCE_MS, MEMBER_SEARCH_MIN_CHARS } from '../constants/config';
import type { SkillTestCandidate } from '../types/skillsTesting';

export interface MemberSearchResult {
  /** Matches for the current query; empty until the query clears the floor. */
  results: SkillTestCandidate[];
  loading: boolean;
  /** Set when the lookup failed, so a caller can say so rather than render an
   *  empty list that looks like "no such member". */
  error: string | null;
  /** True while the query is too short to send — the caller prompts instead of
   *  reporting no results. */
  tooShort: boolean;
}

export function useMemberSearch(query: string): MemberSearchResult {
  const [results, setResults] = useState<SkillTestCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = query.trim();
  const tooShort = trimmed.length < MEMBER_SEARCH_MIN_CHARS;

  useEffect(() => {
    if (tooShort) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const found = await skillsTestingService.searchCandidates(trimmed);
          // A slower earlier request must not overwrite a later one's results.
          if (!cancelled) setResults(found);
        } catch (err: unknown) {
          if (!cancelled) {
            setResults([]);
            setError(getErrorMessage(err, 'Failed to search members'));
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, MEMBER_SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, tooShort]);

  return { results, loading, error, tooShort };
}
