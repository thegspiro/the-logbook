/**
 * The sections of one election, each addressed by its own path.
 *
 * `/elections/:id` is the Overview; `/elections/:id/<section>` opens one
 * section. A path rather than `?tab=` so a section is a real address: the
 * secretary can send "the results" or "the eligibility roster" as a link, and
 * a refresh or the Back button lands where it should. Links written against
 * the older `?tab=` contract — including the nominations link the backend
 * puts in notification emails — are forwarded by `ElectionDetailRoute`.
 *
 * `visibleElectionSections` is the one place that decides who sees which
 * section, and when. The page, its section links and the redirect all read it,
 * so a section cannot be linked to by someone the page would not show it to.
 */

import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  ClipboardList,
  FileSearch,
  FileText,
  Handshake,
  Megaphone,
  Shield,
  UserCheck,
  Users,
  Vote,
} from 'lucide-react';
import type { Election } from '../../types/election';
import { ElectionStatus } from '../../constants/enums';

export const ELECTION_SECTIONS = [
  'ballot',
  'nominations',
  'candidates',
  'eligibility',
  'attendance',
  'overrides',
  'proxies',
  'voting',
  'results',
  'integrity',
] as const;

export type ElectionSection = (typeof ELECTION_SECTIONS)[number];

export interface ElectionSectionDef {
  id: ElectionSection;
  label: string;
  icon: LucideIcon;
  badge?: number | undefined;
}

export const isElectionSection = (value: unknown): value is ElectionSection =>
  typeof value === 'string' && (ELECTION_SECTIONS as readonly string[]).includes(value);

/** The address of an election's Overview, or of one of its sections. */
export const electionSectionPath = (electionId: string, section?: ElectionSection | null): string =>
  section ? `/elections/${electionId}/${section}` : `/elections/${electionId}`;

type SectionFacts = Pick<Election, 'status' | 'results_visible_immediately' | 'ballot_items'>;

/**
 * The sections this viewer may open on this election, in display order.
 *
 * The rules are the ones the tab strip applied before sections had paths; the
 * one addition is Integrity & Audit, which was the collapsible Forensics block
 * under the tabs, shown on the same condition.
 */
export function visibleElectionSections(
  election: SectionFacts,
  canManage: boolean,
  candidateCount?: number
): ElectionSectionDef[] {
  const isDraft = election.status === ElectionStatus.DRAFT;
  const isNominations = election.status === ElectionStatus.NOMINATIONS;
  const isOpen = election.status === ElectionStatus.OPEN;
  const isClosed = election.status === ElectionStatus.CLOSED;
  const isCancelled = election.status === ElectionStatus.CANCELLED;
  const resultsAvailable = isClosed || election.results_visible_immediately;

  const sections: (ElectionSectionDef & { show: boolean })[] = [
    {
      id: 'ballot',
      label: 'Ballot',
      icon: ClipboardList,
      badge: election.ballot_items?.length ?? 0,
      show: canManage && !isCancelled,
    },
    {
      id: 'nominations',
      label: 'Nominations',
      icon: Megaphone,
      // Members see it while nominations are open; managers keep it in draft
      // too so they can review pending acceptances.
      show: isNominations || (canManage && isDraft),
    },
    { id: 'candidates', label: 'Candidates', icon: Users, badge: candidateCount, show: canManage },
    { id: 'eligibility', label: 'Eligibility', icon: UserCheck, show: canManage && !isCancelled },
    {
      id: 'attendance',
      label: 'Attendance',
      icon: FileText,
      // Kept after close, read-only (MeetingAttendance drops its controls when
      // closed): the check-ins decided who could vote on an item that required
      // attendance, and stay reviewable from the result (W50-79).
      show: canManage && !isCancelled,
    },
    { id: 'overrides', label: 'Overrides', icon: Shield, show: canManage && !isCancelled },
    { id: 'proxies', label: 'Proxy Voting', icon: Handshake, show: canManage && !isCancelled },
    { id: 'voting', label: 'Cast Vote', icon: Vote, show: isOpen },
    { id: 'results', label: 'Results', icon: BarChart3, show: resultsAvailable },
    { id: 'integrity', label: 'Integrity & Audit', icon: FileSearch, show: canManage && (isOpen || isClosed) },
  ];

  return sections.filter((s) => s.show).map(({ show: _show, ...def }) => def);
}
