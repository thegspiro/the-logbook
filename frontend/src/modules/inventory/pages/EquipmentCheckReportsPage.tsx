/**
 * Equipment Check Reports Page
 *
 * Three-tab reports page: Compliance Dashboard, Failure/Deficiency Log,
 * and Item Trend History. Includes CSV and PDF export support.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router';
import {
  ClipboardCheck,
  AlertTriangle,
  TrendingUp,
  Download,
  Loader2,
  Search,
  CheckCircle,
  XCircle,
  CalendarDays,
  ChevronDown,
} from 'lucide-react';
import { equipmentCheckService } from '@/modules/inventory/services/equipmentCheckApi';
import type {
  ComplianceReport,
  FailureLogResponse,
  FailureLogRecord,
  ItemTrendResponse,
  EquipmentCheckTemplate,
  CheckTemplateItem,
} from '../../../modules/inventory/types/equipmentCheck';
import { checkItemStatusLabel, describeCount } from '../../../modules/inventory/types/equipmentCheck';
import { DateRangePicker } from '../../../components/ux/DateRangePicker';
import { Pagination } from '../../../components/ux/Pagination';
import { useTimezone } from '../../../hooks/useTimezone';
import {
  formatCalendarDate,
  formatShortDateTime,
  formatTime,
  getTodayLocalDate,
  toLocalDateString,
  toLocalISODate,
} from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { Breadcrumbs } from '../../../components/ux/Breadcrumbs';
import { Modal } from '../../../components/Modal';
import { dayHeading } from '../utils/dayHeading';
import { lastCheckLabel } from '../utils/lastCheckLabel';

type ReportTab = 'compliance' | 'failures' | 'trends';

// `short` is the phone label: three labelled tabs share 358px there, which
// leaves no room for the icons or for "Item Trends".
const TABS: { id: ReportTab; label: string; short: string; icon: React.ElementType }[] = [
  { id: 'compliance', label: 'Compliance', short: 'Compliance', icon: ClipboardCheck },
  { id: 'failures', label: 'Failures', short: 'Failures', icon: AlertTriangle },
  { id: 'trends', label: 'Item Trends', short: 'Trends', icon: TrendingUp },
];

const PAGE_SIZE = 25;

// ─── Helper: default date range (last 30 days) ─────────────────────────────

function isReportTab(value: string | null): value is ReportTab {
  return TABS.some((tab) => tab.id === value);
}

function defaultDateRange(tz: string): { start: string; end: string } {
  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  return {
    start: toLocalDateString(thirtyDaysAgo, tz),
    end: getTodayLocalDate(tz),
  };
}

// ─── Main Component ─────────────────────────────────────────────────────────

const EquipmentCheckReportsPage: React.FC = () => {
  const tz = useTimezone();
  // ?tab= and ?from= let another screen link to one report. The apparatus
  // page's Deficiency badge sends a chief to the failure that set it, which
  // can predate the default 30-day window.
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const requestedFrom = searchParams.get('from');
  const [activeTab, setActiveTab] = useState<ReportTab>(isReportTab(requestedTab) ? requestedTab : 'compliance');
  const defaults = defaultDateRange(tz);
  const [startDate, setStartDate] = useState(
    requestedFrom && /^\d{4}-\d{2}-\d{2}$/.test(requestedFrom) && requestedFrom < defaults.start
      ? requestedFrom
      : defaults.start
  );
  const [endDate, setEndDate] = useState(defaults.end);

  const dateControl = (
    <DateControl
      startDate={startDate}
      endDate={endDate}
      onChange={(start, end) => {
        setStartDate(start);
        setEndDate(end);
      }}
    />
  );

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:space-y-5 sm:px-6">
        {/* On a phone the trail is one link up; the title and its tabs follow
            directly, so a report starts on the first screen. */}
        <Breadcrumbs className="mb-0" compactOnPhone />
        <div>
          <h1 className="text-theme-text-primary text-xl font-bold sm:text-2xl">Equipment Check Reports</h1>
          <p className="text-theme-text-muted text-sm max-sm:hidden">Review compliance and deficiencies</p>
        </div>

        <div className="segmented-group grid grid-cols-3 gap-1" role="group" aria-label="Report">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                aria-current={activeTab === tab.id ? 'page' : undefined}
                className={`touch:min-h-11 flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium transition-colors sm:px-4 ${
                  activeTab === tab.id
                    ? 'bg-violet-700 text-white'
                    : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0 max-sm:hidden" aria-hidden="true" />
                <span className="truncate sm:hidden">{tab.short}</span>
                <span className="truncate max-sm:hidden">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {activeTab === 'compliance' && (
          <ComplianceTab startDate={startDate} endDate={endDate} tz={tz} dateControl={dateControl} />
        )}
        {activeTab === 'failures' && (
          <FailuresTab startDate={startDate} endDate={endDate} tz={tz} dateControl={dateControl} />
        )}
        {activeTab === 'trends' && (
          <TrendsTab startDate={startDate} endDate={endDate} tz={tz} dateControl={dateControl} />
        )}
      </div>
    </div>
  );
};

interface TabProps {
  startDate: string;
  endDate: string;
  tz: string;
  /** The shared date range control, placed in each tab's own toolbar beside its export. */
  dateControl: React.ReactNode;
}

// ─── Toolbar pieces ─────────────────────────────────────────────────────────

/**
 * The date range: the full picker inline from 640px; on a phone a chip naming
 * the range that opens it in a sheet, because the picker stacked two full-width
 * date fields and a presets button into most of the first screen.
 */
const DateControl: React.FC<{ startDate: string; endDate: string; onChange: (start: string, end: string) => void }> = ({
  startDate,
  endDate,
  onChange,
}) => {
  const [open, setOpen] = useState(false);
  const short = (date: string) => formatCalendarDate(date, { month: 'short', day: 'numeric' });
  const label =
    startDate && endDate
      ? startDate === endDate
        ? short(startDate)
        : `${short(startDate)} – ${short(endDate)}`
      : startDate
        ? `From ${short(startDate)}`
        : endDate
          ? `Until ${short(endDate)}`
          : 'All dates';
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-hover touch:min-h-11 inline-flex min-w-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium sm:hidden"
        aria-label={`Date range: ${label}`}
      >
        <CalendarDays className="text-theme-text-muted h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
        <ChevronDown className="text-theme-text-muted h-4 w-4 shrink-0" aria-hidden="true" />
      </button>
      <div className="max-sm:hidden">
        <DateRangePicker startDate={startDate} endDate={endDate} onChange={onChange} />
      </div>
      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Date range"
        size="sm"
        footer={
          <button type="button" onClick={() => setOpen(false)} className="btn-primary w-full">
            Done
          </button>
        }
      >
        <DateRangePicker startDate={startDate} endDate={endDate} onChange={onChange} />
      </Modal>
    </>
  );
};

/**
 * One Export control in place of separate CSV and PDF buttons. A single format
 * is a plain button; two open a small menu.
 */
const ExportMenu: React.FC<{ options: { label: string; onSelect: () => void }[] }> = ({ options }) => {
  const ref = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    const close = (event: Event) => {
      const el = ref.current;
      if (!el?.open) return;
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !el.contains(event.target as Node)) {
        el.open = false;
      }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, []);

  const triggerClass =
    'btn-secondary text-theme-text-secondary touch:min-h-11 inline-flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs font-medium';
  const [only] = options;
  if (options.length === 1 && only) {
    return (
      <button type="button" onClick={only.onSelect} className={triggerClass}>
        <Download className="h-3.5 w-3.5" aria-hidden="true" /> Export {only.label}
      </button>
    );
  }
  return (
    <details ref={ref} className="relative shrink-0">
      <summary className={`${triggerClass} list-none [&::-webkit-details-marker]:hidden`}>
        <Download className="h-3.5 w-3.5" aria-hidden="true" /> Export
      </summary>
      <div className="popover-panel absolute top-full right-0 z-30 mt-1 min-w-36 overflow-hidden py-1">
        {options.map((option) => (
          <button
            key={option.label}
            type="button"
            onClick={() => {
              if (ref.current) ref.current.open = false;
              option.onSelect();
            }}
            className="text-theme-text-primary hover:bg-theme-surface-hover touch-target-phone flex w-full items-center px-3 py-2 text-left text-sm"
          >
            {option.label}
          </button>
        ))}
      </div>
    </details>
  );
};

const Toolbar: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex items-center justify-between gap-2">{children}</div>
);

// ─── Compliance Tab ─────────────────────────────────────────────────────────

const ComplianceTab: React.FC<TabProps> = ({ startDate, endDate, tz, dateControl }) => {
  const [data, setData] = useState<ComplianceReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const result = await equipmentCheckService.getEquipmentComplianceReport({
          date_from: startDate,
          date_to: endDate,
        });
        setData(result);
      } catch {
        // silently handle
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [startDate, endDate]);

  const handleExportCsv = () => {
    const url = equipmentCheckService.getReportExportUrl({
      report_type: 'compliance',
      date_from: startDate,
      date_to: endDate,
    });
    window.open(url, '_blank');
  };

  const handleExportPdf = () => {
    const url = equipmentCheckService.getReportPdfExportUrl({
      report_type: 'compliance',
      date_from: startDate,
      date_to: endDate,
    });
    window.open(url, '_blank');
  };

  const toolbar = (
    <Toolbar>
      {dateControl}
      <ExportMenu
        options={[
          { label: 'CSV', onSelect: handleExportCsv },
          { label: 'PDF', onSelect: handleExportPdf },
        ]}
      />
    </Toolbar>
  );

  if (loading) {
    return (
      <div className="space-y-4">
        {toolbar}
        <div className="text-theme-text-muted flex items-center justify-center py-12" role="status" aria-live="polite">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading compliance data...
        </div>
      </div>
    );
  }

  if (!data) return toolbar;

  const passTone =
    data.passRate >= 90
      ? 'text-green-700 dark:text-green-400'
      : data.passRate >= 70
        ? 'text-amber-700 dark:text-amber-400'
        : 'text-red-700 dark:text-red-400';

  return (
    <div className="space-y-4">
      {toolbar}

      {/* One line rather than four tiles: the numbers are context for the
          rows below, and the tiles took the whole first screen on a phone. */}
      <p className="text-theme-text-secondary text-sm" data-testid="compliance-summary">
        <span className={`font-bold ${passTone}`}>{data.passRate}%</span> pass &middot;{' '}
        <span className="tabular-nums">{data.totalChecks}</span> checks &middot;{' '}
        <span className={data.overdueCount > 0 ? 'font-medium text-red-700 dark:text-red-400' : ''}>
          {data.overdueCount} missed
        </span>{' '}
        &middot; {data.avgItemsPerCheck} items avg
      </p>

      <section aria-labelledby="apparatus-compliance-heading">
        <h2 id="apparatus-compliance-heading" className="text-theme-text-primary mb-2 text-sm font-semibold">
          Apparatus
        </h2>
        {data.apparatus.length === 0 ? (
          <p className="text-theme-text-muted py-4 text-sm">No apparatus data available.</p>
        ) : (
          <ul className="border-theme-surface-border bg-theme-surface divide-theme-surface-border divide-y overflow-hidden rounded-lg border">
            {data.apparatus.map((a) => (
              <li key={a.apparatusId} className="px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-theme-text-primary mr-auto text-sm font-semibold">{a.apparatusName}</span>
                  {/* Zero checks on a truck nothing applies to is not the same
                      as zero checks on one somebody skipped. */}
                  {a.hasChecklist === false && (
                    <span className="bg-theme-surface-secondary text-theme-text-secondary rounded-full px-1.5 py-0.5 text-xs">
                      No checklist applies
                    </span>
                  )}
                  {a.hasDeficiency && (
                    <span className="rounded-full bg-red-500/10 px-1.5 py-0.5 text-xs text-red-700 dark:text-red-400">
                      Deficiency
                    </span>
                  )}
                  {a.lastStatus && (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
                        a.lastStatus === 'pass'
                          ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                          : 'bg-red-500/10 text-red-700 dark:text-red-400'
                      }`}
                    >
                      {a.lastStatus === 'pass' ? (
                        <CheckCircle className="h-3 w-3" aria-hidden="true" />
                      ) : (
                        <XCircle className="h-3 w-3" aria-hidden="true" />
                      )}
                      {a.lastStatus === 'pass' ? 'Pass' : 'Fail'}
                    </span>
                  )}
                </div>
                <p className="text-theme-text-secondary mt-0.5 flex flex-wrap gap-x-2 text-xs">
                  {/* Expected counts from the fleet board's rule (one per shift
                      per checklist), so the two screens agree; the done count
                      comes from that same shift-dated set so the pair reconciles. */}
                  <span>
                    {a.checksExpected > 0
                      ? `${a.checksExpectedCompleted ?? a.checksCompleted} of ${a.checksExpected} expected`
                      : `${a.checksCompleted} ${a.checksCompleted === 1 ? 'check' : 'checks'}`}
                  </span>
                  {(a.checksMissed ?? 0) > 0 && (
                    <span className="font-medium text-red-700 dark:text-red-400">&middot; {a.checksMissed} missed</span>
                  )}
                  <span>
                    &middot; <span className="text-green-800 dark:text-green-400">{a.passCount} pass</span> /{' '}
                    <span className={a.failCount > 0 ? 'text-red-700 dark:text-red-400' : ''}>{a.failCount} fail</span>
                  </span>
                </p>
                <p className="text-theme-text-muted mt-0.5 text-xs">
                  {a.lastCheckDate
                    ? `Last ${lastCheckLabel(a.lastCheckDate, tz)}${a.lastCheckedBy ? ` · ${a.lastCheckedBy}` : ''}`
                    : 'Never checked'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="member-completion-heading">
        <h2 id="member-completion-heading" className="text-theme-text-primary mb-2 text-sm font-semibold">
          Members
        </h2>
        {data.members.length === 0 ? (
          <p className="text-theme-text-muted py-4 text-sm">No member data available.</p>
        ) : (
          <ul className="border-theme-surface-border bg-theme-surface divide-theme-surface-border divide-y overflow-hidden rounded-lg border">
            {data.members.map((m) => {
              const rate = m.checksCompleted > 0 ? Math.round((m.passCount / m.checksCompleted) * 100) : 0;
              return (
                <li key={m.userId} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-theme-text-primary truncate text-sm font-medium">{m.userName}</p>
                    <p className="text-theme-text-muted text-xs">
                      {m.checksCompleted} {m.checksCompleted === 1 ? 'check' : 'checks'} &middot;{' '}
                      <span className="text-green-800 dark:text-green-400">{m.passCount} pass</span> &middot;{' '}
                      <span className={m.failCount > 0 ? 'text-red-700 dark:text-red-400' : ''}>
                        {m.failCount} fail
                      </span>
                    </p>
                  </div>
                  <span className="text-theme-text-primary shrink-0 text-sm font-semibold tabular-nums">{rate}%</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
};

// ─── Failures Tab ───────────────────────────────────────────────────────────

const FailuresTab: React.FC<TabProps> = ({ startDate, endDate, tz, dateControl }) => {
  const [data, setData] = useState<FailureLogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await equipmentCheckService.getFailureLog({
        date_from: startDate,
        date_to: endDate,
        item_name: searchTerm || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      });
      setData(result);
    } catch {
      // silently handle
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, searchTerm, page]);

  // Reset to page 1 when filters change. Doing this during render (rather than
  // in an effect) means the fetch effect below sees page=1 in the same pass, so
  // a filter change while on a later page triggers one request, not two.
  const prevFilters = useRef({ startDate, endDate, searchTerm });
  if (
    prevFilters.current.startDate !== startDate ||
    prevFilters.current.endDate !== endDate ||
    prevFilters.current.searchTerm !== searchTerm
  ) {
    prevFilters.current = { startDate, endDate, searchTerm };
    setPage(1);
  }

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleExportCsv = () => {
    const url = equipmentCheckService.getReportExportUrl({
      report_type: 'failures',
      date_from: startDate,
      date_to: endDate,
    });
    window.open(url, '_blank');
  };

  const handleExportPdf = () => {
    const url = equipmentCheckService.getReportPdfExportUrl({
      report_type: 'failures',
      date_from: startDate,
      date_to: endDate,
    });
    window.open(url, '_blank');
  };

  // The log arrives newest first; consecutive runs of one local day are the days.
  const days: { day: string; items: FailureLogRecord[] }[] = [];
  for (const f of data?.items ?? []) {
    const day = f.checkedAt ? toLocalISODate(f.checkedAt, tz) : '';
    const last = days[days.length - 1];
    if (last && last.day === day) last.items.push(f);
    else days.push({ day, items: [f] });
  }

  return (
    <div className="space-y-4">
      <Toolbar>
        {dateControl}
        <ExportMenu
          options={[
            { label: 'CSV', onSelect: handleExportCsv },
            { label: 'PDF', onSelect: handleExportPdf },
          ]}
        />
      </Toolbar>
      <div className="relative">
        <Search className="text-theme-text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" aria-hidden="true" />
        <input
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          type="text"
          aria-label="Search by item name..."
          placeholder="Search by item name..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="form-input pr-3 pl-9"
        />
      </div>

      {/* Only the first load swaps the list for a spinner. A page change keeps
          the list and its Pagination mounted, so the page button the user
          pressed keeps focus instead of dropping it to <body>. */}
      {loading && !data ? (
        <div className="text-theme-text-muted flex items-center justify-center py-12" role="status" aria-live="polite">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading failures...
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="text-theme-text-muted py-12 text-center">
          <AlertTriangle className="mx-auto mb-2 h-8 w-8 opacity-50" />
          <p className="text-sm">No failed items found for this period.</p>
        </div>
      ) : (
        <>
          <p className="text-theme-text-muted text-xs" role="status" aria-live="polite">
            {loading ? 'Loading failures...' : `${data.total} total failures`}
          </p>

          {/* A table of six columns showed only its date on a phone, with the
              rest off the edge; each failure is a row of its own instead,
              under the day it was found. */}
          <div className="space-y-3 aria-busy:opacity-60" role="region" aria-label="Failure log" aria-busy={loading}>
            {days.map((group) => {
              const label = group.day ? dayHeading(group.day, tz) : 'Undated';
              return (
                <section key={group.day || 'undated'} aria-label={label} className="space-y-2">
                  <h3 className="bg-theme-bg text-theme-text-primary mobile-header-inset sticky z-10 py-1.5 text-sm font-semibold md:top-0">
                    {label}
                  </h3>
                  <ul className="border-theme-surface-border bg-theme-surface divide-theme-surface-border divide-y overflow-hidden rounded-lg border">
                    {group.items.map((f) => (
                      <li key={f.id} className="px-3 py-2.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-theme-text-primary text-sm font-medium">{f.itemName}</p>
                            {f.quantityFound != null && (
                              <p className="text-theme-text-secondary text-xs">
                                {describeCount(f.quantityFound, f.targetQuantity, f.countUnit)}
                              </p>
                            )}
                          </div>
                          {f.apparatusName && (
                            <span className="text-theme-text-primary shrink-0 font-mono text-xs font-bold">
                              {f.apparatusName}
                            </span>
                          )}
                        </div>
                        <p className="text-theme-text-muted mt-0.5 text-xs">
                          {[
                            f.compartmentName || 'On the checklist',
                            f.checkedAt ? formatTime(f.checkedAt, tz) : null,
                            f.checkedByName ?? null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                        {f.notes && (
                          <p className="text-theme-text-secondary mt-1 text-xs italic">&ldquo;{f.notes}&rdquo;</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>

          {data.total > PAGE_SIZE && (
            <Pagination currentPage={page} totalItems={data.total} pageSize={PAGE_SIZE} onPageChange={setPage} />
          )}
        </>
      )}
    </div>
  );
};

// ─── Trends Tab ─────────────────────────────────────────────────────────────

const TrendsTab: React.FC<TabProps> = ({ startDate, endDate, tz, dateControl }) => {
  const [templates, setTemplates] = useState<EquipmentCheckTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [selectedItemId, setSelectedItemId] = useState('');
  const [trendData, setTrendData] = useState<ItemTrendResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load templates for the picker
  useEffect(() => {
    const load = async () => {
      try {
        const result = await equipmentCheckService.getEquipmentCheckTemplates({});
        setTemplates(result);
      } catch (err: unknown) {
        // An empty picker and a picker whose contents failed to load looked
        // identical, so a failure here read as "this department has no
        // templates" and the officer stopped rather than retrying.
        setError(getErrorMessage(err, 'Failed to load check templates'));
      } finally {
        setLoadingTemplates(false);
      }
    };
    void load();
  }, []);

  // Get items for selected template
  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);
  const allItems: CheckTemplateItem[] = selectedTemplate?.compartments?.flatMap((c) => c.items) ?? [];

  // Load trend data when item is selected
  useEffect(() => {
    if (!selectedItemId) {
      setTrendData(null);
      setError(null);
      return;
    }
    // Switching items re-fires this before the previous request lands. Without
    // the flag a slow response for the item just deselected overwrites the one
    // the officer is now looking at — the heading names the new item while the
    // bars belong to the old one, and nothing looks wrong.
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await equipmentCheckService.getItemTrends({
          template_item_id: selectedItemId,
          date_from: startDate,
          date_to: endDate,
        });
        if (!cancelled) setTrendData(result);
      } catch (err: unknown) {
        if (cancelled) return;
        // Leaving the previous item's chart on screen under the new item's
        // name was the worst of both: stale numbers presented as current.
        setTrendData(null);
        setError(getErrorMessage(err, 'Failed to load trend data'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [selectedItemId, startDate, endDate]);

  // Reset item when template changes
  useEffect(() => {
    setSelectedItemId('');
  }, [selectedTemplateId]);

  const handleExport = () => {
    if (!selectedItemId) return;
    const url = equipmentCheckService.getReportExportUrl({
      report_type: 'item-trends',
      template_item_id: selectedItemId,
      date_from: startDate,
      date_to: endDate,
    });
    window.open(url, '_blank');
  };

  const selectClass = 'form-input px-3 text-sm focus:ring-violet-500';

  return (
    <div className="space-y-4">
      <Toolbar>
        {dateControl}
        {trendData && <ExportMenu options={[{ label: 'CSV', onSelect: handleExport }]} />}
      </Toolbar>
      {/* Template + Item selectors */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <select
          value={selectedTemplateId}
          onChange={(e) => setSelectedTemplateId(e.target.value)}
          disabled={loadingTemplates}
          className={`flex-1 ${selectClass}`}
          aria-label="Template"
        >
          <option value="">Select a template...</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        <select
          value={selectedItemId}
          onChange={(e) => setSelectedItemId(e.target.value)}
          disabled={!selectedTemplateId || allItems.length === 0}
          className={`flex-1 ${selectClass}`}
          aria-label="Item"
        >
          <option value="">Select an item...</option>
          {allItems.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>

      {/* Content */}
      {error && (
        <p className="alert-danger" role="alert">
          {error}
        </p>
      )}

      {!selectedItemId ? (
        <div className="text-theme-text-muted py-12 text-center">
          <TrendingUp className="mx-auto mb-2 h-8 w-8 opacity-50" />
          <p className="text-sm">Select a template and item to view trend data.</p>
        </div>
      ) : loading ? (
        <div className="text-theme-text-muted flex items-center justify-center py-12" role="status" aria-live="polite">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading trend data...
        </div>
      ) : trendData ? (
        <>
          <h3 className="text-theme-text-primary text-sm font-semibold">Trend: {trendData.itemName}</h3>

          {/* Bar chart visualization */}
          {trendData.trends.length > 0 ? (
            <div className="card p-4">
              <div className="flex h-40 items-end gap-1">
                {trendData.trends.map((entry) => {
                  const notApplicable = entry.notApplicableCount ?? 0;
                  const total = entry.passCount + entry.failCount + entry.notCheckedCount + notApplicable;
                  const maxHeight = 128;
                  const passH = total > 0 ? (entry.passCount / total) * maxHeight : 0;
                  const failH = total > 0 ? (entry.failCount / total) * maxHeight : 0;
                  const notApplicableH = total > 0 ? (notApplicable / total) * maxHeight : 0;
                  const notCheckedH = total > 0 ? (entry.notCheckedCount / total) * maxHeight : 0;
                  return (
                    <div key={entry.period} className="flex flex-1 flex-col items-center gap-0.5">
                      <div className="flex w-full max-w-[32px] flex-col-reverse" style={{ height: maxHeight }}>
                        {passH > 0 && (
                          <div
                            className="w-full rounded-t-sm bg-green-500"
                            style={{ height: passH }}
                            title={`Pass: ${entry.passCount}`}
                          />
                        )}
                        {failH > 0 && (
                          <div
                            className="w-full rounded-t-sm bg-red-500"
                            style={{ height: failH }}
                            title={`Fail: ${entry.failCount}`}
                          />
                        )}
                        {notApplicableH > 0 && (
                          <div
                            className="bg-theme-text-muted/70 w-full rounded-t-sm"
                            style={{ height: notApplicableH }}
                            title={`Not on truck: ${notApplicable}`}
                          />
                        )}
                        {notCheckedH > 0 && (
                          <div
                            className="bg-theme-text-muted/40 w-full rounded-t-sm"
                            style={{ height: notCheckedH }}
                            title={`Not checked: ${entry.notCheckedCount}`}
                          />
                        )}
                      </div>
                      <span className="text-theme-text-muted max-w-[40px] truncate text-[10px]">{entry.period}</span>
                    </div>
                  );
                })}
              </div>
              <div className="text-theme-text-muted mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-sm bg-green-500" /> Pass
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-sm bg-red-500" /> Fail
                </span>
                <span className="flex items-center gap-1">
                  <span className="bg-theme-text-muted/70 h-2.5 w-2.5 rounded-sm" /> Not on truck
                </span>
                <span className="flex items-center gap-1">
                  <span className="bg-theme-text-muted/40 h-2.5 w-2.5 rounded-sm" /> Not checked
                </span>
              </div>
            </div>
          ) : (
            <p className="text-theme-text-muted text-sm">No trend data for this period.</p>
          )}

          {trendData.history.length > 0 && (
            <section aria-labelledby="past-results-heading">
              <h4 id="past-results-heading" className="text-theme-text-secondary mb-2 text-xs font-semibold">
                Past results
              </h4>
              <ul className="border-theme-surface-border bg-theme-surface divide-theme-surface-border divide-y overflow-hidden rounded-lg border">
                {trendData.history.map((h) => (
                  <li key={h.checkId} className="px-3 py-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-theme-text-secondary text-xs">
                        {[h.checkedAt ? formatShortDateTime(h.checkedAt, tz) : null, h.checkedByName ?? null]
                          .filter(Boolean)
                          .join(' · ') || '-'}
                      </p>
                      <span
                        className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
                          h.status === 'pass'
                            ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                            : h.status === 'fail' || h.status === 'out_of_service'
                              ? 'bg-red-500/10 text-red-700 dark:text-red-400'
                              : 'bg-theme-surface-hover text-theme-text-muted'
                        }`}
                      >
                        {h.status === 'pass' ? <CheckCircle className="h-3 w-3" aria-hidden="true" /> : null}
                        {h.status === 'fail' || h.status === 'out_of_service' ? (
                          <XCircle className="h-3 w-3" aria-hidden="true" />
                        ) : null}
                        {/* Never the raw token: an item answered
                            "not_applicable" printed as itself here. */}
                        {checkItemStatusLabel(h.checkType, h.status)}
                      </span>
                    </div>
                    {h.notes && (
                      <p className="text-theme-text-secondary mt-1 text-xs italic">&ldquo;{h.notes}&rdquo;</p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      ) : null}
    </div>
  );
};

export default EquipmentCheckReportsPage;
