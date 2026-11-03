/**
 * Catalog Links — every unlinked checklist position in the department,
 * grouped by name across templates.
 *
 * The per-template match tool asks "which catalog item is 4x4 gauze" once per
 * rig. Here the answer is given once and lands on every position carrying the
 * line, active and draft templates alike.
 *
 * Names with a likely catalog match come first. The rest sit in a collapsed
 * section: they are usually tasks ("Check tire pressure") rather than stock,
 * but `function` — the type a task carries — is also the default for a
 * free-typed supply line, so the type alone cannot hide them.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ChevronDown, ChevronRight, Link2, Loader2, RefreshCw, Undo2, Wand2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { Breadcrumbs, EmptyState, SkeletonPage } from '../../../components/ux';
import { getErrorMessage } from '../../../utils/errorHandling';
import { useConfirm } from '../../../contexts/ConfirmContext';
import InventoryItemPicker from '../components/InventoryItemPicker';
import { useChecklistCatalogAccess } from '../hooks/useChecklistCatalogAccess';
import { equipmentCheckService } from '../services/equipmentCheckApi';
import type { AutoLinkedGroup, LinkReportGroup, LinkReportResult, SkippedLinkPosition } from '../types/equipmentCheck';

/** Matches the backend's per-request cap on CrossTemplateLinkRequest. */
const LINK_BATCH_SIZE = 2000;

/** Sentinel select value that reveals the catalog search for a group. */
const SEARCH_OPTION = '__search__';

const CONFIDENCE_LABEL: Record<string, string> = {
  exact: 'exact match',
  strong: 'likely',
  weak: 'possible',
};

/** Exact matches only. A "likely" one is exactly the call a person makes. */
function initialChoices(report: LinkReportResult): Record<string, string> {
  const choices: Record<string, string> = {};
  for (const group of report.groups) {
    const top = group.suggestions[0];
    if (top && top.confidence === 'exact') choices[group.key] = top.id;
  }
  return choices;
}

interface GroupRowProps {
  group: LinkReportGroup;
  choice: string;
  searching: boolean;
  expanded: boolean;
  onChoose: (inventoryItemId: string) => void;
  onSearch: () => void;
  onToggle: () => void;
  access: ReturnType<typeof useChecklistCatalogAccess>;
}

interface SkippedPanelProps {
  positions: SkippedLinkPosition[];
  onDismiss: () => void;
}

/**
 * Positions left alone because somebody linked them in the builder after the
 * report loaded. Their link stands — overwriting a colleague's newer choice is
 * the thing this screen must not do — so each is listed with both items and a
 * way into its template, where the officer can change it deliberately.
 */
interface AutoLinkedPanelProps {
  groups: AutoLinkedGroup[];
  undoing: string | null;
  onUndo: (group: AutoLinkedGroup) => void;
  onDismiss: () => void;
}

/** One key per linked name; a name can only be linked to one item per pass. */
const autoLinkedKey = (g: AutoLinkedGroup) => `${g.name}\u0000${g.inventoryItemId}`;

/** Each template a group was linked on, once, in the order the report gave. */
function linkedTemplates(group: AutoLinkedGroup): Array<{ id: string; name: string }> {
  const seen = new Map<string, string>();
  for (const p of group.positions) if (!seen.has(p.templateId)) seen.set(p.templateId, p.templateName);
  return [...seen].map(([id, name]) => ({ id, name }));
}

/**
 * What the automatic pass linked. Strong matches are flagged: they are the
 * ones that can be wrong, and the reloaded report no longer lists them, so
 * this is the one place to check them before the next check runs. Each name
 * links to the templates it landed on and can be undone on its own, which
 * puts its positions back on the report.
 */
const AutoLinkedPanel: React.FC<AutoLinkedPanelProps> = ({ groups, undoing, onUndo, onDismiss }) => (
  <section aria-labelledby="auto-linked" className="alert-info space-y-2">
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 id="auto-linked" className="font-semibold">
          Linked {groups.length} name{groups.length !== 1 ? 's' : ''} automatically
        </h2>
        <p className="text-sm">
          Matches marked “check this” were close rather than identical. If one is wrong, undo it to choose again here,
          or open the template and change its catalog item.
        </p>
      </div>
      <button type="button" onClick={onDismiss} className="btn-icon shrink-0" aria-label="Dismiss linked names">
        <X className="h-4 w-4" />
      </button>
    </div>
    <ul className="space-y-2 text-sm">
      {groups.map((g) => {
        const key = autoLinkedKey(g);
        return (
          <li key={key} className="space-y-1 border-t border-current/20 pt-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="min-w-0 break-words">
                <span className="font-medium">{g.name}</span> → {g.inventoryItemName}
                {g.matchedAlias ? ` (as “${g.matchedAlias}”)` : ''} · {g.positionCount} position
                {g.positionCount !== 1 ? 's' : ''}
                {g.confidence === 'strong' && <span className="ml-1 font-semibold">· check this</span>}
              </p>
              <button
                type="button"
                onClick={() => onUndo(g)}
                disabled={undoing !== null}
                className="btn-secondary inline-flex shrink-0 items-center gap-1 text-xs"
                aria-label={`Undo linking ${g.name}`}
              >
                {undoing === key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
                Undo
              </button>
            </div>
            <p className="flex flex-wrap gap-x-3 gap-y-1">
              {linkedTemplates(g).map((t) => (
                <Link
                  key={t.id}
                  to={`/inventory/admin/checklists/templates/${t.id}`}
                  className="touch:min-h-11 inline-flex items-center underline"
                >
                  Open {t.name}
                </Link>
              ))}
            </p>
          </li>
        );
      })}
    </ul>
  </section>
);

const SkippedPanel: React.FC<SkippedPanelProps> = ({ positions, onDismiss }) => (
  <section aria-labelledby="skipped-links" className="alert-warning space-y-2">
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 id="skipped-links" className="font-semibold">
          {positions.length} position{positions.length !== 1 ? 's were' : ' was'} left as{' '}
          {positions.length !== 1 ? 'they were' : 'it was'}
        </h2>
        <p className="text-sm">
          Someone linked {positions.length !== 1 ? 'these' : 'this'} in the template builder after this page loaded, so
          your choice was not applied. Open the template to change it.
        </p>
      </div>
      <button type="button" onClick={onDismiss} className="btn-icon shrink-0" aria-label="Dismiss skipped positions">
        <X className="h-4 w-4" />
      </button>
    </div>
    <ul className="space-y-2 text-sm">
      {positions.map((p) => (
        <li key={p.templateItemId} className="border-t border-current/20 pt-2">
          <p className="font-medium break-words">
            {p.itemName}
            <span className="font-normal">
              {' '}
              · {p.templateName}
              {p.compartmentName ? ` · ${p.compartmentName}` : ''}
            </span>
          </p>
          <p className="break-words">
            Linked to {p.currentInventoryItemName ?? 'an item outside your inventory'}; you chose{' '}
            {p.chosenInventoryItemName ?? 'an item no longer in your inventory'}.
          </p>
          <Link
            to={`/inventory/admin/checklists/templates/${p.templateId}`}
            className="touch:min-h-11 inline-flex items-center font-medium underline"
          >
            Open {p.templateName}
          </Link>
        </li>
      ))}
    </ul>
  </section>
);

const GroupRow: React.FC<GroupRowProps> = ({
  group,
  choice,
  searching,
  expanded,
  onChoose,
  onSearch,
  onToggle,
  access,
}) => {
  const suggestionIds = new Set(group.suggestions.map((s) => s.id));
  // A choice made through the search is not among the suggestions; show it
  // through the picker, which resolves its name.
  const pickedOutsideSuggestions = Boolean(choice) && !suggestionIds.has(choice);
  const selectValue = searching || pickedOutsideSuggestions ? SEARCH_OPTION : choice;

  return (
    <li className="card space-y-3 p-4">
      <div className="split-row gap-3 sm:items-start">
        <div className="split-row-main">
          <p className="text-theme-text-primary font-medium break-words">{group.name}</p>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className="text-theme-text-muted hover:text-theme-text-primary touch:min-h-11 mt-1 flex items-center gap-1 text-xs"
          >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {group.positionCount} position{group.positionCount !== 1 ? 's' : ''} on {group.templateCount} template
            {group.templateCount !== 1 ? 's' : ''}
          </button>
        </div>

        <div className="split-row-aside w-full sm:w-80">
          <select
            className="form-input"
            aria-label={`Catalog item for ${group.name}`}
            value={selectValue}
            onChange={(e) => {
              if (e.target.value === SEARCH_OPTION) onSearch();
              else onChoose(e.target.value);
            }}
          >
            <option value="">Don&rsquo;t link</option>
            {group.suggestions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.matchedAlias ? ` · also called “${s.matchedAlias}”` : ''} (
                {CONFIDENCE_LABEL[s.confidence] ?? s.confidence})
              </option>
            ))}
            <option value={SEARCH_OPTION}>Search the catalog…</option>
          </select>
          {selectValue === SEARCH_OPTION && (
            <div className="mt-2">
              <InventoryItemPicker
                value={pickedOutsideSuggestions ? choice : undefined}
                onChange={(id) => onChoose(id ?? '')}
                searchScope={access.searchScope}
                canCreateInventory={access.canCreateGear}
                canCreateMedical={access.canCreateMedical}
                placeholder="Search gear and medical supplies…"
              />
            </div>
          )}
        </div>
      </div>

      {expanded && (
        <ul className="border-theme-surface-border space-y-1 border-t pt-2 text-xs">
          {group.positions.map((p) => (
            <li key={p.templateItemId} className="text-theme-text-secondary flex flex-wrap items-center gap-2">
              <span>{p.templateName}</span>
              {p.compartmentName && <span className="text-theme-text-muted">· {p.compartmentName}</span>}
              {!p.templateActive && (
                <span className="badge bg-amber-500/10 text-[10px] text-amber-800 dark:text-amber-300">Draft</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
};

const CatalogLinkReportPage: React.FC = () => {
  const access = useChecklistCatalogAccess();
  const { confirm } = useConfirm();
  const [autoLinked, setAutoLinked] = useState<AutoLinkedGroup[]>([]);
  const [undoing, setUndoing] = useState<string | null>(null);
  const [report, setReport] = useState<LinkReportResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [searching, setSearching] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showUnmatched, setShowUnmatched] = useState(false);
  const [saving, setSaving] = useState(false);
  // Kept across the reload that follows a link pass: the reloaded report no
  // longer lists these positions, since they are linked, so this is the only
  // place they can still be seen.
  const [skippedPositions, setSkippedPositions] = useState<SkippedLinkPosition[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await equipmentCheckService.getLinkReport();
      setReport(result);
      setChoices(initialChoices(result));
      setSearching(new Set());
    } catch (err: unknown) {
      setLoadError(getErrorMessage(err, 'Failed to load the catalog link report'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const matched = useMemo(() => report?.groups.filter((g) => g.suggestions.length > 0) ?? [], [report]);
  const unmatched = useMemo(() => report?.groups.filter((g) => g.suggestions.length === 0) ?? [], [report]);

  const chosenGroups = useMemo(() => report?.groups.filter((g) => Boolean(choices[g.key])) ?? [], [report, choices]);
  const chosenPositions = chosenGroups.reduce((sum, g) => sum + g.positionCount, 0);

  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  const apply = async () => {
    if (chosenPositions === 0 || saving) return;
    const entries: Array<[string, string]> = chosenGroups.flatMap((g) =>
      g.positions.map((p): [string, string] => [p.templateItemId, choices[g.key] ?? ''])
    );
    setSaving(true);
    setSkippedPositions([]);
    let linked = 0;
    const skipped: SkippedLinkPosition[] = [];
    try {
      // Each batch is all-or-nothing on the server; a department large enough
      // to need more than one is told how far it got if a later one fails.
      for (let i = 0; i < entries.length; i += LINK_BATCH_SIZE) {
        const batch = Object.fromEntries(entries.slice(i, i + LINK_BATCH_SIZE));
        const result = await equipmentCheckService.linkAcrossTemplates(batch);
        linked += result.linked;
        skipped.push(...result.skippedPositions);
      }
      toast.success(
        skipped.length > 0
          ? `Linked ${linked} position${linked !== 1 ? 's' : ''}; ${skipped.length} had been linked by someone else — see the list above`
          : `Linked ${linked} position${linked !== 1 ? 's' : ''}`
      );
    } catch (err: unknown) {
      const prefix = linked > 0 ? `Linked ${linked} before stopping. ` : '';
      toast.error(prefix + getErrorMessage(err, 'Failed to link positions'));
    } finally {
      // Set even after a failed batch: the earlier batches committed, and
      // their skipped positions are as real as on a clean run.
      setSkippedPositions(skipped);
      setSaving(false);
      await load();
    }
  };

  const autoLink = async () => {
    if (saving) return;
    const confirmed = await confirm({
      title: 'Link matches automatically',
      message:
        'Every checklist line whose name matches one catalog item exactly or closely is linked on every template. ' +
        'Lines that match two items equally, match loosely or match nothing stay here for you to choose.',
      confirmLabel: 'Link matches',
      // Not destructive: the default danger style puts a red trash can on a
      // dialog that only adds links.
      variant: 'info',
    });
    if (!confirmed) return;
    setSaving(true);
    setSkippedPositions([]);
    setAutoLinked([]);
    try {
      const result = await equipmentCheckService.autoLinkAcrossTemplates();
      setAutoLinked(result.groups);
      setSkippedPositions(result.skippedPositions);
      if (result.linked === 0 && result.skipped === 0) {
        toast.success('No lines had a clear enough match to link automatically');
      } else {
        toast.success(
          `Linked ${result.linked} position${result.linked !== 1 ? 's' : ''}` +
            (result.leftForReview > 0 ? `; ${result.leftForReview} left for you to review` : '')
        );
      }
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to link positions'));
    } finally {
      setSaving(false);
      await load();
    }
  };

  const undoAutoLink = async (group: AutoLinkedGroup) => {
    if (undoing !== null || saving) return;
    const key = autoLinkedKey(group);
    setUndoing(key);
    try {
      const result = await equipmentCheckService.unlinkAcrossTemplates(
        Object.fromEntries(group.positions.map((p) => [p.templateItemId, group.inventoryItemId]))
      );
      setAutoLinked((prev) => prev.filter((g) => autoLinkedKey(g) !== key));
      toast.success(
        `Unlinked ${result.unlinked} position${result.unlinked !== 1 ? 's' : ''} of ${group.name}` +
          (result.skipped > 0
            ? `; ${result.skipped} had been changed in the template since and ${result.skipped !== 1 ? 'were' : 'was'} left as ${result.skipped !== 1 ? 'they were' : 'it was'}`
            : '')
      );
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to undo the link'));
    } finally {
      setUndoing(null);
    }
  };

  const renderGroups = (groups: LinkReportGroup[]) => (
    <ul className="space-y-3">
      {groups.map((group) => (
        <GroupRow
          key={group.key}
          group={group}
          choice={choices[group.key] ?? ''}
          searching={searching.has(group.key)}
          expanded={expanded.has(group.key)}
          access={access}
          onChoose={(id) => {
            setChoices((prev) => ({ ...prev, [group.key]: id }));
            if (group.suggestions.some((s) => s.id === id) || !id) {
              setSearching((prev) => {
                const next = new Set(prev);
                next.delete(group.key);
                return next;
              });
            }
          }}
          onSearch={() => setSearching((prev) => new Set(prev).add(group.key))}
          onToggle={() => setExpanded((prev) => toggle(prev, group.key))}
        />
      ))}
    </ul>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 pb-28 sm:px-6 sm:py-8">
      <Breadcrumbs className="mb-0" />

      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-theme-text-primary text-2xl font-bold">Catalog Links</h1>
          <p className="text-theme-text-muted mt-0.5 text-sm">
            Checklist lines not yet connected to inventory or Medical Supplies, grouped by name across every template.
            Choose the catalog item once and it links everywhere the line appears.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 self-start">
          {matched.length > 0 && (
            <button
              type="button"
              onClick={() => void autoLink()}
              disabled={loading || saving}
              className="btn-secondary flex items-center gap-1 text-sm whitespace-nowrap"
            >
              <Wand2 className="h-4 w-4" /> Link matches automatically
            </button>
          )}
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || saving}
            className="btn-secondary flex items-center gap-1 text-sm"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
      </div>

      {autoLinked.length > 0 && (
        <AutoLinkedPanel
          groups={autoLinked}
          undoing={undoing}
          onUndo={(g) => void undoAutoLink(g)}
          onDismiss={() => setAutoLinked([])}
        />
      )}

      {skippedPositions.length > 0 && (
        <SkippedPanel positions={skippedPositions} onDismiss={() => setSkippedPositions([])} />
      )}

      {loading && !report && <SkeletonPage />}

      {loadError && (
        <div role="alert" className="alert-danger">
          {loadError}
        </div>
      )}

      {report && (
        <>
          <p role="status" className="text-theme-text-secondary flex items-center gap-2 text-sm">
            <Link2 className="h-4 w-4 shrink-0" />
            {report.coverage.linked} of {report.coverage.linkable} checklist positions linked
            {report.coverage.unlinked > 0 &&
              ` — ${report.coverage.unlinked} unlinked on ${report.templateCount} template${report.templateCount !== 1 ? 's' : ''}`}
          </p>

          {report.groups.length === 0 ? (
            <EmptyState
              icon={Link2}
              title="Every checklist line is linked"
              description="Expiration, lot and restock tracking can see every position on every template."
            />
          ) : (
            <>
              {matched.length > 0 && (
                <section aria-labelledby="likely-matches" className="space-y-3">
                  <h2 id="likely-matches" className="text-theme-text-primary text-lg font-semibold">
                    Likely matches ({matched.length})
                  </h2>
                  <p className="text-theme-text-muted text-xs">
                    Exact name matches are pre-selected. Check the rest before linking.
                  </p>
                  {renderGroups(matched)}
                </section>
              )}

              {unmatched.length > 0 && (
                <section aria-labelledby="no-match" className="space-y-3">
                  <h2 id="no-match">
                    <button
                      type="button"
                      onClick={() => setShowUnmatched((v) => !v)}
                      aria-expanded={showUnmatched}
                      className="text-theme-text-primary touch:min-h-11 flex items-center gap-1 text-lg font-semibold"
                    >
                      {showUnmatched ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      No catalog match ({unmatched.length})
                    </button>
                  </h2>
                  {showUnmatched && (
                    <>
                      <p className="text-theme-text-muted text-xs">
                        Usually checks rather than stock. Search the catalog for any that are supplies.
                      </p>
                      {renderGroups(unmatched)}
                    </>
                  )}
                </section>
              )}
            </>
          )}
        </>
      )}

      {report && report.groups.length > 0 && (
        <div className="border-theme-surface-border surface-opaque action-bar-safe fixed right-0 bottom-0 left-[var(--side-nav-width,0px)] z-30 border-t px-4">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <span className="text-theme-text-secondary text-sm">
              {chosenGroups.length} name{chosenGroups.length !== 1 ? 's' : ''} selected · {chosenPositions} position
              {chosenPositions !== 1 ? 's' : ''}
            </span>
            <button
              type="button"
              onClick={() => void apply()}
              disabled={chosenPositions === 0 || saving}
              className="btn-primary flex items-center gap-1"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Link {chosenPositions} position{chosenPositions !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CatalogLinkReportPage;
