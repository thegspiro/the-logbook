/**
 * The card under an election's title: where it stands in its lifecycle, the
 * few facts that matter on every section, and — for whoever manages it — the
 * links to its sections.
 *
 * It sits above every section, so the facts are the ones an officer needs
 * whichever section is open: when voting opens or closes, the turnout, and how
 * the winner is decided (moved here from the Overview's details, so it is not
 * shown twice). The rest — start date, positions, voting method, anonymity,
 * the linked meeting and its controls — stays on the Overview.
 */

import React from 'react';
import { Clock, Trophy, Users } from 'lucide-react';
import type { Election } from '../../../types/election';
import { ElectionStatus } from '../../../constants/enums';
import { formatDateTime } from '../../../utils/dateFormatting';
import { getTimeRemaining, getVictoryDescription } from '../../../utils/electionHelpers';
import { ElectionWorkflowTabs } from './ElectionWorkflowTabs';
import type { ElectionSection } from '../electionSections';

interface ElectionHeaderCardProps {
  electionId: string;
  election: Election;
  canManage: boolean;
  activeSection: ElectionSection | null;
  candidateCount?: number | undefined;
  tz: string;
}

const LIFECYCLE_STEPS = [
  { key: 'draft', label: 'Draft', description: 'Configure ballot & candidates' },
  { key: 'nominations', label: 'Nominations', description: 'Members nominate candidates' },
  { key: 'open', label: 'Voting Open', description: 'Members can cast votes' },
  { key: 'closed', label: 'Closed', description: 'Results finalized' },
];

interface Fact {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
}

export const ElectionHeaderCard: React.FC<ElectionHeaderCardProps> = ({
  electionId,
  election,
  canManage,
  activeSection,
  candidateCount,
  tz,
}) => {
  const isNominations = election.status === ElectionStatus.NOMINATIONS;
  // Nominations is a step only for an election that is in it: one that skipped
  // it would otherwise show a step it never takes.
  const steps = LIFECYCLE_STEPS.filter((step) => step.key !== 'nominations' || isNominations);
  const order = steps.map((step) => step.key);
  const currentIdx = election.status === ElectionStatus.CANCELLED ? -1 : order.indexOf(election.status);
  const stepStatus = (key: string): 'completed' | 'current' | 'upcoming' => {
    const idx = order.indexOf(key);
    if (idx < currentIdx) return 'completed';
    if (idx === currentIdx) return 'current';
    return 'upcoming';
  };

  const facts: Fact[] = [];
  if (election.status === ElectionStatus.DRAFT || isNominations) {
    facts.push({ icon: Clock, label: 'Voting opens', value: formatDateTime(election.start_date, tz) });
  } else if (election.status === ElectionStatus.OPEN) {
    const remaining = getTimeRemaining(election.end_date);
    facts.push({
      icon: Clock,
      label: 'Voting closes',
      value: (
        <>
          {formatDateTime(election.end_date, tz)}
          <span
            className={`block text-xs font-medium ${
              remaining ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'
            }`}
          >
            {remaining ?? 'Voting period has ended'}
          </span>
        </>
      ),
    });
  } else if (election.status === ElectionStatus.CLOSED) {
    facts.push({ icon: Clock, label: 'Closed', value: formatDateTime(election.closed_at ?? election.end_date, tz) });
  }
  // Withheld (null) from a member while voting is open (W50-70), so the fact
  // goes with it rather than reading as nobody having voted.
  if (election.total_voters != null) {
    facts.push({
      icon: Users,
      label: 'Turnout',
      value:
        election.voter_turnout_percentage != null
          ? `${election.total_voters} voted · ${election.voter_turnout_percentage}%`
          : `${election.total_voters} voted`,
    });
  }
  facts.push({ icon: Trophy, label: 'Winner', value: getVictoryDescription(election) });

  return (
    <div className="card mb-6 overflow-hidden">
      {election.status !== ElectionStatus.CANCELLED && (
        <div className="p-4">
          <div className="flex items-center justify-between" role="list" aria-label="Election progress">
            {steps.map((step, idx) => {
              const status = stepStatus(step.key);
              return (
                <React.Fragment key={step.key}>
                  {idx > 0 && (
                    <div
                      aria-hidden="true"
                      className={`mx-2 h-0.5 flex-1 ${status === 'upcoming' ? 'bg-theme-surface-border' : 'bg-blue-500'}`}
                    />
                  )}
                  <div
                    role="listitem"
                    className="flex shrink-0 items-center gap-2"
                    aria-current={status === 'current' ? 'step' : undefined}
                  >
                    <div
                      aria-hidden="true"
                      className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
                        status === 'completed'
                          ? 'bg-blue-600 text-white'
                          : status === 'current'
                            ? 'bg-blue-600 text-white ring-4 ring-blue-600/20'
                            : 'bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border border'
                      }`}
                    >
                      {status === 'completed' ? (
                        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      ) : (
                        idx + 1
                      )}
                    </div>
                    {/* Hidden visually on a phone, where the circles alone fit, but
                        kept for a screen reader: without it the stepper read as
                        bare numbers with nothing saying which step is current. */}
                    <div className="sr-only sm:not-sr-only">
                      <div
                        className={`text-sm font-medium ${
                          status === 'upcoming' ? 'text-theme-text-muted' : 'text-theme-text-primary'
                        }`}
                      >
                        {step.label}
                      </div>
                      <div className="text-theme-text-muted sr-only text-xs lg:not-sr-only">{step.description}</div>
                    </div>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}

      <dl
        className={`grid grid-cols-1 gap-4 px-4 py-4 sm:grid-cols-3 ${
          election.status !== ElectionStatus.CANCELLED ? 'border-theme-surface-border border-t' : ''
        }`}
      >
        {facts.map((fact) => {
          const Icon = fact.icon;
          return (
            <div key={fact.label} className="flex min-w-0 items-start gap-2">
              <Icon className="text-theme-text-muted mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <dt className="text-theme-text-muted text-xs">{fact.label}</dt>
                <dd className="text-theme-text-primary text-sm font-medium break-words">{fact.value}</dd>
              </div>
            </div>
          );
        })}
      </dl>

      {canManage && (
        <ElectionWorkflowTabs
          electionId={electionId}
          election={election}
          canManage={canManage}
          activeSection={activeSection}
          candidateCount={candidateCount}
        />
      )}
    </div>
  );
};

export default ElectionHeaderCard;
