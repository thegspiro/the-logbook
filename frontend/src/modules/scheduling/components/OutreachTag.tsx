/**
 * Marks a community outreach signup sheet wherever the schedule lists one.
 *
 * A station tour or a school visit is staffed from the schedule but is not
 * duty coverage (owner decision, 2026-11-24), so it carries this tag beside
 * the event's name instead of being presented as a duty crew.
 */

import React from 'react';
import { OUTREACH_TAG } from '../utils/shiftBoard';

const OutreachTag: React.FC<{ className?: string }> = ({ className = '' }) => (
  <span className={`badge border border-sky-500/20 bg-sky-500/10 text-sky-800 dark:text-sky-300 ${className}`}>
    {OUTREACH_TAG}
  </span>
);

export default OutreachTag;
