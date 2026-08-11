/**
 * Test Viewers Panel
 *
 * Officer-facing control for granting one named person sight of a single
 * test's result — the relationship the candidate and position rules cannot
 * express: a preceptor, an FTO, a mentor.
 *
 * Named per test rather than per template because the relationship is to the
 * person tested, not to the skill. A trainee's FTO changes, and a standing
 * template-wide grant would quietly follow the skill onto every other
 * candidate's results.
 *
 * A grantee sees the result at the same disclosure level the candidate does,
 * never more, so this panel says so rather than implying it hands out full
 * access.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, Search, Trash2, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';

import { skillsTestingService } from '../../services/api';
import type { SkillTestViewer } from '../../types/skillsTesting';
import { formatDate } from '../../utils/dateFormatting';
import { useTimezone } from '../../hooks/useTimezone';
import { useMemberSearch } from '../../hooks/useMemberSearch';
import { MEMBER_SEARCH_MIN_CHARS } from '../../constants/config';
import { getErrorMessage } from '../../utils/errorHandling';
import { Skeleton } from '../ux/Skeleton';

interface TestViewersPanelProps {
  testId: string;
  /** Excluded from the picker — they already see the result as policy allows,
   *  and the API rejects granting to them. */
  candidateId: string;
  /** Excluded too: the examiner always sees what they themselves recorded, so
   *  a grant would be a no-op the officer could not tell had done nothing. */
  examinerId: string;
}

export const TestViewersPanel: React.FC<TestViewersPanelProps> = ({ testId, candidateId, examinerId }) => {
  const tz = useTimezone();
  const [viewers, setViewers] = useState<SkillTestViewer[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A name lookup rather than a roster in a dropdown. The panel used to load
  // every member into a `<select>` — unscannable past a few dozen people, and
  // far more data than naming one person needs. Same control the start-test
  // candidate picker uses, over the same search-only endpoint.
  const [search, setSearch] = useState('');
  const { results, loading: searching, error: searchError, tooShort } = useMemberSearch(search);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setViewers(await skillsTestingService.getTestViewers(testId));
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load who can see this result'));
    } finally {
      setLoading(false);
    }
  }, [testId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Anyone who could still be granted: not the candidate (policy already
  // decides what they see), not the examiner (they see what they recorded, so
  // a grant would be a no-op the officer could not tell had done nothing), and
  // nobody already holding one. Filtered from the search results rather than
  // from a roster, so the exclusions still apply to whatever the lookup found.
  const grantable = useMemo(() => {
    const granted = new Set(viewers.map((v) => v.user_id));
    return results.filter((m) => m.id !== candidateId && m.id !== examinerId && !granted.has(m.id));
  }, [results, viewers, candidateId, examinerId]);

  const handleAdd = async (userId: string, name: string) => {
    setAdding(true);
    try {
      const grant = await skillsTestingService.addTestViewer(testId, userId);
      setViewers((current) => [...current, grant]);
      setSearch('');
      toast.success(`${grant.user_name ?? name} can now see this result`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to grant access'));
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (viewer: SkillTestViewer) => {
    setRemovingId(viewer.user_id);
    try {
      await skillsTestingService.removeTestViewer(testId, viewer.user_id);
      setViewers((current) => current.filter((v) => v.user_id !== viewer.user_id));
      toast.success(`${viewer.user_name ?? 'Member'} can no longer see this result`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to withdraw access'));
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="card">
      <div className="mb-1 flex items-center gap-1.5">
        <Eye className="text-theme-text-muted h-3 w-3" />
        <p className="text-theme-text-primary text-sm font-medium">Who else can see this result</p>
      </div>
      <p className="text-theme-text-muted mb-3 text-xs">
        Officers always see the full scorecard. Anyone added here sees it at the same level the candidate does — never
        more.
      </p>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : (
        <>
          {viewers.length === 0 ? (
            <p className="text-theme-text-muted mb-3 text-sm">
              Nobody outside the candidate, the examiner and your officers.
            </p>
          ) : (
            <ul className="mb-3 space-y-2">
              {viewers.map((viewer) => (
                <li key={viewer.id} className="bg-theme-surface flex items-center justify-between rounded-lg p-2">
                  <div className="min-w-0">
                    <p className="text-theme-text-primary truncate text-sm font-medium">
                      {viewer.user_name ?? 'Unknown member'}
                    </p>
                    {viewer.granted_at && (
                      <p className="text-theme-text-muted text-xs">
                        Added {formatDate(viewer.granted_at, tz)}
                        {viewer.granted_by_name ? ` by ${viewer.granted_by_name}` : ''}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => void handleRemove(viewer)}
                    disabled={removingId === viewer.user_id}
                    className="text-theme-text-muted mobile-touch-target rounded-lg p-2 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-900/20"
                    aria-label={`Remove ${viewer.user_name ?? 'member'}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div>
            <label htmlFor="add-test-viewer" className="sr-only">
              Search for a member to grant access to
            </label>
            <div className="relative">
              <Search
                className="text-theme-text-muted pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
                aria-hidden="true"
              />
              <input
                id="add-test-viewer"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Add someone — search by name…"
                className="form-input w-full pl-9 text-sm"
              />
            </div>

            {searchError ? (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">{searchError}</p>
            ) : tooShort ? (
              // Prompted rather than reported as "no matches": the search was
              // never sent, so there is nothing to have found.
              search.trim().length > 0 && (
                <p className="text-theme-text-muted mt-2 text-xs">
                  Type at least {MEMBER_SEARCH_MIN_CHARS} characters of a name.
                </p>
              )
            ) : searching ? (
              <p className="text-theme-text-muted mt-2 text-xs">Searching…</p>
            ) : grantable.length === 0 ? (
              <p className="text-theme-text-muted mt-2 text-xs">
                No members match, or everyone who does already sees this result.
              </p>
            ) : (
              <ul className="border-theme-surface-border divide-theme-surface-border mt-2 max-h-48 divide-y overflow-y-auto rounded-lg border">
                {grantable.map((member) => (
                  <li key={member.id}>
                    <button
                      onClick={() => void handleAdd(member.id, member.name)}
                      disabled={adding}
                      className="hover:bg-theme-surface-hover mobile-touch-target flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors disabled:opacity-50"
                    >
                      <UserPlus className="text-theme-text-muted h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="text-theme-text-primary truncate">{member.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default TestViewersPanel;
