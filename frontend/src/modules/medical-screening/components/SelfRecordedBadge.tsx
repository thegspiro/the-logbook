/**
 * Marks a screening whose status was last set by the member it is about.
 *
 * MS-7: a screening manager may record their own result — in a small
 * department they are often the only one who can — so the result still counts
 * toward compliance. It is shown rather than refused, so that a self-cleared
 * physical or drug screen is visible wherever compliance is read instead of
 * only in the audit log.
 */

import React from 'react';
import { UserCheck } from 'lucide-react';

export const SELF_RECORDED_EXPLANATION =
  'Recorded by the member it is about. It still counts toward compliance; nobody else has saved its result.';

export const SelfRecordedBadge: React.FC = () => (
  <span
    className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
    title={SELF_RECORDED_EXPLANATION}
  >
    <UserCheck className="h-3 w-3" aria-hidden="true" />
    Self-recorded
    <span className="sr-only">: {SELF_RECORDED_EXPLANATION}</span>
  </span>
);
