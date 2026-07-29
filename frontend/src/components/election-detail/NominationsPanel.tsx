import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { electionService, userService } from '../../services/api';
import type { Candidate, Election } from '../../types/election';
import type { User } from '../../types/user';
import { UserStatus } from '../../constants/enums';
import { getErrorMessage } from '../../utils/errorHandling';

interface NominationsPanelProps {
  electionId: string;
  election: Election;
  currentUserId: string | null;
  nominationsOpen: boolean;
}

/**
 * Member-facing nomination phase panel: nominate a member (or yourself)
 * for a position, see all nominations with their acceptance state, and
 * accept or decline your own pending nominations.
 */
const NominationsPanel: React.FC<NominationsPanelProps> = ({
  electionId,
  election,
  currentUserId,
  nominationsOpen,
}) => {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [members, setMembers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [position, setPosition] = useState('');
  const [nomineeId, setNomineeId] = useState('');
  const [statement, setStatement] = useState('');

  const positions = election.positions ?? [];

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [candidateData, memberData] = await Promise.all([
        electionService.getCandidates(electionId),
        userService.getUsers(),
      ]);
      setCandidates(candidateData);
      setMembers(
        memberData.filter(
          (m: User) => m.status === UserStatus.ACTIVE || m.status === UserStatus.PROBATIONARY,
        ),
      );
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load nominations'));
    } finally {
      setLoading(false);
    }
  }, [electionId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleNominate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!position) return;
    try {
      setSubmitting(true);
      await electionService.createNomination(electionId, {
        position,
        // '' = self-nomination; omit the field entirely (Pitfall #1: || not ??)
        nominee_user_id: nomineeId || undefined,
        statement: statement.trim() || undefined,
      });
      toast.success('Nomination submitted');
      setPosition('');
      setNomineeId('');
      setStatement('');
      await fetchData();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to submit nomination'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRespond = async (candidateId: string, accept: boolean) => {
    try {
      if (accept) {
        await electionService.acceptNomination(electionId, candidateId);
        toast.success('Nomination accepted');
      } else {
        await electionService.declineNomination(electionId, candidateId);
        toast.success('Nomination declined');
      }
      await fetchData();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to update nomination'));
    }
  };

  if (loading) {
    return <p className="text-sm text-theme-text-muted">Loading nominations…</p>;
  }

  return (
    <div className="space-y-6">
      {nominationsOpen && (
        <form onSubmit={(e) => { void handleNominate(e); }} className="card p-4 space-y-3">
          <h4 className="text-sm font-semibold text-theme-text-primary">Submit a Nomination</h4>
          {election.nomination_deadline && (
            <p className="text-xs text-theme-text-muted">
              Nominations close automatically at the configured deadline.
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="nomination-position" className="form-label">
                Position <span aria-hidden="true">*</span>
              </label>
              <select
                id="nomination-position"
                required
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                className="form-input"
              >
                <option value="">Select position…</option>
                {positions.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="nomination-nominee" className="form-label">
                Nominee
              </label>
              <select
                id="nomination-nominee"
                value={nomineeId}
                onChange={(e) => setNomineeId(e.target.value)}
                className="form-input"
              >
                <option value="">Myself</option>
                {members
                  .filter((m) => m.id !== currentUserId)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.full_name || `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim()}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="nomination-statement" className="form-label">
              Statement <span className="text-xs text-theme-text-muted">(optional)</span>
            </label>
            <textarea
              id="nomination-statement"
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="Why this member is a good fit for the position"
              className="form-input"
            />
          </div>
          <div className="flex justify-end">
            <button type="submit" disabled={submitting || !position} className="btn-primary rounded-md disabled:opacity-50">
              {submitting ? 'Submitting…' : 'Nominate'}
            </button>
          </div>
        </form>
      )}

      <div>
        <h4 className="text-sm font-semibold text-theme-text-primary mb-2">Nominations</h4>
        {candidates.length === 0 ? (
          <p className="text-sm text-theme-text-muted">No nominations yet.</p>
        ) : (
          <ul className="divide-y divide-theme-surface-border">
            {candidates.map((c) => (
              <li key={c.id} className="py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-theme-text-primary">
                    {c.name}
                    {c.position && <span className="text-theme-text-muted"> — {c.position}</span>}
                  </p>
                  {c.statement && <p className="text-xs text-theme-text-muted mt-0.5">{c.statement}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {c.accepted ? (
                    <span className="badge bg-green-500/10 text-green-700 dark:text-green-300">Accepted</span>
                  ) : (
                    <span className="badge bg-amber-500/10 text-amber-700 dark:text-amber-300">Pending</span>
                  )}
                  {!c.accepted && currentUserId && c.user_id === currentUserId && (
                    <>
                      <button
                        type="button"
                        onClick={() => { void handleRespond(c.id, true); }}
                        className="btn-success rounded-md text-xs px-3 py-1.5"
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        onClick={() => { void handleRespond(c.id, false); }}
                        className="px-3 py-1.5 text-xs border border-theme-surface-border rounded-md text-theme-text-secondary hover:bg-theme-surface-hover"
                      >
                        Decline
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default NominationsPanel;
