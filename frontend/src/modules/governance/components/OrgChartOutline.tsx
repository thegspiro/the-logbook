import React from 'react';

import { OrgChartSeatCard, type SeatCardHandlers } from './OrgChartSeatCard';
import type { OrgChartNode } from '../types/orgChart';

/** Indent per level, capped so a deep branch still fits a phone. */
const INDENT_REM = [0, 1.25, 2.5, 3.75, 5, 5, 5, 5, 5];

const indentFor = (depth: number): string => `${INDENT_REM[Math.min(depth, INDENT_REM.length - 1)] ?? 5}rem`;

interface OrgChartOutlineProps extends SeatCardHandlers {
  /** Depth-first, as the API returns it. */
  nodes: OrgChartNode[];
  canManage: boolean;
  isSaving: boolean;
  siblingIndex: Map<string, { index: number; total: number }>;
}

/**
 * The chart as an indented outline.
 *
 * What a phone gets, and what anyone can switch to on a desktop. A boxes-and-
 * connectors diagram narrowed to 390px either shrinks the names past reading
 * or scrolls in two directions at once; an outline degrades to a single
 * readable column and keeps every seat's full responsibility text visible.
 */
export const OrgChartOutline: React.FC<OrgChartOutlineProps> = ({
  nodes,
  canManage,
  isSaving,
  siblingIndex,
  onAddReport,
  onEdit,
  onDelete,
  onNudge,
}) => (
  <ul className="space-y-3">
    {nodes.map((node) => {
      const position = siblingIndex.get(node.id);
      return (
        <li key={node.id} style={{ marginInlineStart: indentFor(node.depth) }}>
          <OrgChartSeatCard
            node={node}
            canManage={canManage}
            isSaving={isSaving}
            canMoveUp={(position?.index ?? 0) > 0}
            canMoveDown={!!position && position.index < position.total - 1}
            variant="outline"
            className={node.depth > 0 ? 'border-theme-surface-border border-l-4' : ''}
            onAddReport={onAddReport}
            onEdit={onEdit}
            onDelete={onDelete}
            onNudge={onNudge}
          />
        </li>
      );
    })}
  </ul>
);

export default OrgChartOutline;
