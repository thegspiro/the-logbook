/**
 * Shown where a pipeline (or one phase of it) has nothing left that counts
 * toward finishing it: every required item is inactive, or none is required.
 * The backend decides this (`no_active_requirements`,
 * `phases_without_active_requirements`) and, by department rule, completes
 * nobody for finishing an empty set — so a percentage or a "0/0" here would
 * read as progress toward something that cannot happen on its own.
 */
import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { MARK_PIPELINE_COMPLETE_LABEL } from './markPipelineComplete';

export const NO_ACTIVE_REQUIREMENTS_LABEL = 'No active requirements';

interface NoActiveRequirementsNoticeProps {
  /** A whole pipeline, or one phase of it. */
  scope: 'pipeline' | 'phase';
  /** Officers are told what they can do about it; members what to expect. */
  audience: 'officer' | 'member';
}

const EXPLANATION: Record<'pipeline' | 'phase', Record<'officer' | 'member', string>> = {
  pipeline: {
    officer:
      'Nothing in this pipeline currently counts toward finishing it, so no member is completed automatically. ' +
      `Use ${MARK_PIPELINE_COMPLETE_LABEL} to complete a member by hand, or reactivate a requirement (or mark one ` +
      'required) and members who have finished it complete on their own.',
    member:
      'Nothing in this pipeline currently counts toward finishing it, so it will not complete on its own. ' +
      'A training officer will reactivate a requirement or follow up with you.',
  },
  phase: {
    officer:
      'Every required item in this phase is inactive, so the phase does not complete and members do not move on ' +
      'automatically. Advance members by hand, or reactivate a requirement.',
    member:
      'Every required item in this phase is inactive, so it does not complete on its own. ' +
      'A training officer will move you on.',
  },
};

export const NoActiveRequirementsNotice: React.FC<NoActiveRequirementsNoticeProps> = ({ scope, audience }) => (
  <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3" role="note">
    <p className="flex items-center gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-300">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {NO_ACTIVE_REQUIREMENTS_LABEL}
    </p>
    <p className="text-theme-text-secondary mt-1 text-xs">{EXPLANATION[scope][audience]}</p>
  </div>
);

export default NoActiveRequirementsNotice;
