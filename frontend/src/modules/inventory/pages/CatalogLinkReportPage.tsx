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
import { ChevronDown, ChevronRight, Link2, Loader2, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { Breadcrumbs, EmptyState, SkeletonPage } from '../../../components/ux';
import { getErrorMessage } from '../../../utils/errorHandling';
import InventoryItemPicker from '../components/InventoryItemPicker';
import { useChecklistCatalogAccess } from '../hooks/useChecklistCatalogAccess';
import { equipmentCheckService } from '../services/equipmentCheckApi';
import type { LinkReportGroup, LinkReportResult } from '../types/equipmentCheck';

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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
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

        <div className="w-full sm:w-80">
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
                {s.name} ({CONFIDENCE_LABEL[s.confidence] ?? s.confidence})
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
  const [report, setReport] = useState<LinkReportResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [searching, setSearching] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showUnmatched, setShowUnmatched] = useState(false);
  const [saving, setSaving] = useState(false);

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
    let linked = 0;
    let skipped = 0;
    try {
      // Each batch is all-or-nothing on the server; a department large enough
      // to need more than one is told how far it got if a later one fails.
      for (let i = 0; i < entries.length; i += LINK_BATCH_SIZE) {
        const batch = Object.fromEntries(entries.slice(i, i + LINK_BATCH_SIZE));
        const result = await equipmentCheckService.linkAcrossTemplates(batch);
        linked += result.linked;
        skipped += result.skipped;
      }
      toast.success(
        skipped > 0
          ? `Linked ${linked} position${linked !== 1 ? 's' : ''}; ${skipped} had been linked by someone else and were left as they were`
          : `Linked ${linked} position${linked !== 1 ? 's' : ''}`
      );
    } catch (err: unknown) {
      const prefix = linked > 0 ? `Linked ${linked} before stopping. ` : '';
      toast.error(prefix + getErrorMessage(err, 'Failed to link positions'));
    } finally {
      setSaving(false);
      await load();
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
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || saving}
          className="btn-secondary flex items-center gap-1 self-start text-sm"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

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
        <div className="action-bar-safe surface-opaque border-theme-surface-border fixed inset-x-0 bottom-0 z-40 border-t px-4">
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
