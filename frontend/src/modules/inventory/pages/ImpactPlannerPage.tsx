/**
 * Inventory Impact Planner
 *
 * Helps the quartermaster plan a new issue (e.g. a new jacket for a subset
 * of members): pick who fits a category, see how many are impacted, the
 * sizes they need, and who already holds a comparable item — so they know
 * how many to buy, in which sizes, and who to contact for the exchange.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Target, RefreshCw, Users, ShoppingCart, CheckCircle2,
  Ruler, Download, Loader2, Search, Truck, FileText,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { inventoryService } from '../../../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';
import { formatCurrency } from '../../../utils/currencyFormatting';
import type {
  ImpactPlannerOptions,
  ImpactPlannerRequest,
  ImpactPlannerResult,
  ImpactPlannerMember,
  ImpactPlannerReorderResponse,
} from '../types';

const URGENCY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
] as const;

const labelClass = 'block text-xs font-semibold uppercase tracking-wider text-theme-text-muted mb-2';
const selectClass =
  'w-full rounded-lg border border-theme-surface-border bg-theme-surface px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500/40';

/** A scrollable list of checkboxes for an OR-within-field filter. */
interface CheckGroupProps {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
}

const CheckGroup: React.FC<CheckGroupProps> = ({ label, options, selected, onToggle }) => (
  <div>
    <label className={labelClass}>{label}</label>
    {options.length === 0 ? (
      <p className="text-xs text-theme-text-muted italic">None available</p>
    ) : (
      <div className="max-h-40 overflow-y-auto space-y-1 pr-1 rounded-lg border border-theme-surface-border bg-theme-surface p-2">
        {options.map((opt) => (
          <label
            key={opt.value}
            className="flex items-center gap-2 text-sm text-theme-text-primary cursor-pointer hover:bg-theme-surface-hover rounded px-1.5 py-1"
          >
            <input
              type="checkbox"
              checked={selected.includes(opt.value)}
              onChange={() => onToggle(opt.value)}
              className="rounded border-theme-surface-border text-blue-600 focus:ring-blue-500/40"
            />
            <span className="truncate">{opt.label}</span>
          </label>
        ))}
      </div>
    )}
  </div>
);

interface StatCardProps {
  icon: React.ReactNode;
  value: number;
  label: string;
  iconBg: string;
}

const StatCard: React.FC<StatCardProps> = ({ icon, value, label, iconBg }) => (
  <div className="card-secondary p-4 flex items-center gap-3">
    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${iconBg}`}>
      {icon}
    </div>
    <div className="min-w-0">
      <p className="text-2xl font-bold text-theme-text-primary leading-tight">{value}</p>
      <p className="text-xs text-theme-text-muted">{label}</p>
    </div>
  </div>
);

const csvEscape = (value: string): string =>
  /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

const ImpactPlannerPage: React.FC = () => {
  const [options, setOptions] = useState<ImpactPlannerOptions | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<ImpactPlannerResult | null>(null);
  const [memberSearch, setMemberSearch] = useState('');

  // The exact request behind the displayed result, so reorders are generated
  // from what the user actually sees (not later edits to the filters).
  const [lastRequest, setLastRequest] = useState<ImpactPlannerRequest | null>(null);
  const [reorderUrgency, setReorderUrgency] = useState('normal');
  const [creatingReorder, setCreatingReorder] = useState(false);
  const [reorderDone, setReorderDone] = useState<ImpactPlannerReorderResponse | null>(null);

  // Filter selections
  const [statuses, setStatuses] = useState<string[]>(['active']);
  const [membershipTypes, setMembershipTypes] = useState<string[]>([]);
  const [ranks, setRanks] = useState<string[]>([]);
  const [stations, setStations] = useState<string[]>([]);
  const [positionIds, setPositionIds] = useState<string[]>([]);
  const [relatedCategoryId, setRelatedCategoryId] = useState('');
  const [replacementAware, setReplacementAware] = useState(false);
  const [sizeField, setSizeField] = useState('');
  const [stockCategoryId, setStockCategoryId] = useState('');

  const loadOptions = useCallback(async () => {
    setOptionsLoading(true);
    try {
      setOptions(await inventoryService.getImpactPlannerOptions());
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load planner options'));
    } finally {
      setOptionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  const toggle = (setter: React.Dispatch<React.SetStateAction<string[]>>) => (value: string) => {
    setter((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  };

  const runAnalysis = useCallback(async () => {
    setAnalyzing(true);
    try {
      const request: ImpactPlannerRequest = {
        statuses: statuses.length ? statuses : undefined,
        membership_types: membershipTypes.length ? membershipTypes : undefined,
        ranks: ranks.length ? ranks : undefined,
        stations: stations.length ? stations : undefined,
        position_ids: positionIds.length ? positionIds : undefined,
        related_category_id: relatedCategoryId || undefined,
        replacement_aware: relatedCategoryId ? replacementAware : undefined,
        size_field: sizeField || undefined,
        stock_category_id: sizeField ? stockCategoryId || undefined : undefined,
      };
      setReorderDone(null);
      setResult(await inventoryService.analyzeImpact(request));
      setLastRequest(request);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to analyze impact'));
    } finally {
      setAnalyzing(false);
    }
  }, [statuses, membershipTypes, ranks, stations, positionIds, relatedCategoryId, replacementAware, sizeField, stockCategoryId]);

  const createReorders = useCallback(async () => {
    if (!lastRequest) return;
    setCreatingReorder(true);
    try {
      const res = await inventoryService.createReorderFromPlan({
        ...lastRequest,
        urgency: reorderUrgency,
      });
      setReorderDone(res);
      toast.success(
        `Created ${res.created_count} reorder request${res.created_count === 1 ? '' : 's'}`,
      );
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to create reorder requests'));
    } finally {
      setCreatingReorder(false);
    }
  }, [lastRequest, reorderUrgency]);

  const filteredMembers = useMemo<ImpactPlannerMember[]>(() => {
    if (!result) return [];
    const q = memberSearch.trim().toLowerCase();
    if (!q) return result.members;
    return result.members.filter((m) =>
      [m.full_name, m.membership_number, m.rank, m.station, m.needed_size]
        .filter(Boolean)
        .some((field) => (field as string).toLowerCase().includes(q)),
    );
  }, [result, memberSearch]);

  const sizeFieldLabel = useMemo(() => {
    if (!result?.size_field || !options) return null;
    return options.size_fields.find((s) => s.value === result.size_field)?.label ?? null;
  }, [result, options]);

  const [exportingPdf, setExportingPdf] = useState(false);
  const exportPdf = useCallback(async () => {
    if (!lastRequest) return;
    setExportingPdf(true);
    try {
      const blob = await inventoryService.exportPlanPdf(lastRequest);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'impact-plan.pdf';
      link.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to generate PDF'));
    } finally {
      setExportingPdf(false);
    }
  }, [lastRequest]);

  const exportCsv = useCallback(() => {
    if (!result) return;
    const headers = [
      'Name', 'Membership #', 'Rank', 'Station', 'Status',
      'Needed Size', 'Already Has Item', 'Needs Replacement', 'Existing Items',
      'Email', 'Phone',
    ];
    const rows = result.members.map((m) => [
      m.full_name || '',
      m.membership_number || '',
      m.rank || '',
      m.station || '',
      m.status || '',
      m.needed_size || '',
      m.has_related_item ? 'Yes' : 'No',
      m.needs_replacement ? 'Yes' : 'No',
      (m.related_item_names || []).join('; '),
      m.email || '',
      m.phone || '',
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => csvEscape(String(cell))).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'impact-plan.csv';
    link.click();
    URL.revokeObjectURL(url);
  }, [result]);

  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Header */}
        <Link
          to="/inventory/admin"
          className="inline-flex items-center gap-1.5 text-sm text-theme-text-muted hover:text-theme-text-primary mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Inventory Admin
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-3 min-w-0">
            <div className="bg-purple-600 rounded-lg p-2 shrink-0">
              <Target className="w-6 h-6 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-theme-text-primary truncate">Impact Planner</h1>
              <p className="text-sm text-theme-text-muted">
                Plan a new issue: who is impacted, the sizes they need, and who to contact
              </p>
            </div>
          </div>
          <button
            onClick={() => { void loadOptions(); }}
            className="btn-secondary btn-md self-start sm:self-auto"
            title="Reload filter options"
          >
            <RefreshCw className={`w-4 h-4 ${optionsLoading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
          {/* Filter panel */}
          <div className="card p-4 sm:p-5 space-y-4 h-fit">
            <h2 className="text-sm font-semibold text-theme-text-primary">Who fits the category?</h2>

            {optionsLoading ? (
              <div className="flex items-center gap-2 text-sm text-theme-text-muted py-6">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading options…
              </div>
            ) : options ? (
              <>
                <CheckGroup
                  label="Status"
                  options={options.statuses}
                  selected={statuses}
                  onToggle={toggle(setStatuses)}
                />
                <CheckGroup
                  label="Membership Type"
                  options={options.membership_types}
                  selected={membershipTypes}
                  onToggle={toggle(setMembershipTypes)}
                />
                <CheckGroup
                  label="Rank"
                  options={options.ranks}
                  selected={ranks}
                  onToggle={toggle(setRanks)}
                />
                <CheckGroup
                  label="Station"
                  options={options.stations.map((s) => ({ value: s, label: s }))}
                  selected={stations}
                  onToggle={toggle(setStations)}
                />
                <CheckGroup
                  label="Position / Role"
                  options={options.positions.map((p) => ({ value: p.id, label: p.name }))}
                  selected={positionIds}
                  onToggle={toggle(setPositionIds)}
                />

                <div>
                  <label className={labelClass}>Already has item in category</label>
                  <select
                    value={relatedCategoryId}
                    onChange={(e) => setRelatedCategoryId(e.target.value)}
                    className={selectClass}
                  >
                    <option value="">— Don't check existing items —</option>
                    {options.categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  {relatedCategoryId && (
                    <label className="flex items-start gap-2 mt-2 text-xs text-theme-text-secondary cursor-pointer">
                      <input
                        type="checkbox"
                        checked={replacementAware}
                        onChange={(e) => setReplacementAware(e.target.checked)}
                        className="mt-0.5 rounded border-theme-surface-border text-blue-600 focus:ring-blue-500/40"
                      />
                      <span>Count worn or expired items as needing replacement</span>
                    </label>
                  )}
                </div>

                <div>
                  <label className={labelClass}>Size needed</label>
                  <select
                    value={sizeField}
                    onChange={(e) => setSizeField(e.target.value)}
                    className={selectClass}
                  >
                    <option value="">— No size breakdown —</option>
                    {options.size_fields.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>

                {sizeField && (
                  <div>
                    <label className={labelClass}>Net against on-hand stock</label>
                    <select
                      value={stockCategoryId}
                      onChange={(e) => setStockCategoryId(e.target.value)}
                      className={selectClass}
                    >
                      <option value="">— Don't subtract current stock —</option>
                      {options.categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                <button
                  onClick={() => { void runAnalysis(); }}
                  disabled={analyzing}
                  className="btn-primary btn-md w-full justify-center"
                >
                  {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
                  {analyzing ? 'Analyzing…' : 'Analyze Impact'}
                </button>
              </>
            ) : (
              <p className="text-sm text-theme-text-muted">Unable to load filter options.</p>
            )}
          </div>

          {/* Results */}
          <div className="min-w-0">
            {!result ? (
              <div className="card p-10 text-center text-theme-text-muted">
                <Target className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm">
                  Choose your filters and run an analysis to see who is impacted and the sizes needed.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Summary stats */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <StatCard
                    icon={<Users className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
                    value={result.total_members}
                    label="Members matched"
                    iconBg="bg-blue-500/10"
                  />
                  <StatCard
                    icon={<ShoppingCart className="w-5 h-5 text-purple-600 dark:text-purple-400" />}
                    value={result.members_needing_item}
                    label="Need the item"
                    iconBg="bg-purple-500/10"
                  />
                  <StatCard
                    icon={<CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />}
                    value={result.members_with_related_item}
                    label="Already have one"
                    iconBg="bg-green-500/10"
                  />
                  <StatCard
                    icon={<Ruler className="w-5 h-5 text-amber-600 dark:text-amber-400" />}
                    value={result.members_missing_sizes}
                    label="Missing size info"
                    iconBg="bg-amber-500/10"
                  />
                </div>

                {/* Size breakdown for purchasing */}
                {result.size_breakdown.length > 0 && (
                  <div className="card p-4 sm:p-5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                      <h3 className="text-sm font-semibold text-theme-text-primary">
                        Sizes to purchase{sizeFieldLabel ? ` — ${sizeFieldLabel}` : ''}
                      </h3>
                      <div className="flex flex-wrap items-center gap-2">
                        {result.stock_checked && result.total_to_purchase != null && (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-500/10 text-purple-700 dark:text-purple-400 px-3 py-1 text-xs font-semibold">
                            <ShoppingCart className="w-3.5 h-3.5" />
                            {result.total_to_purchase} to buy
                          </span>
                        )}
                        {result.cost_estimated && result.estimated_total_cost != null && (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 text-green-700 dark:text-green-400 px-3 py-1 text-xs font-semibold">
                            ~{formatCurrency(result.estimated_total_cost)} est.
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {result.size_breakdown.map((b) => (
                        <div
                          key={b.size}
                          className="flex items-center gap-2 rounded-lg border border-theme-surface-border bg-theme-surface px-3 py-2"
                        >
                          <span className="text-sm font-semibold text-theme-text-primary">{b.size}</span>
                          {result.stock_checked ? (
                            <span className="text-xs text-theme-text-muted">
                              need {b.needing} &middot; {b.on_hand ?? 0} on hand &middot;{' '}
                              <span className="font-semibold text-purple-600 dark:text-purple-400">
                                buy {b.shortfall ?? b.needing}
                              </span>
                              {result.cost_estimated && b.estimated_cost != null && (
                                <span className="text-green-700 dark:text-green-400">
                                  {' '}&middot; {formatCurrency(b.estimated_cost)}
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-xs text-theme-text-muted">
                              need <span className="font-semibold text-purple-600 dark:text-purple-400">{b.needing}</span>
                              {b.total !== b.needing && ` of ${b.total}`}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-theme-text-muted mt-3">
                      &ldquo;need&rdquo; excludes members who already hold an item in the selected category.
                      {result.stock_checked && ' On-hand stock is matched to needed sizes by label; members with no size on file can’t be matched.'}
                    </p>

                    {/* One-click reorder: turn the shortfall into draft POs */}
                    {result.stock_checked && (result.total_to_purchase ?? 0) > 0 && (
                      <div className="mt-4 pt-4 border-t border-theme-surface-border">
                        {reorderDone ? (
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg bg-green-500/10 px-3 py-2">
                            <span className="text-sm text-green-700 dark:text-green-400 flex items-center gap-2">
                              <CheckCircle2 className="w-4 h-4 shrink-0" />
                              Created {reorderDone.created_count} reorder request{reorderDone.created_count === 1 ? '' : 's'}
                              {reorderDone.skipped_unknown_size > 0 &&
                                ` (${reorderDone.skipped_unknown_size} member${reorderDone.skipped_unknown_size === 1 ? '' : 's'} skipped — no size on file)`}
                            </span>
                            <Link to="/inventory/admin/reorder" className="btn-secondary btn-sm shrink-0">
                              Review reorders
                            </Link>
                          </div>
                        ) : (
                          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                            <div>
                              <label className={labelClass}>Reorder urgency</label>
                              <select
                                value={reorderUrgency}
                                onChange={(e) => setReorderUrgency(e.target.value)}
                                className={selectClass}
                              >
                                {URGENCY_OPTIONS.map((u) => (
                                  <option key={u.value} value={u.value}>{u.label}</option>
                                ))}
                              </select>
                            </div>
                            <button
                              onClick={() => { void createReorders(); }}
                              disabled={creatingReorder}
                              className="btn-primary btn-md justify-center"
                            >
                              {creatingReorder
                                ? <Loader2 className="w-4 h-4 animate-spin" />
                                : <Truck className="w-4 h-4" />}
                              Create reorder request{(result.size_breakdown.filter((b) => (b.shortfall ?? 0) > 0).length) === 1 ? '' : 's'}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Members table */}
                <div className="card p-4 sm:p-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-theme-text-primary">
                        Impacted Members ({filteredMembers.length})
                      </h3>
                      {result.replacement_aware && result.members_needing_replacement > 0 && (
                        <span className="inline-flex items-center rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 px-2 py-0.5 text-xs font-medium">
                          {result.members_needing_replacement} to replace
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-theme-text-muted" />
                        <input
                          type="text"
                          value={memberSearch}
                          onChange={(e) => setMemberSearch(e.target.value)}
                          placeholder="Filter list…"
                          className="rounded-lg border border-theme-surface-border bg-theme-surface pl-8 pr-3 py-1.5 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                        />
                      </div>
                      <button onClick={exportCsv} className="btn-secondary btn-sm" title="Export to CSV">
                        <Download className="w-4 h-4" />
                        <span className="hidden sm:inline">CSV</span>
                      </button>
                      <button
                        onClick={() => { void exportPdf(); }}
                        disabled={exportingPdf}
                        className="btn-secondary btn-sm"
                        title="Download PDF summary"
                      >
                        {exportingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                        <span className="hidden sm:inline">PDF</span>
                      </button>
                    </div>
                  </div>

                  {filteredMembers.length === 0 ? (
                    <p className="text-sm text-theme-text-muted py-6 text-center">No members match.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs uppercase tracking-wider text-theme-text-muted border-b border-theme-surface-border">
                            <th className="py-2 pr-3 font-semibold">Member</th>
                            <th className="py-2 px-3 font-semibold">Rank / Station</th>
                            {result.size_field && <th className="py-2 px-3 font-semibold">Size</th>}
                            {relatedCategoryId && <th className="py-2 px-3 font-semibold">Existing</th>}
                            <th className="py-2 pl-3 font-semibold">Contact</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredMembers.map((m) => (
                            <tr key={m.user_id} className="border-b border-theme-surface-border/50 last:border-0">
                              <td className="py-2.5 pr-3">
                                <Link
                                  to={`/members/${m.user_id}`}
                                  className="font-medium text-theme-text-primary hover:text-blue-600 dark:hover:text-blue-400"
                                >
                                  {m.full_name || 'Unknown'}
                                </Link>
                                {m.membership_number && (
                                  <span className="block text-xs text-theme-text-muted">#{m.membership_number}</span>
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-theme-text-secondary">
                                <span className="capitalize">{m.rank || '—'}</span>
                                {m.station && <span className="block text-xs text-theme-text-muted">{m.station}</span>}
                              </td>
                              {result.size_field && (
                                <td className="py-2.5 px-3">
                                  {m.needed_size ? (
                                    <span className="font-medium text-theme-text-primary">{m.needed_size}</span>
                                  ) : (
                                    <span className="text-xs text-amber-600 dark:text-amber-400">No size on file</span>
                                  )}
                                </td>
                              )}
                              {relatedCategoryId && (
                                <td className="py-2.5 px-3">
                                  {m.has_related_item ? (
                                    <span
                                      className="inline-flex items-center gap-1 rounded-full bg-green-500/10 text-green-700 dark:text-green-400 px-2 py-0.5 text-xs font-medium"
                                      title={m.related_item_names.join(', ')}
                                    >
                                      Has item
                                    </span>
                                  ) : m.needs_replacement ? (
                                    <span
                                      className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 px-2 py-0.5 text-xs font-medium"
                                      title={m.related_item_names.join(', ')}
                                    >
                                      Replace
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/10 text-purple-700 dark:text-purple-400 px-2 py-0.5 text-xs font-medium">
                                      Needs item
                                    </span>
                                  )}
                                </td>
                              )}
                              <td className="py-2.5 pl-3 text-theme-text-secondary">
                                {m.email ? (
                                  <a href={`mailto:${m.email}`} className="hover:text-blue-600 dark:hover:text-blue-400 break-all">
                                    {m.email}
                                  </a>
                                ) : m.phone ? (
                                  <span>{m.phone}</span>
                                ) : (
                                  <span className="text-xs text-theme-text-muted">—</span>
                                )}
                                {m.email && m.phone && (
                                  <span className="block text-xs text-theme-text-muted">{m.phone}</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImpactPlannerPage;
