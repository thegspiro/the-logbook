/**
 * Eligibility Roster Component
 *
 * Secretary tool showing all active members with their ballot eligibility
 * status at a glance. Displays who will receive a ballot, who won't, and
 * exactly why — with per-ballot-item detail expandable per member.
 *
 * Color-coded rows make it immediately obvious which members are eligible
 * (green), ineligible (red/amber), have overrides (blue), or have already
 * voted (muted).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  ShieldCheck,
  Vote,
  Search,
  ChevronDown,
  ChevronRight,
  Users,
  UserX,
  UserCheck,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { electionService } from '../../../services/api';
import type { EligibilityRoster as EligibilityRosterType, RosterMember } from '../../../types/election';
import { getErrorMessage } from '../../../utils/errorHandling';

interface EligibilityRosterProps {
  electionId: string;
}

const FILTER_OPTIONS = [
  { value: 'all', label: 'All Members', icon: Users },
  { value: 'eligible', label: 'Eligible', icon: UserCheck },
  { value: 'ineligible', label: 'Ineligible', icon: UserX },
  { value: 'voted', label: 'Already Voted', icon: Vote },
  { value: 'overrides', label: 'Has Override', icon: ShieldCheck },
] as const;

type FilterValue = (typeof FILTER_OPTIONS)[number]['value'];

const MemberRow: React.FC<{
  member: RosterMember;
  expanded: boolean;
  onToggle: () => void;
}> = ({ member, expanded, onToggle }) => {
  const hasItems = member.item_eligibility.length > 0;

  const rowBg = member.has_voted
    ? 'bg-theme-surface-secondary/50'
    : member.has_override
      ? 'bg-blue-500/5'
      : member.will_receive_ballot
        ? 'bg-green-500/5'
        : 'bg-red-500/5';

  return (
    <>
      <tr
        className={`${rowBg} hover:bg-theme-surface-hover cursor-pointer transition-colors`}
        onClick={hasItems ? onToggle : undefined}
        role={hasItems ? 'row' : undefined}
        aria-expanded={hasItems ? expanded : undefined}
        tabIndex={hasItems ? 0 : undefined}
        onKeyDown={
          hasItems
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onToggle();
                }
              }
            : undefined
        }
      >
        {/* Expand/collapse */}
        <td className="w-8 py-3 pr-1 pl-3">
          {hasItems ? (
            expanded ? (
              <ChevronDown className="text-theme-text-muted h-4 w-4" />
            ) : (
              <ChevronRight className="text-theme-text-muted h-4 w-4" />
            )
          ) : (
            <span className="w-4" />
          )}
        </td>

        {/* Name + membership type */}
        <td className="py-3 pr-3">
          <div className="flex items-center gap-2">
            <span className="text-theme-text-primary text-sm font-medium">{member.full_name}</span>
            <span className="bg-theme-surface-secondary text-theme-text-muted rounded px-1.5 py-0.5 text-xs capitalize">
              {member.membership_type}
            </span>
          </div>
        </td>

        {/* Status badges */}
        <td className="py-3 pr-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {member.has_override && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-400">
                <ShieldCheck className="h-3 w-3" />
                Override
              </span>
            )}
            {member.is_attending && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                Present
              </span>
            )}
            {member.has_voted && (
              <span className="text-theme-text-muted bg-theme-surface-secondary inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium">
                <Vote className="h-3 w-3" />
                Voted
              </span>
            )}
          </div>
        </td>

        {/* Eligible items count */}
        <td className="py-3 pr-3 text-center">
          {member.will_receive_ballot ? (
            <span className="text-sm font-semibold text-green-700 dark:text-green-400">
              {member.eligible_item_count}/{member.total_item_count}
            </span>
          ) : (
            <span className="text-sm font-semibold text-red-600 dark:text-red-400">0/{member.total_item_count}</span>
          )}
        </td>

        {/* Will receive ballot */}
        <td className="py-3 pr-3 text-center">
          {member.will_receive_ballot ? (
            <CheckCircle2 className="mx-auto h-5 w-5 text-green-600 dark:text-green-400" />
          ) : (
            <XCircle className="mx-auto h-5 w-5 text-red-500 dark:text-red-400" />
          )}
        </td>

        {/* Reason (if ineligible) */}
        <td className="py-3 pr-4">
          {member.ineligibility_reason && (
            <span className="text-xs text-red-600 dark:text-red-400">{member.ineligibility_reason}</span>
          )}
        </td>
      </tr>

      {/* Expanded per-item detail */}
      {expanded && hasItems && (
        <tr>
          <td colSpan={6} className="px-4 pt-0 pb-3">
            <div className="bg-theme-surface border-theme-surface-border ml-6 rounded-lg border p-3">
              <div className="text-theme-text-muted mb-2 text-xs font-semibold tracking-wider uppercase">
                Per-Item Eligibility
              </div>
              <div className="space-y-1.5">
                {member.item_eligibility.map((item) => (
                  <div key={item.ballot_item_id} className="flex items-center justify-between text-sm">
                    <span className="text-theme-text-secondary mr-3 truncate">{item.ballot_item_title}</span>
                    <div className="flex shrink-0 items-center gap-2">
                      {item.eligible ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Eligible
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                          <XCircle className="h-3.5 w-3.5" />
                          {item.reason || 'Not eligible'}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
};

export const EligibilityRoster: React.FC<EligibilityRosterProps> = ({ electionId }) => {
  const [roster, setRoster] = useState<EligibilityRosterType | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterValue>('all');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const fetchRoster = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await electionService.getEligibilityRoster(electionId);
      setRoster(data);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load eligibility roster'));
    } finally {
      setLoading(false);
    }
  }, [electionId]);

  useEffect(() => {
    if (isOpen && !roster) {
      void fetchRoster();
    }
  }, [isOpen, roster, fetchRoster]);

  const toggleExpanded = useCallback((userId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  }, []);

  const filteredRoster = useMemo(() => {
    if (!roster) return [];
    let members = roster.roster;

    if (search.trim()) {
      const q = search.toLowerCase();
      members = members.filter(
        (m) =>
          m.full_name.toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q) ||
          m.membership_type.toLowerCase().includes(q)
      );
    }

    switch (filter) {
      case 'eligible':
        return members.filter((m) => m.will_receive_ballot);
      case 'ineligible':
        return members.filter((m) => !m.will_receive_ballot);
      case 'voted':
        return members.filter((m) => m.has_voted);
      case 'overrides':
        return members.filter((m) => m.has_override);
      default:
        return members;
    }
  }, [roster, search, filter]);

  return (
    <div className="bg-theme-surface overflow-hidden rounded-lg shadow-sm backdrop-blur-xs">
      {/* Header / Toggle */}
      <button
        className="hover:bg-theme-surface-hover flex w-full items-center justify-between px-6 py-4 text-left transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-3">
          <Users className="text-theme-text-muted h-5 w-5" />
          <div>
            <span className="text-theme-text-primary text-lg font-semibold">Voter Eligibility Roster</span>
            {roster && (
              <span className="text-theme-text-muted ml-3 text-sm">
                {roster.total_eligible} eligible / {roster.total_members} total
              </span>
            )}
          </div>
        </div>
        <ChevronDown
          className={`text-theme-text-muted h-5 w-5 transform transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="border-theme-surface-border border-t">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
              <span className="text-theme-text-muted ml-2 text-sm">Loading roster...</span>
            </div>
          )}

          {error && (
            <div className="p-4">
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3" role="alert">
                <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
              </div>
            </div>
          )}

          {roster && !loading && (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
                <div className="rounded-lg bg-green-500/10 p-3 text-center">
                  <div className="text-2xl font-bold text-green-700 dark:text-green-400">{roster.total_eligible}</div>
                  <div className="text-xs font-medium text-green-600 dark:text-green-500">Will Receive Ballot</div>
                </div>
                <div className="rounded-lg bg-red-500/10 p-3 text-center">
                  <div className="text-2xl font-bold text-red-700 dark:text-red-400">{roster.total_ineligible}</div>
                  <div className="text-xs font-medium text-red-600 dark:text-red-500">Ineligible</div>
                </div>
                <div className="rounded-lg bg-blue-500/10 p-3 text-center">
                  <div className="text-2xl font-bold text-blue-700 dark:text-blue-400">{roster.total_overrides}</div>
                  <div className="text-xs font-medium text-blue-600 dark:text-blue-500">Secretary Overrides</div>
                </div>
                <div className="bg-theme-surface-secondary rounded-lg p-3 text-center">
                  <div className="text-theme-text-primary text-2xl font-bold">{roster.total_voted}</div>
                  <div className="text-theme-text-muted text-xs font-medium">Already Voted</div>
                </div>
              </div>

              {/* Ineligible members warning */}
              {roster.total_ineligible > 0 && (
                <div className="mx-4 mb-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    <span className="font-semibold">{roster.total_ineligible} member(s)</span> will not receive a
                    ballot. Use <span className="font-semibold">Voter Overrides</span> below to grant exceptions, or
                    expand each row to see per-item reasons.
                  </p>
                </div>
              )}

              {/* Search + Filter bar */}
              <div className="flex flex-col gap-2 px-4 pb-3 sm:flex-row">
                <div className="relative flex-1">
                  <Search className="text-theme-text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by name, email, or membership type..."
                    aria-label="Search members"
                    className="form-input pr-3 pl-9"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter members by status">
                  {FILTER_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    const isActive = filter === opt.value;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setFilter(opt.value)}
                        aria-pressed={isActive}
                        className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                          isActive
                            ? 'bg-blue-600 text-white'
                            : 'bg-theme-surface-secondary text-theme-text-muted hover:bg-theme-surface-hover'
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Roster table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm" aria-label="Voter eligibility roster">
                  <thead>
                    <tr className="bg-theme-surface-secondary border-theme-surface-border border-y">
                      <th className="w-8 py-2 pr-1 pl-3" />
                      <th className="text-theme-text-muted py-2 pr-3 text-left text-xs font-semibold tracking-wider uppercase">
                        Member
                      </th>
                      <th className="text-theme-text-muted py-2 pr-3 text-left text-xs font-semibold tracking-wider uppercase">
                        Status
                      </th>
                      <th className="text-theme-text-muted py-2 pr-3 text-center text-xs font-semibold tracking-wider uppercase">
                        Items
                      </th>
                      <th className="text-theme-text-muted py-2 pr-3 text-center text-xs font-semibold tracking-wider uppercase">
                        Ballot
                      </th>
                      <th className="text-theme-text-muted py-2 pr-4 text-left text-xs font-semibold tracking-wider uppercase">
                        Reason
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-theme-surface-border divide-y">
                    {filteredRoster.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-theme-text-muted py-8 text-center text-sm">
                          {search || filter !== 'all'
                            ? 'No members match your search/filter.'
                            : 'No active members found.'}
                        </td>
                      </tr>
                    ) : (
                      filteredRoster.map((member) => (
                        <MemberRow
                          key={member.user_id}
                          member={member}
                          expanded={expandedIds.has(member.user_id)}
                          onToggle={() => toggleExpanded(member.user_id)}
                        />
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Footer with refresh */}
              <div className="border-theme-surface-border flex items-center justify-between border-t px-4 py-3">
                <span className="text-theme-text-muted text-xs">
                  Showing {filteredRoster.length} of {roster.total_members} members
                </span>
                <button
                  onClick={() => void fetchRoster()}
                  disabled={loading}
                  className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  Refresh
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default EligibilityRoster;
