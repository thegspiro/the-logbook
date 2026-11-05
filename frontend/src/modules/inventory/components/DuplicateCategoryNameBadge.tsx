/**
 * Marks a category whose name an active sibling also uses.
 *
 * New duplicates are refused by the API (owner decision 2026-11-01), so only
 * ones stored before that rule can carry the flag. They were kept rather than
 * rewritten, and this badge is how an officer finds them to rename one.
 */

import React from 'react';
import { AlertTriangle } from 'lucide-react';

export const DuplicateCategoryNameBadge: React.FC = () => (
  <span className="badge gap-1 border border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300">
    <AlertTriangle className="h-3 w-3" aria-hidden="true" />
    Duplicate name
    <span className="sr-only">: another category at this level has the same name. Rename one.</span>
  </span>
);
