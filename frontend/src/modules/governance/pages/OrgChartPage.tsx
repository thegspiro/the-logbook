import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  EyeOff,
  Mail,
  Network,
  Pencil,
  Phone,
  Plus,
  Search,
  Trash2,
  UserPlus,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { EmptyState } from '../../../components/ux/EmptyState';
import { SkeletonPage } from '../../../components/ux/Skeleton';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { blankToNull } from '../../../utils/formValues';
import { OrgChartNodeModal, type OrgChartNodeDraft } from '../components/OrgChartNodeModal';
import { useOrgChartStore } from '../store/orgChartStore';
import type { OrgChartNode } from '../types/orgChart';

/**
 * Governance -> Organizational Chart.
 *
 * Answers "who is in charge of this?" for the general membership. The chart is
 * curated by leadership rather than generated from positions or permissions:
 * the IT manager holds the wildcard grant and reports to the Chief in real
 * life, so a chart derived from application roles would be one nobody in the
 * department recognises.
 *
 * Rendered as an indented outline rather than the boxes-and-lines diagram an
 * org chart usually is. A department's chain of command is wide near the top,
 * and a centred diagram either scrolls sideways on a phone or shrinks the
 * names past reading — an outline degrades to a single readable column.
 */

/** Indent per level, capped so a deep branch still fits a phone. */
const INDENT_REM = [0, 1.25, 2.5, 3.75, 5, 5, 5, 5, 5];

const indentFor = (depth: number): string => `${INDENT_REM[Math.min(depth, INDENT_REM.length - 1)] ?? 5}rem`;

interface NodeRowProps {
  node: OrgChartNode;
  canManage: boolean;
  isSaving: boolean;
  /** False for the first/last of its siblings, which disables the nudge. */
  canMoveUp: boolean;
  canMoveDown: boolean;
  onAddReport: (node: OrgChartNode) => void;
  onEdit: (node: OrgChartNode) => void;
  onDelete: (node: OrgChartNode) => void;
  onNudge: (node: OrgChartNode, direction: -1 | 1) => void;
}

const NodeRow: React.FC<NodeRowProps> = ({
  node,
  canManage,
  isSaving,
  canMoveUp,
  canMoveDown,
  onAddReport,
  onEdit,
  onDelete,
  onNudge,
}) => (
  <li style={{ marginInlineStart: indentFor(node.depth) }}>
    <div
      className={`card space-y-2 p-4 ${node.depth > 0 ? 'border-theme-surface-border border-l-4' : ''} ${
        node.isPublished ? '' : 'opacity-75'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-theme-text-primary text-base font-semibold">{node.title}</h3>
            {node.isPublished ? null : (
              <span
                className="badge border-theme-surface-border text-theme-text-muted flex items-center gap-1 border"
                title="Only people who can manage the chart see this position"
              >
                <EyeOff className="h-3 w-3" aria-hidden="true" /> Hidden
              </span>
            )}
          </div>
          <p className="text-theme-text-primary mt-1 text-sm">
            {node.holderName || <span className="text-theme-text-muted italic">Vacant</span>}
          </p>
        </div>

        {canManage ? (
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              className="btn-icon"
              onClick={() => onNudge(node, -1)}
              disabled={isSaving || !canMoveUp}
              aria-label={`Move ${node.title} up`}
              title="Move up"
            >
              <ChevronUp className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="btn-icon"
              onClick={() => onNudge(node, 1)}
              disabled={isSaving || !canMoveDown}
              aria-label={`Move ${node.title} down`}
              title="Move down"
            >
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="btn-icon"
              onClick={() => onAddReport(node)}
              disabled={isSaving}
              aria-label={`Add a position reporting to ${node.title}`}
              title="Add a position reporting to this one"
            >
              <UserPlus className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="btn-icon"
              onClick={() => onEdit(node)}
              disabled={isSaving}
              aria-label={`Edit ${node.title}`}
              title="Edit"
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="btn-icon"
              onClick={() => onDelete(node)}
              disabled={isSaving}
              aria-label={`Remove ${node.title}`}
              title="Remove"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>

      {node.responsibility ? (
        <p className="text-theme-text-secondary text-sm leading-6">{node.responsibility}</p>
      ) : null}

      {node.contactEmail || node.contactPhone ? (
        // `mobile-touch-target`, not a bare inline link: a phone number on this
        // screen exists to be tapped from a phone, and a text-sm anchor is
        // about 20px tall — half the 44px minimum.
        <div className="flex flex-wrap gap-x-4 text-sm">
          {node.contactEmail ? (
            <a
              className="text-theme-accent-red mobile-touch-target justify-start gap-1.5"
              href={`mailto:${node.contactEmail}`}
            >
              <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="break-all">{node.contactEmail}</span>
            </a>
          ) : null}
          {node.contactPhone ? (
            <a
              className="text-theme-accent-red mobile-touch-target justify-start gap-1.5"
              href={`tel:${node.contactPhone}`}
            >
              <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
              {node.contactPhone}
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  </li>
);

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
      const haystack = [node.title, node.holderName ?? '', node.responsibility ?? ''].join(' ').toLowerCase();
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
    try {
      if (existing) {
        // Update: every field the form owns travels on every save, and an
        // emptied box goes as an explicit null. Omitting the key would mean
        // "leave it alone" on the backend, so a cleared holder would survive
        // behind a success toast (pitfall #1, update direction).
        await updateNode(existing.id, {
          title: draft.title,
          userId: blankToNull(draft.userId),
          displayName: blankToNull(draft.displayName),
          responsibility: blankToNull(draft.responsibility),
          contactEmail: blankToNull(draft.contactEmail),
          contactPhone: blankToNull(draft.contactPhone),
          isPublished: draft.isPublished,
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
          userId: draft.userId || undefined,
          displayName: draft.displayName || undefined,
          responsibility: draft.responsibility || undefined,
          contactEmail: draft.contactEmail || undefined,
          contactPhone: draft.contactPhone || undefined,
          isPublished: draft.isPublished,
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

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
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
      ) : (
        <ul className="space-y-3">
          {visibleNodes.map((node) => {
            const position = siblingIndex.get(node.id);
            return (
              <NodeRow
                key={node.id}
                node={node}
                canManage={canManage}
                isSaving={isSaving}
                canMoveUp={(position?.index ?? 0) > 0}
                canMoveDown={!!position && position.index < position.total - 1}
                onAddReport={(parent) => setEditor({ parentId: parent.id })}
                onEdit={(target) => setEditor({ node: target })}
                onDelete={(target) => void handleDelete(target)}
                onNudge={(target, direction) => void handleNudge(target, direction)}
              />
            );
          })}
        </ul>
      )}

      <OrgChartNodeModal
        isOpen={editor !== null}
        editingNode={editor?.node}
        defaultParentId={editor?.parentId}
        nodes={nodes}
        members={chart?.members ?? []}
        isSaving={isSaving}
        onCancel={() => setEditor(null)}
        onSave={handleSave}
      />
    </div>
  );
};

export default OrgChartPage;
