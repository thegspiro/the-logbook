import { FileRemovalReason } from '../types/training';
import { formatDate } from './dateFormatting';

/**
 * The sentence shown where a certificate file used to be (owner decision
 * 2026-11-23). The backend keeps a marker in the attachment list when the
 * department's retention policy or the malware scan deletes a stored file, so
 * the member and the officers see why it is gone instead of a broken link.
 * The date is shown in the department's timezone.
 */
export function fileRemovalText(
  removedAt: string | null | undefined,
  reason: FileRemovalReason | null | undefined,
  tz: string | undefined
): string {
  const on = removedAt ? ` on ${formatDate(removedAt, tz)}` : '';
  if (reason === FileRemovalReason.MALWARE) {
    return `Certificate file removed by the malware scan${on}: it was found to be infected.`;
  }
  return `Certificate file removed under the department's retention policy${on}.`;
}
