import React from 'react';
import { Check } from 'lucide-react';
import type { ChecklistRow } from './submitFormatting';

export const Checklist: React.FC<{ rows: ChecklistRow[] }> = ({ rows }) => (
  <ul className="flex flex-col gap-2">
    {rows.map((row) => (
      <li key={row.id} className="flex items-center gap-2.5">
        <span
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
            row.ok ? 'bg-theme-alert-success-bg text-theme-alert-success-icon' : 'bg-theme-surface-hover'
          }`}
          aria-hidden="true"
        >
          {row.ok && <Check className="h-3 w-3" />}
        </span>
        <span className={`text-sm ${row.ok ? 'text-theme-text-secondary' : 'text-theme-text-muted'}`}>{row.label}</span>
        <span className="sr-only">{row.ok ? 'complete' : 'not filled in'}</span>
      </li>
    ))}
  </ul>
);
