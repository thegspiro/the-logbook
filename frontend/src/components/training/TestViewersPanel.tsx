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
import { Eye, Plus, Trash2, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';

import { skillsTestingService, userService } from '../../services/api';
import type { SkillTestViewer } from '../../types/skillsTesting';
import type { User } from '../../types/user';
import { formatDate } from '../../utils/dateFormatting';
import { useTimezone } from '../../hooks/useTimezone';
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

function memberName(user: User): string {
  const full = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim();
  return full || user.full_name || user.username;
}

export const TestViewersPanel: React.FC<TestViewersPanelProps> = ({ testId, candidateId, examinerId }) => {
  const tz = useTimezone();
  const [viewers, setViewers] = useState<SkillTestViewer[]>([]);
  const [members, setMembers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [grants, users] = await Promise.all([skillsTestingService.getTestViewers(testId), userService.getUsers()]);
      setViewers(grants);
      setMembers(users);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load who can see this result'));
    } finally {
      setLoading(false);
    }
  }, [testId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Everyone who could still be granted: not the candidate, not the examiner,
  // and not already holding a grant.
  const selectableMembers = useMemo(() => {
    const granted = new Set(viewers.map((v) => v.user_id));
    return members
      .filter((m) => m.id !== candidateId && m.id !== examinerId && !granted.has(m.id))
      .sort((a, b) => memberName(a).localeCompare(memberName(b)));
  }, [members, viewers, candidateId, examinerId]);

  const handleAdd = async () => {
    if (!selectedId) return;
    setAdding(true);
    try {
      const grant = await skillsTestingService.addTestViewer(testId, selectedId);
      setViewers((current) => [...current, grant]);
      setSelectedId('');
      toast.success(`${grant.user_name ?? 'Member'} can now see this result`);
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

          {selectableMembers.length > 0 ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <label htmlFor="add-test-viewer" className="sr-only">
                Member to grant access to
              </label>
              <select
                id="add-test-viewer"
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                className="form-input flex-1 text-sm"
              >
                <option value="">Add someone…</option>
                {selectableMembers.map((member) => (
                  <option key={member.id} value={member.id}>
                    {memberName(member)}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void handleAdd()}
                disabled={!selectedId || adding}
                className="mobile-touch-target flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {adding ? <Plus className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
                {adding ? 'Adding…' : 'Add'}
              </button>
            </div>
          ) : (
            <p className="text-theme-text-muted text-xs">
              Everyone else in the department already has access to this result.
            </p>
          )}
        </>
      )}
    </div>
  );
};

export default TestViewersPanel;
