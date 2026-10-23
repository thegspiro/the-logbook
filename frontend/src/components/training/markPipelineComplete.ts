/**
 * Shared by the dialog, the screens that offer it and the no-active-requirements
 * notice that points officers at it.
 */
export const MARK_PIPELINE_COMPLETE_LABEL = 'Mark pipeline complete';

/** The statuses the endpoint accepts; anything else is already an outcome. */
export function canMarkPipelineComplete(status: string | undefined): boolean {
  return status === 'active' || status === 'on_hold';
}
