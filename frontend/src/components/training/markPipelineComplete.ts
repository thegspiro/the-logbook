/**
 * Shared by the dialog, the screens that offer it and the no-active-requirements
 * notice that points officers at it.
 */
export const MARK_PIPELINE_COMPLETE_LABEL = 'Mark pipeline complete';

/** The statuses the endpoint accepts; anything else is already an outcome. */
export function canMarkPipelineComplete(status: string | undefined): boolean {
  return status === 'active' || status === 'on_hold';
}

/**
 * The officer's reason for a manual completion, as shown beside a completed
 * enrollment — or null when there is none to show. Officer-only: callers pass
 * whether the viewer holds training.manage, since the reason is an officer's
 * note rather than a message to the member.
 */
export function completedByHandNote(
  enrollment: { status?: string | undefined; completion_reason?: string | null | undefined } | undefined,
  canManage: boolean
): string | null {
  const reason = enrollment?.completion_reason?.trim();
  if (!canManage || enrollment?.status !== 'completed' || !reason) return null;
  return `Completed by hand: ${reason}`;
}
