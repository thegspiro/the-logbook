import React, { useEffect, useMemo, useState } from 'react';
import { LayoutGrid, List, Network, Plus, Search } from 'lucide-react';
import toast from 'react-hot-toast';

import { EmptyState } from '../../../components/ux/EmptyState';
import { SkeletonPage } from '../../../components/ux/Skeleton';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import { OrgChartDiagram } from '../components/OrgChartDiagram';
import { OrgChartNodeModal, type OrgChartNodeDraft } from '../components/OrgChartNodeModal';
import { OrgChartOutline } from '../components/OrgChartOutline';
import { useOrgChartStore } from '../store/orgChartStore';
import { parseLinkValue, type OrgChartNode } from '../types/orgChart';

/**
 * Governance -> Organizational Chart.
 *
 * Answers "who is in charge of this?" for the general membership. The *shape*
 * of the chart is curated by leadership rather than generated from positions or
 * permissions: the IT manager holds the wildcard grant and reports to the Chief
 * in real life, so a chart whose reporting lines came from application roles
 * would be one nobody in the department recognises. A seat may be *linked* to a
 * role, which keeps the names in the box current without deciding anything else
 * about it — the application supports the chart, it does not define it.
 *
 * Two layouts, because one does not serve both readers. The diagram is the
 * conventional boxes-and-connectors chart and is what a desktop opens on. A
 * phone opens on the indented outline: a centred diagram narrowed to 390px
 * either shrinks the names past reading or scrolls in two directions at once.
 * Either can be chosen explicitly, and the choice sticks for the session.
 */

const ViewMode = {
  DIAGRAM: 'diagram',
  OUTLINE: 'outline',
} as const;
type ViewMode = (typeof ViewMode)[keyof typeof ViewMode];

interface EditorTarget {
  node?: OrgChartNode | undefined;
  /** Pre-selected parent when opened from a seat's "add report" button. */
  parentId?: string | undefined;
}

const OrgChartPage: React.FC = () => {
  const { confirm } = useConfirm();
  const { chart, isLoading, isSaving, error, fetchChart, createNode, updateNode, moveNode, deleteNode } =
    useOrgChartStore();
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  // Null until the reader picks one, so the breakpoint keeps deciding while
  // they have not — a phone rotated to landscape gets the diagram, and a
  // deliberate choice is never overridden by a resize.
  const [chosenView, setChosenView] = useState<ViewMode | null>(null);
  const isWide = useMediaQuery('(min-width: 768px)');
  const view = chosenView ?? (isWide ? ViewMode.DIAGRAM : ViewMode.OUTLINE);

  useEffect(() => {
    void fetchChart();
  }, [fetchChart]);

  const nodes = useMemo(() => chart?.nodes ?? [], [chart]);
  const canManage = chart?.canManage ?? false;

  /**
   * Filtered view.
   *
   * A match drags its ancestors in with it — a bare list of matches would show
   * "Training Officer" with no indication of who that reports to, which is
   * half of what somebody searching a chain of command came for.
   */
  const visibleNodes = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return nodes;

    const byId = new Map(nodes.map((node) => [node.id, node]));
    const keep = new Set<string>();
    for (const node of nodes) {
      const haystack = [
        node.title,
        node.responsibility ?? '',
        node.linkLabel ?? '',
        ...node.holders.map((holder) => holder.name),
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(term)) continue;
      let current: OrgChartNode | undefined = node;
      // Bounded by the tree's depth; the server caps nesting, and `keep`
      // stops the walk the moment it reaches an already-kept ancestor.
      while (current && !keep.has(current.id)) {
        keep.add(current.id);
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
    }
    return nodes.filter((node) => keep.has(node.id));
  }, [nodes, search]);

  /** Sibling index and count, read off the unfiltered chart. */
  const siblingIndex = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const node of nodes) {
      const key = node.parentId ?? '';
      const group = groups.get(key) ?? [];
      group.push(node.id);
      groups.set(key, group);
    }
    const positions = new Map<string, { index: number; total: number }>();
    for (const group of groups.values()) {
      group.forEach((id, index) => positions.set(id, { index, total: group.length }));
    }
    return positions;
  }, [nodes]);

  const handleSave = async (draft: OrgChartNodeDraft) => {
    const existing = editor?.node;
    const link = parseLinkValue(draft.linkValue);
    const holders = draft.holders.map((holder) => ({
      userId: holder.userId || undefined,
      displayName: holder.displayName || undefined,
    }));
    try {
      if (existing) {
        // Update: every field the form owns travels on every save, and an
        // emptied box goes as an explicit null. Omitting the key would mean
        // "leave it alone" on the backend, so a cleared value would survive
        // behind a success toast (pitfall #1, update direction). `holders` is
        // the exception the backend documents: it is a whole-collection
        // replace, so an empty array is how a seat is emptied.
        await updateNode(existing.id, {
          title: draft.title,
          responsibility: draft.responsibility || null,
          contactEmail: draft.contactEmail || null,
          contactPhone: draft.contactPhone || null,
          isPublished: draft.isPublished,
          // Both link fields on every save, so unlinking travels as an
          // explicit null rather than as an omitted key the backend would
          // read as "leave it alone".
          positionId: link.positionId ?? null,
          rankCode: link.rankCode ?? null,
          holders,
        });
        // A changed reporting line is a second call: /move renumbers the
        // siblings the seat lands among, which a field update has no business
        // doing. Second, not first, so a rejected move still leaves the
        // edits saved rather than discarding both.
        if (draft.parentId !== (existing.parentId ?? '')) {
          await moveNode(existing.id, {
            parentId: draft.parentId || null,
            position: nodes.filter((n) => (n.parentId ?? '') === draft.parentId && n.id !== existing.id).length,
          });
        }
        toast.success('Position updated');
      } else {
        // Create: blanks are omitted so an empty string never reaches a
        // validator that would reject it.
        await createNode({
          title: draft.title,
          parentId: draft.parentId || undefined,
          responsibility: draft.responsibility || undefined,
          contactEmail: draft.contactEmail || undefined,
          contactPhone: draft.contactPhone || undefined,
          isPublished: draft.isPublished,
          positionId: link.positionId,
          rankCode: link.rankCode,
          holders,
        });
        toast.success('Position added');
      }
      setEditor(null);
    } catch {
      // The store already surfaced the message; keep the editor open so the
      // typed values are not thrown away.
    }
  };

  const handleDelete = async (node: OrgChartNode) => {
    const reports = nodes.filter((n) => n.parentId === node.id);
    const confirmed = await confirm({
      title: `Remove ${node.title}?`,
      message: reports.length
        ? `${reports.length} position${reports.length === 1 ? '' : 's'} reporting to ${node.title} will move up to report to whoever ${node.title} reports to. This cannot be undone.`
        : 'This position is removed from the chart for everyone. This cannot be undone.',
      confirmLabel: 'Remove it',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await deleteNode(node.id);
      toast.success(`${node.title} removed`);
    } catch {
      // Surfaced by the store.
    }
  };

  const handleNudge = async (node: OrgChartNode, direction: -1 | 1) => {
    const position = siblingIndex.get(node.id);
    if (!position) return;
    try {
      await moveNode(node.id, {
        parentId: node.parentId ?? null,
        position: Math.max(0, position.index + direction),
      });
    } catch {
      // Surfaced by the store.
    }
  };

  if (isLoading && !chart) return <SkeletonPage />;

  const viewProps = {
    nodes: visibleNodes,
    canManage,
    isSaving,
    siblingIndex,
    onAddReport: (parent: OrgChartNode) => setEditor({ parentId: parent.id }),
    onEdit: (target: OrgChartNode) => setEditor({ node: target }),
    onDelete: (target: OrgChartNode) => void handleDelete(target),
    onNudge: (target: OrgChartNode, direction: -1 | 1) => void handleNudge(target, direction),
  };

  return (
    // Wider than the old max-w-4xl: a chain of command is wide before it is
    // deep, and the diagram spends the extra width on boxes rather than margin.
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <header className="space-y-2">
        <h1 className="text-theme-text-primary flex items-center gap-2 text-2xl font-bold">
          <Network className="h-6 w-6" aria-hidden="true" /> Organizational Chart
        </h1>
        <p className="text-theme-text-secondary text-sm leading-6">
          Who is in charge of what, and who they report to. This is the department&rsquo;s real chain of command,
          maintained by leadership — it is not a picture of anyone&rsquo;s access or permissions in this application.
        </p>
      </header>

      {error ? (
        <p className="alert-error text-sm" role="alert">
          {error}
        </p>
      ) : null}

      {nodes.length ? (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-1">
            <Search
              className="text-theme-text-muted pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              className="form-input pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by position, name, or area"
              aria-label="Search the organizational chart"
            />
          </div>

          <div className="segmented-group flex gap-1" role="group" aria-label="Chart layout">
            <button
              type="button"
              className={`btn-icon px-3 ${
                view === ViewMode.DIAGRAM
                  ? 'bg-red-800 text-white'
                  : 'text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-surface-hover'
              }`}
              onClick={() => setChosenView(ViewMode.DIAGRAM)}
              aria-pressed={view === ViewMode.DIAGRAM}
              aria-label="Show the chart as a diagram"
              title="Diagram"
            >
              <LayoutGrid className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`btn-icon px-3 ${
                view === ViewMode.OUTLINE
                  ? 'bg-red-800 text-white'
                  : 'text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-surface-hover'
              }`}
              onClick={() => setChosenView(ViewMode.OUTLINE)}
              aria-pressed={view === ViewMode.OUTLINE}
              aria-label="Show the chart as a list"
              title="List"
            >
              <List className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {canManage ? (
            <button type="button" className="btn-primary flex items-center gap-2" onClick={() => setEditor({})}>
              <Plus className="h-4 w-4" aria-hidden="true" /> Add position
            </button>
          ) : null}
        </div>
      ) : null}

      {nodes.length === 0 ? (
        <EmptyState
          icon={Network}
          title="No organizational chart yet"
          description={
            canManage
              ? 'Add the top of the chain of command first — the Chief, or the President — then add the positions that report to each one.'
              : 'Your department has not published its organizational chart yet. Ask an officer to set one up.'
          }
          {...(canManage
            ? { actions: [{ label: 'Add the first position', onClick: () => setEditor({}), icon: Plus }] }
            : {})}
        />
      ) : visibleNodes.length === 0 ? (
        <EmptyState
          icon={Search}
          title="Nothing matches that search"
          description="Try a position title, a member's name, or a word from the area they cover."
        />
      ) : view === ViewMode.DIAGRAM ? (
        <OrgChartDiagram {...viewProps} />
      ) : (
        <OrgChartOutline {...viewProps} />
      )}

      <OrgChartNodeModal
        isOpen={editor !== null}
        editingNode={editor?.node}
        defaultParentId={editor?.parentId}
        nodes={nodes}
        members={chart?.members ?? []}
        roles={chart?.roles ?? []}
        ranks={chart?.ranks ?? []}
        isSaving={isSaving}
        onCancel={() => setEditor(null)}
        onSave={handleSave}
      />
    </div>
  );
};

export default OrgChartPage;
