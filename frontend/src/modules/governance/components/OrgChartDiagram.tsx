import React, { useMemo } from 'react';

import { OrgChartSeatCard, type SeatCardHandlers } from './OrgChartSeatCard';
import type { OrgChartNode } from '../types/orgChart';

interface OrgChartDiagramProps extends SeatCardHandlers {
  /** Depth-first, as the API returns it. */
  nodes: OrgChartNode[];
  canManage: boolean;
  isSaving: boolean;
  /** Sibling index and count, read off the *unfiltered* chart. */
  siblingIndex: Map<string, { index: number; total: number }>;
}

interface TreeNode {
  node: OrgChartNode;
  children: TreeNode[];
}

/**
 * Rebuild the tree from the flat, depth-first list.
 *
 * A seat whose parent is not in `nodes` becomes a root here rather than being
 * dropped: that is what a filtered chart looks like mid-search, and silently
 * discarding the matches whose ancestors were filtered out would show the
 * reader an empty diagram for a search that found something.
 */
const buildForest = (nodes: OrgChartNode[]): TreeNode[] => {
  const byId = new Map<string, TreeNode>(nodes.map((node) => [node.id, { node, children: [] }]));
  const roots: TreeNode[] = [];
  for (const node of nodes) {
    const entry = byId.get(node.id);
    if (!entry) continue;
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(entry);
    else roots.push(entry);
  }
  return roots;
};

/**
 * Governance -> Organizational Chart, drawn the conventional way.
 *
 * Boxes and elbow connectors, children centred beneath their parent. The
 * connectors are CSS pseudo-elements on a nested `ul`/`li` tree (see the
 * `org-tree` utility) rather than measured lines, so the diagram survives a
 * re-render, a browser zoom and a print with nothing to recompute.
 *
 * The `org-tree-branch` / `org-tree-node` classes are what the stylesheet
 * selects on. Bare `ul`/`li` selectors would also catch the list of names
 * *inside* a box and draw connectors between a seat's co-chairs.
 *
 * Wide charts scroll horizontally inside this component rather than pushing
 * the page sideways — the page body must never scroll horizontally.
 */
export const OrgChartDiagram: React.FC<OrgChartDiagramProps> = ({
  nodes,
  canManage,
  isSaving,
  siblingIndex,
  onAddReport,
  onEdit,
  onDelete,
  onNudge,
}) => {
  const forest = useMemo(() => buildForest(nodes), [nodes]);

  const renderNode = (entry: TreeNode): React.ReactElement => {
    const position = siblingIndex.get(entry.node.id);
    return (
      <li key={entry.node.id} className="org-tree-node">
        <OrgChartSeatCard
          node={entry.node}
          canManage={canManage}
          isSaving={isSaving}
          canMoveUp={(position?.index ?? 0) > 0}
          canMoveDown={!!position && position.index < position.total - 1}
          variant="diagram"
          onAddReport={onAddReport}
          onEdit={onEdit}
          onDelete={onDelete}
          onNudge={onNudge}
        />
        {entry.children.length ? <ul className="org-tree-branch">{entry.children.map(renderNode)}</ul> : null}
      </li>
    );
  };

  return (
    // A named region rather than a bare scroller: a screen-reader user
    // arriving here needs to know the nested lists that follow *are* the chart,
    // and the landmark is what lets them jump straight to it.
    <div className="overflow-x-auto pb-4" role="region" aria-label="Organizational chart diagram" tabIndex={0}>
      {/* `w-max` so the tree keeps its natural width inside the scroller
          instead of being squeezed to the container and wrapping the boxes. */}
      <ul className="org-tree w-max min-w-full">{forest.map(renderNode)}</ul>
    </div>
  );
};

export default OrgChartDiagram;
