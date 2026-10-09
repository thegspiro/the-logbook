/**
 * Marks a name, unit or seat settled by a decision the department committed
 * with an earlier import, so the reviewer can tell it apart from one matched
 * automatically and still change it for this file.
 */

import React from 'react';
import { History } from 'lucide-react';

const RememberedBadge: React.FC = () => (
  <span
    className="badge border border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-400"
    title="Decided in an earlier import. Choose again to change it for this file."
  >
    <History className="mr-1 h-3 w-3" aria-hidden="true" />
    Remembered
  </span>
);

export default RememberedBadge;
