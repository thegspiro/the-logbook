import React from 'react';
import { PUBLICATION_LEVEL_LABELS, type PublicationLevel } from '../types';

const STYLES: Record<PublicationLevel, string> = {
  draft: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-white',
  members: 'bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-white',
  public: 'bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-white',
};

export const PublicationBadge: React.FC<{ level: PublicationLevel }> = ({ level }) => (
  <span className={`badge rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[level]}`}>
    {PUBLICATION_LEVEL_LABELS[level]}
  </span>
);
