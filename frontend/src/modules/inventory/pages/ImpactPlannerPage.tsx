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
  Ruler, Download, Loader2, Search, Truck, FileText, PackageCheck,
  Trash2, Save, Send,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { inventoryService } from '../../../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';
import { formatCurrency } from '../../../utils/currencyFormatting';
import { ConfirmDialog } from '../../../components/ux/ConfirmDialog';
import { EmptyState } from '../../../components/ux/EmptyState';
import { Skeleton } from '../../../components/ux/Skeleton';
import { SortableHeader, type SortDirection } from '../../../components/ux/SortableHeader';
import type {
  ImpactPlannerOptions,
  ImpactPlannerRequest,
  ImpactPlannerResult,
  ImpactPlannerMember,
  ImpactPlannerReorderResponse,
  ImpactPlannerIssueResponse,
  ImpactPlannerRequestSizesResponse,
  ImpactPlan,
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
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>(null);

  // The exact request behind the displayed result, so reorders are generated
  // from what the user actually sees (not later edits to the filters).
  const [lastRequest, setLastRequest] = useState<ImpactPlannerRequest | null>(null);
  const [reorderUrgency, setReorderUrgency] = useState('normal');
  const [creatingReorder, setCreatingReorder] = useState(false);
  const [reorderDone, setReorderDone] = useState<ImpactPlannerReorderResponse | null>(null);
  const [issueConfirmOpen, setIssueConfirmOpen] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [issueDone, setIssueDone] = useState<ImpactPlannerIssueResponse | null>(null);
  const [requestingSizes, setRequestingSizes] = useState(false);
  const [sizesRequested, setSizesRequested] = useState<ImpactPlannerRequestSizesResponse | null>(null);

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
  const [allowanceAware, setAllowanceAware] = useState(false);

  // Saved plans
  const [savedPlans, setSavedPlans] = useState<ImpactPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [planName, setPlanName] = useState('');
  const [savingPlan, setSavingPlan] = useState(false);

  const loadOptions = useCallback(async () => {
    setOptionsLoading(true);
    try {
      const [opts, plans] = await Promise.all([
        inventoryService.getImpactPlannerOptions(),
        inventoryService.getImpactPlans().catch(() => [] as ImpactPlan[]),
      ]);
      setOptions(opts);
      setSavedPlans(plans);
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

  // Assemble the current filter selections into a request payload.
  const buildRequest = useCallback((): ImpactPlannerRequest => ({
    statuses: statuses.length ? statuses : undefined,
    membership_types: membershipTypes.length ? membershipTypes : undefined,
    ranks: ranks.length ? ranks : undefined,
    stations: stations.length ? stations : undefined,
    position_ids: positionIds.length ? positionIds : undefined,
    related_category_id: relatedCategoryId || undefined,
    replacement_aware: relatedCategoryId ? replacementAware : undefined,
    size_field: sizeField || undefined,
    stock_category_id: sizeField ? stockCategoryId || undefined : undefined,
    allowance_aware: sizeField && stockCategoryId ? allowanceAware : undefined,
  }), [statuses, membershipTypes, ranks, stations, positionIds, relatedCategoryId, replacementAware, sizeField, stockCategoryId, allowanceAware]);

  const runAnalysis = useCallback(async () => {
    setAnalyzing(true);
    try {
      const request = buildRequest();
      setReorderDone(null);
      setIssueDone(null);
      setSizesRequested(null);
      setResult(await inventoryService.analyzeImpact(request));
      setLastRequest(request);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to analyze impact'));
    } finally {
      setAnalyzing(false);
    }
  }, [buildRequest]);

  const applyPlan = useCallback((plan: ImpactPlan) => {
    const f = plan.filters || {};
    setStatuses(f.statuses ?? []);
    setMembershipTypes(f.membership_types ?? []);
    setRanks(f.ranks ?? []);
    setStations(f.stations ?? []);
    setPositionIds(f.position_ids ?? []);
    setRelatedCategoryId(f.related_category_id ?? '');
    setReplacementAware(f.replacement_aware ?? false);
    setSizeField(f.size_field ?? '');
    setStockCategoryId(f.stock_category_id ?? '');
    setAllowanceAware(f.allowance_aware ?? false);
  }, []);

  const onSelectPlan = useCallback((id: string) => {
    setSelectedPlanId(id);
    const plan = savedPlans.find((p) => p.id === id);
    if (plan) applyPlan(plan);
  }, [savedPlans, applyPlan]);

  const savePlan = useCallback(async () => {
    const name = planName.trim();
    if (!name) return;
    setSavingPlan(true);
    try {
      const created = await inventoryService.createImpactPlan({
        name, filters: buildRequest(),
      });
      setSavedPlans((prev) =>
        [...prev, created].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setSelectedPlanId(created.id);
      setShowSaveForm(false);
      setPlanName('');
      toast.success('Plan saved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save plan'));
    } finally {
      setSavingPlan(false);
    }
  }, [planName, buildRequest]);

  const deletePlan = useCallback(async () => {
    if (!selectedPlanId) return;
    try {
      await inventoryService.deleteImpactPlan(selectedPlanId);
      setSavedPlans((prev) => prev.filter((p) => p.id !== selectedPlanId));
      setSelectedPlanId('');
      toast.success('Plan deleted');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to delete plan'));
    }
  }, [selectedPlanId]);

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

  const sortedMembers = useMemo<ImpactPlannerMember[]>(() => {
    if (!sortField || !sortDir) return filteredMembers;
    const key = (m: ImpactPlannerMember): string => {
      if (sortField === 'rank') return (m.rank || '').toLowerCase();
      if (sortField === 'needed_size') return (m.needed_size || '').toLowerCase();
      return (m.full_name || '').toLowerCase();
    };
    const sorted = [...filteredMembers].sort((a, b) => key(a).localeCompare(key(b)));
    return sortDir === 'desc' ? sorted.reverse() : sorted;
  }, [filteredMembers, sortField, sortDir]);

  const onSort = useCallback((field: string, direction: SortDirection) => {
    setSortField(direction ? field : null);
    setSortDir(direction);
  }, []);

  const maxNeeding = useMemo(
    () => Math.max(1, ...(result?.size_breakdown ?? []).map((b) => b.needing)),
    [result],
  );

  const sizeFieldLabel = useMemo(() => {
    if (!result?.size_field || !options) return null;
    return options.size_fields.find((s) => s.value === result.size_field)?.label ?? null;
  }, [result, options]);

  const bulkIssue = useCallback(async () => {
    if (!lastRequest) return;
    setIssuing(true);
    try {
      const res = await inventoryService.bulkIssueFromPlan(lastRequest);
      setIssueDone(res);
      setIssueConfirmOpen(false);
      toast.success(
        `Issued to ${res.issued_count} member${res.issued_count === 1 ? '' : 's'}`,
      );
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to issue items'));
    } finally {
      setIssuing(false);
    }
  }, [lastRequest]);

  const requestSizes = useCallback(async () => {
    if (!lastRequest) return;
    setRequestingSizes(true);
    try {
      const res = await inventoryService.requestMemberSizes(lastRequest);
      setSizesRequested(res);
      toast.success(
        `Requested sizes from ${res.notified_count} member${res.notified_count === 1 ? '' : 's'}`,
      );
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to request sizes'));
    } finally {
      setRequestingSizes(false);
    }
  }, [lastRequest]);

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
              <div className="space-y-4" aria-label="Loading filters" role="status">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="space-y-2">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-9 w-full" />
                  </div>
                ))}
              </div>
            ) : options ? (
              <>
                {/* Saved plans */}
                <div className="pb-4 mb-1 border-b border-theme-surface-border">
                  <label className={labelClass}>Saved plans</label>
                  <div className="flex items-center gap-2">
                    <select
                      value={selectedPlanId}
                      onChange={(e) => onSelectPlan(e.target.value)}
                      className={selectClass}
                      aria-label="Saved plans"
                    >
                      <option value="">— New plan —</option>
                      {savedPlans.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    {selectedPlanId && (
                      <button
                        onClick={() => { void deletePlan(); }}
                        className="btn-secondary btn-sm shrink-0"
                        title="Delete plan"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  {showSaveForm ? (
                    <div className="flex items-center gap-2 mt-2">
                      <input
                        type="text"
                        value={planName}
                        onChange={(e) => setPlanName(e.target.value)}
                        placeholder="Plan name"
                        className={selectClass}
                      />
                      <button
                        onClick={() => { void savePlan(); }}
                        disabled={savingPlan || !planName.trim()}
                        className="btn-primary btn-sm shrink-0"
                        aria-label="Save plan"
                      >
                        {savingPlan ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => { setShowSaveForm(false); setPlanName(''); }}
                        className="btn-secondary btn-sm shrink-0"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowSaveForm(true)}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-2"
                    >
                      Save current filters as a plan
                    </button>
                  )}
                </div>

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
                    aria-label="Related category"
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
                    aria-label="Size needed"
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
                      aria-label="Stock source"
                    >
                      <option value="">— Don't subtract current stock —</option>
                      {options.categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    {stockCategoryId && (
                      <label className="flex items-start gap-2 mt-2 text-xs text-theme-text-secondary cursor-pointer">
                        <input
                          type="checkbox"
                          checked={allowanceAware}
                          onChange={(e) => setAllowanceAware(e.target.checked)}
                          className="mt-0.5 rounded border-theme-surface-border text-blue-600 focus:ring-blue-500/40"
                        />
                        <span>Warn when members are over their issuance allowance</span>
                      </label>
                    )}
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
              <div className="card">
                <EmptyState
                  icon={Target}
                  title="No analysis yet"
                  description="Choose your filters and run an analysis to see who is impacted and the sizes needed."
                />
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

                {/* Request sizes from members with no size on file */}
                {result.members_missing_sizes > 0 && (
                  <div className="card-secondary p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <span className="text-sm text-theme-text-muted flex items-center gap-2">
                      <Ruler className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                      {result.members_missing_sizes} member{result.members_missing_sizes === 1 ? '' : 's'} need the item but have no size on file.
                    </span>
                    {sizesRequested ? (
                      <span className="text-sm text-green-700 dark:text-green-400 flex items-center gap-1.5 shrink-0">
                        <CheckCircle2 className="w-4 h-4" />
                        Requested from {sizesRequested.notified_count}
                      </span>
                    ) : (
                      <button
                        onClick={() => { void requestSizes(); }}
                        disabled={requestingSizes}
                        className="btn-secondary btn-sm shrink-0"
                      >
                        {requestingSizes ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        Request sizes
                      </button>
                    )}
                  </div>
                )}

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
                    {/* Horizontal bars: bar length is the per-size "need". */}
                    <div className="space-y-1.5">
                      {result.size_breakdown.map((b) => (
                        <div key={b.size} className="flex items-center gap-3">
                          <span className="w-14 shrink-0 text-sm font-semibold text-theme-text-primary truncate" title={b.size}>
                            {b.size}
                          </span>
                          <div
                            className="relative flex-1 h-5 rounded bg-theme-surface-secondary overflow-hidden"
                            role="img"
                            aria-label={`${b.size}: ${b.needing} needed`}
                          >
                            <div
                              className="h-full bg-purple-500/30"
                              style={{ width: `${(b.needing / maxNeeding) * 100}%` }}
                            />
                          </div>
                          {result.stock_checked ? (
                            <span className="shrink-0 text-xs text-theme-text-muted">
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
                            <span className="shrink-0 text-xs text-theme-text-muted">
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

                    {/* Bulk issue: give out the stock you already have */}
                    {result.stock_checked &&
                      result.size_breakdown.some(
                        (b) => (b.on_hand ?? 0) > 0 && b.needing > 0 && b.size !== 'Unknown',
                      ) && (
                      <div className="mt-4 pt-4 border-t border-theme-surface-border">
                        {issueDone ? (
                          <div className="rounded-lg bg-green-500/10 px-3 py-2 text-sm">
                            <span className="text-green-700 dark:text-green-400 flex items-center gap-2">
                              <CheckCircle2 className="w-4 h-4 shrink-0" />
                              Issued to {issueDone.issued_count} member{issueDone.issued_count === 1 ? '' : 's'}
                              {issueDone.skipped_count > 0 && `, ${issueDone.skipped_count} skipped`}
                            </span>
                            {issueDone.skipped_count > 0 && (
                              <ul className="mt-1 ml-6 list-disc text-xs text-theme-text-muted">
                                {issueDone.skipped.slice(0, 5).map((s) => (
                                  <li key={s.user_id}>{s.name || s.user_id}: {s.reason}</li>
                                ))}
                                {issueDone.skipped.length > 5 && (
                                  <li>…and {issueDone.skipped.length - 5} more</li>
                                )}
                              </ul>
                            )}
                          </div>
                        ) : (
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <p className="text-xs text-theme-text-muted">
                              Issue matching on-hand stock to members who need it now.
                            </p>
                            <button
                              onClick={() => setIssueConfirmOpen(true)}
                              className="btn-info btn-md justify-center shrink-0"
                            >
                              <PackageCheck className="w-4 h-4" />
                              Issue on-hand stock
                            </button>
                          </div>
                        )}
                      </div>
                    )}

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
                      {result.allowance_aware && result.members_over_allowance > 0 && (
                        <span className="inline-flex items-center rounded-full bg-red-500/10 text-red-700 dark:text-red-400 px-2 py-0.5 text-xs font-medium">
                          {result.members_over_allowance} over allowance
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

                  {sortedMembers.length === 0 ? (
                    <EmptyState
                      icon={Users}
                      title="No members match"
                      description="Adjust the filters or the list search to see members."
                    />
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left border-b border-theme-surface-border">
                            <th className="py-2 pr-3">
                              <SortableHeader label="Member" field="full_name" currentSort={sortField} currentDirection={sortDir} onSort={onSort} />
                            </th>
                            <th className="py-2 px-3 hidden sm:table-cell">
                              <SortableHeader label="Rank / Station" field="rank" currentSort={sortField} currentDirection={sortDir} onSort={onSort} />
                            </th>
                            {result.size_field && (
                              <th className="py-2 px-3">
                                <SortableHeader label="Size" field="needed_size" currentSort={sortField} currentDirection={sortDir} onSort={onSort} />
                              </th>
                            )}
                            {relatedCategoryId && <th className="py-2 px-3 text-xs font-semibold uppercase tracking-wider text-theme-text-secondary">Existing</th>}
                            <th className="py-2 pl-3 text-xs font-semibold uppercase tracking-wider text-theme-text-secondary">Contact</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedMembers.map((m) => (
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
                                {m.over_allowance && (
                                  <span className="inline-flex items-center rounded-full bg-red-500/10 text-red-700 dark:text-red-400 px-1.5 py-0.5 text-[10px] font-medium mt-0.5">
                                    over allowance
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-theme-text-secondary hidden sm:table-cell">
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

      <ConfirmDialog
        isOpen={issueConfirmOpen}
        onClose={() => setIssueConfirmOpen(false)}
        onConfirm={() => { void bulkIssue(); }}
        title="Issue on-hand stock"
        message="This issues one matching-size item to each member who needs it and has stock available. Members with no size on file or no matching stock are skipped. Continue?"
        confirmLabel="Issue items"
        variant="warning"
        loading={issuing}
      />
    </div>
  );
};

export default ImpactPlannerPage;
