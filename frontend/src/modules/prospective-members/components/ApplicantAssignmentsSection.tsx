/**
 * Applicant Assignments Section
 *
 * The members assigned to this applicant as case manager or interviewer, and,
 * for a coordinator, the controls to assign and unassign them. An assignment
 * is what lets a member without the pipeline permission see this applicant,
 * so any current member can be chosen: a board member or a trustee asked to
 * interview is assigned here and finds the applicant on My Applicants.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, UserCheck, X } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Applicant, ProspectAssignment } from '../types';
import { AssignmentRole } from '../types';
import { assignmentService } from '../services/api';
import { userService } from '../../../services/api';
import type { User } from '../../../types/user';
import { isActiveAccount } from '../../../constants/enums';
import { displayNameOf } from '../../../utils/memberName';
import { getErrorMessage } from '../../../utils/errorHandling';
import { useApplicantAccess } from './ApplicantAccessContext';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { ASSIGNMENT_ROLE_LABELS } from '../constants';

interface ApplicantAssignmentsSectionProps {
  applicant: Applicant;
}

const memberName = (member: User): string => displayNameOf(member) || member.username;

const ApplicantAssignmentsSection: React.FC<ApplicantAssignmentsSectionProps> = ({ applicant }) => {
  const access = useApplicantAccess();
  const { confirm } = useConfirm();
  const [assignments, setAssignments] = useState<ProspectAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<User[]>([]);
  const [memberId, setMemberId] = useState('');
  const [role, setRole] = useState<AssignmentRole>(AssignmentRole.CASE_MANAGER);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    assignmentService
      .list(applicant.id)
      .then((rows) => {
        if (!cancelled) setAssignments(rows);
      })
      .catch(() => {
        if (!cancelled) setAssignments([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applicant.id]);

  useEffect(() => {
    if (!access.can_manage) return undefined;
    let cancelled = false;
    userService
      .getUsers()
      .then((rows) => {
        if (!cancelled) setMembers(rows.filter((m) => isActiveAccount(m.status)));
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [access.can_manage]);

  const sortedMembers = useMemo(
    () => [...members].sort((a, b) => memberName(a).localeCompare(memberName(b))),
    [members]
  );

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memberId || busy) return;
    setBusy(true);
    try {
      const created = await assignmentService.add(applicant.id, memberId, role);
      setAssignments((prev) => (prev.some((a) => a.id === created.id) ? prev : [...prev, created]));
      setMemberId('');
      toast.success(
        `${created.user_name ?? 'Member'} assigned as ${ASSIGNMENT_ROLE_LABELS[created.role].toLowerCase()}`
      );
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'The member could not be assigned'));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (assignment: ProspectAssignment) => {
    const name = assignment.user_name ?? 'this member';
    const ok = await confirm({
      title: 'Remove assignment',
      message: `${name} will stop seeing this applicant unless something else gives them access.`,
      confirmLabel: 'Remove',
      cancelLabel: 'Keep',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await assignmentService.remove(applicant.id, assignment.id);
      setAssignments((prev) => prev.filter((a) => a.id !== assignment.id));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'The assignment could not be removed'));
    } finally {
      setBusy(false);
    }
  };

  if (!loading && assignments.length === 0 && !access.can_manage) return null;

  return (
    <div className="border-theme-surface-border border-b p-4">
      <h3 className="text-theme-text-muted mb-3 flex items-center gap-1.5 text-xs font-medium tracking-wider uppercase">
        <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
        Assigned
      </h3>

      {loading ? (
        <div className="flex items-center justify-center py-3" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-4 w-4 animate-spin" aria-hidden="true" />
          <span className="sr-only">Loading assignments</span>
        </div>
      ) : assignments.length === 0 ? (
        <p className="text-theme-text-muted text-xs">Nobody is assigned to this applicant.</p>
      ) : (
        <ul className="space-y-1.5">
          {assignments.map((assignment) => (
            <li key={assignment.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-theme-text-primary min-w-0 truncate">
                {assignment.user_name ?? 'Unknown member'}
                <span className="badge bg-theme-surface-secondary text-theme-text-secondary ml-2">
                  {ASSIGNMENT_ROLE_LABELS[assignment.role]}
                </span>
              </span>
              {access.can_manage && (
                <button
                  type="button"
                  onClick={() => void handleRemove(assignment)}
                  disabled={busy}
                  className="btn-icon text-theme-text-muted hover:text-theme-text-primary"
                  aria-label={`Remove ${assignment.user_name ?? 'member'} as ${ASSIGNMENT_ROLE_LABELS[assignment.role].toLowerCase()}`}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {access.can_manage && (
        <form onSubmit={(e) => void handleAssign(e)} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <label htmlFor="assignment-member" className="form-label">
              Member
            </label>
            <select
              id="assignment-member"
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              className="form-input"
            >
              <option value="">Choose a member...</option>
              {sortedMembers.map((member) => (
                <option key={member.id} value={member.id}>
                  {memberName(member)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="assignment-role" className="form-label">
              As
            </label>
            <select
              id="assignment-role"
              value={role}
              onChange={(e) => setRole(e.target.value as AssignmentRole)}
              className="form-input"
            >
              <option value={AssignmentRole.CASE_MANAGER}>Case manager</option>
              <option value={AssignmentRole.INTERVIEWER}>Interviewer</option>
            </select>
          </div>
          <button type="submit" disabled={!memberId || busy} className="btn-secondary">
            Assign
          </button>
        </form>
      )}
    </div>
  );
};

export default ApplicantAssignmentsSection;
