/**
 * Equipment Check Reports Page
 *
 * Three-tab reports page: Compliance Dashboard, Failure/Deficiency Log,
 * and Item Trend History. Includes CSV and PDF export support.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  BarChart3,
  ClipboardCheck,
  AlertTriangle,
  TrendingUp,
  Download,
  FileText,
  Loader2,
  Search,
  ArrowLeft,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { useNavigate } from 'react-router';
import { schedulingService } from '../../modules/scheduling/services/api';
import type {
  ComplianceReport,
  FailureLogResponse,
  FailureLogRecord,
  ItemTrendResponse,
  EquipmentCheckTemplate,
  CheckTemplateItem,
} from '../../modules/scheduling/types/equipmentCheck';
import { DateRangePicker } from '../../components/ux/DateRangePicker';
import { Pagination } from '../../components/ux/Pagination';
import { useTimezone } from '../../hooks/useTimezone';
import { formatDateTime, getTodayLocalDate, toLocalDateString } from '../../utils/dateFormatting';

type ReportTab = 'compliance' | 'failures' | 'trends';

const TABS: { id: ReportTab; label: string; icon: React.ElementType }[] = [
  { id: 'compliance', label: 'Compliance', icon: ClipboardCheck },
  { id: 'failures', label: 'Failures', icon: AlertTriangle },
  { id: 'trends', label: 'Item Trends', icon: TrendingUp },
];

const PAGE_SIZE = 25;

// ─── Helper: default date range (last 30 days) ─────────────────────────────

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
  const navigate = useNavigate();
  const tz = useTimezone();
  const [activeTab, setActiveTab] = useState<ReportTab>('compliance');
  const defaults = defaultDateRange(tz);
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);

  return (
    <div className="bg-theme-bg min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <button
            onClick={() => void navigate('/scheduling')}
            className="hover:bg-theme-surface-hover text-theme-text-muted rounded-lg p-1.5"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-violet-500" />
            <h1 className="text-theme-text-primary text-xl font-bold">Equipment Check Reports</h1>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-theme-surface border-theme-surface-border mb-5 flex gap-1 rounded-xl border p-1">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'bg-violet-600 text-white'
                    : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Date range picker (shared across tabs) */}
        <div className="mb-5">
          <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            onChange={(s, e) => {
              setStartDate(s);
              setEndDate(e);
            }}
          />
        </div>

        {/* Tab content */}
        {activeTab === 'compliance' && <ComplianceTab startDate={startDate} endDate={endDate} tz={tz} />}
        {activeTab === 'failures' && <FailuresTab startDate={startDate} endDate={endDate} tz={tz} />}
        {activeTab === 'trends' && <TrendsTab startDate={startDate} endDate={endDate} tz={tz} />}
      </div>
    </div>
  );
};

// ─── Compliance Tab ─────────────────────────────────────────────────────────

const ComplianceTab: React.FC<{ startDate: string; endDate: string; tz: string }> = ({ startDate, endDate, tz }) => {
  const [data, setData] = useState<ComplianceReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const result = await schedulingService.getEquipmentComplianceReport({
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
    const url = schedulingService.getReportExportUrl({
      report_type: 'compliance',
      date_from: startDate,
      date_to: endDate,
    });
    window.open(url, '_blank');
  };

  const handleExportPdf = () => {
    const url = schedulingService.getReportPdfExportUrl({
      report_type: 'compliance',
      date_from: startDate,
      date_to: endDate,
    });
    window.open(url, '_blank');
  };

  if (loading) {
    return (
      <div className="text-theme-text-muted flex items-center justify-center py-12" role="status" aria-live="polite">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading compliance data...
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-5">
      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total Checks" value={String(data.totalChecks)} />
        <StatCard
          label="Pass Rate"
          value={`${data.passRate}%`}
          color={data.passRate >= 90 ? 'green' : data.passRate >= 70 ? 'amber' : 'red'}
        />
        <StatCard label="Overdue" value={String(data.overdueCount)} color={data.overdueCount > 0 ? 'red' : undefined} />
        <StatCard label="Avg Items / Check" value={String(data.avgItemsPerCheck)} />
      </div>

      {/* Export */}
      <div className="flex justify-end gap-2">
        <button
          onClick={handleExportCsv}
          className="bg-theme-surface border-theme-surface-border hover:bg-theme-surface-hover text-theme-text-secondary flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium"
        >
          <Download className="h-3.5 w-3.5" /> CSV
        </button>
        <button
          onClick={handleExportPdf}
          className="bg-theme-surface border-theme-surface-border hover:bg-theme-surface-hover text-theme-text-secondary flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium"
        >
          <FileText className="h-3.5 w-3.5" /> PDF
        </button>
      </div>

      {/* Apparatus compliance cards */}
      <div>
        <h3 className="text-theme-text-primary mb-3 text-sm font-semibold">Apparatus Compliance</h3>
        {data.apparatus.length === 0 ? (
          <p className="text-theme-text-muted py-4 text-sm">No apparatus data available.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.apparatus.map((a) => (
              <div key={a.apparatusId} className="bg-theme-surface border-theme-surface-border rounded-xl border p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-theme-text-primary text-sm font-semibold">{a.apparatusName}</span>
                  {a.hasDeficiency && (
                    <span className="rounded-full bg-red-500/10 px-1.5 py-0.5 text-xs text-red-700 dark:text-red-400">
                      Deficiency
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <span className="text-theme-text-muted">Checks:</span>
                  <span className="text-theme-text-secondary">{a.checksCompleted}</span>
                  <span className="text-theme-text-muted">Pass / Fail:</span>
                  <span className="text-theme-text-secondary">
                    <span className="text-green-600">{a.passCount}</span>
                    {' / '}
                    <span className={a.failCount > 0 ? 'text-red-600' : ''}>{a.failCount}</span>
                  </span>
                  <span className="text-theme-text-muted">Last Check:</span>
                  <span className="text-theme-text-secondary">
                    {a.lastCheckDate ? formatDateTime(a.lastCheckDate, tz) : 'Never'}
                  </span>
                  <span className="text-theme-text-muted">Checked By:</span>
                  <span className="text-theme-text-secondary">{a.lastCheckedBy ?? '-'}</span>
                </div>
                {a.lastStatus && (
                  <div className="mt-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
                        a.lastStatus === 'pass'
                          ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                          : 'bg-red-500/10 text-red-700 dark:text-red-400'
                      }`}
                    >
                      {a.lastStatus === 'pass' ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                      {a.lastStatus === 'pass' ? 'Pass' : 'Fail'}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Member completion table */}
      <div>
        <h3 className="text-theme-text-primary mb-3 text-sm font-semibold">Member Completion</h3>
        {data.members.length === 0 ? (
          <p className="text-theme-text-muted py-4 text-sm">No member data available.</p>
        ) : (
          <div className="bg-theme-surface border-theme-surface-border overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-theme-surface-border bg-theme-surface-hover/50 border-b">
                  <th scope="col" className="text-theme-text-muted px-4 py-2 text-left text-xs font-medium">
                    Member
                  </th>
                  <th scope="col" className="text-theme-text-muted px-4 py-2 text-right text-xs font-medium">
                    Checks
                  </th>
                  <th scope="col" className="text-theme-text-muted px-4 py-2 text-right text-xs font-medium">
                    Pass
                  </th>
                  <th scope="col" className="text-theme-text-muted px-4 py-2 text-right text-xs font-medium">
                    Fail
                  </th>
                  <th scope="col" className="text-theme-text-muted px-4 py-2 text-right text-xs font-medium">
                    Rate
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.members.map((m) => {
                  const rate = m.checksCompleted > 0 ? Math.round((m.passCount / m.checksCompleted) * 100) : 0;
                  return (
                    <tr key={m.userId} className="border-theme-surface-border border-b last:border-0">
                      <td className="text-theme-text-primary px-4 py-2">{m.userName}</td>
                      <td className="text-theme-text-secondary px-4 py-2 text-right">{m.checksCompleted}</td>
                      <td className="px-4 py-2 text-right text-green-600">{m.passCount}</td>
                      <td className="px-4 py-2 text-right text-red-600">{m.failCount}</td>
                      <td className="text-theme-text-secondary px-4 py-2 text-right">{rate}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Failures Tab ───────────────────────────────────────────────────────────

const FailuresTab: React.FC<{ startDate: string; endDate: string; tz: string }> = ({ startDate, endDate, tz }) => {
  const [data, setData] = useState<FailureLogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await schedulingService.getFailureLog({
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
    const url = schedulingService.getReportExportUrl({
      report_type: 'failures',
      date_from: startDate,
      date_to: endDate,
    });
    window.open(url, '_blank');
  };

  const handleExportPdf = () => {
    const url = schedulingService.getReportPdfExportUrl({
      report_type: 'failures',
      date_from: startDate,
      date_to: endDate,
    });
    window.open(url, '_blank');
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="text-theme-text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
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
        <button
          onClick={handleExportCsv}
          className="bg-theme-surface border-theme-surface-border hover:bg-theme-surface-hover text-theme-text-secondary flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium"
        >
          <Download className="h-3.5 w-3.5" /> CSV
        </button>
        <button
          onClick={handleExportPdf}
          className="bg-theme-surface border-theme-surface-border hover:bg-theme-surface-hover text-theme-text-secondary flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium"
        >
          <FileText className="h-3.5 w-3.5" /> PDF
        </button>
      </div>

      {loading ? (
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
          <p className="text-theme-text-muted text-xs">{data.total} total failures</p>

          <div className="bg-theme-surface border-theme-surface-border overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-theme-surface-border bg-theme-surface-hover/50 border-b">
                  <th scope="col" className="text-theme-text-muted px-4 py-2 text-left text-xs font-medium">
                    Date
                  </th>
                  <th scope="col" className="text-theme-text-muted px-4 py-2 text-left text-xs font-medium">
                    Apparatus
                  </th>
                  <th scope="col" className="text-theme-text-muted px-4 py-2 text-left text-xs font-medium">
                    Compartment
                  </th>
                  <th scope="col" className="text-theme-text-muted px-4 py-2 text-left text-xs font-medium">
                    Item
                  </th>
                  <th scope="col" className="text-theme-text-muted px-4 py-2 text-left text-xs font-medium">
                    Checked By
                  </th>
                  <th scope="col" className="text-theme-text-muted px-4 py-2 text-left text-xs font-medium">
                    Notes
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((f: FailureLogRecord) => (
                  <tr key={f.id} className="border-theme-surface-border border-b last:border-0">
                    <td className="text-theme-text-secondary px-4 py-2 whitespace-nowrap">
                      {f.checkedAt ? formatDateTime(f.checkedAt, tz) : '-'}
                    </td>
                    <td className="text-theme-text-primary px-4 py-2">{f.apparatusName ?? '-'}</td>
                    <td className="text-theme-text-secondary px-4 py-2">{f.compartmentName}</td>
                    <td className="text-theme-text-primary px-4 py-2 font-medium">{f.itemName}</td>
                    <td className="text-theme-text-secondary px-4 py-2">{f.checkedByName ?? '-'}</td>
                    <td className="text-theme-text-muted max-w-[200px] truncate px-4 py-2 text-xs">{f.notes ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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

const TrendsTab: React.FC<{ startDate: string; endDate: string; tz: string }> = ({ startDate, endDate, tz }) => {
  const [templates, setTemplates] = useState<EquipmentCheckTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [selectedItemId, setSelectedItemId] = useState('');
  const [trendData, setTrendData] = useState<ItemTrendResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(true);

  // Load templates for the picker
  useEffect(() => {
    const load = async () => {
      try {
        const result = await schedulingService.getEquipmentCheckTemplates({});
        setTemplates(result);
      } catch {
        // silently handle
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
      return;
    }
    const load = async () => {
      setLoading(true);
      try {
        const result = await schedulingService.getItemTrends({
          template_item_id: selectedItemId,
          date_from: startDate,
          date_to: endDate,
        });
        setTrendData(result);
      } catch {
        // silently handle
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [selectedItemId, startDate, endDate]);

  // Reset item when template changes
  useEffect(() => {
    setSelectedItemId('');
  }, [selectedTemplateId]);

  const handleExport = () => {
    if (!selectedItemId) return;
    const url = schedulingService.getReportExportUrl({
      report_type: 'item-trends',
      template_item_id: selectedItemId,
      date_from: startDate,
      date_to: endDate,
    });
    window.open(url, '_blank');
  };

  const selectClass =
    'px-3 py-2 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-hidden focus:ring-1 focus:ring-violet-500';

  return (
    <div className="space-y-5">
      {/* Template + Item selectors */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <select
          value={selectedTemplateId}
          onChange={(e) => setSelectedTemplateId(e.target.value)}
          disabled={loadingTemplates}
          className={`flex-1 ${selectClass}`}
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
        >
          <option value="">Select an item...</option>
          {allItems.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>

        {trendData && (
          <button
            onClick={handleExport}
            className="bg-theme-surface border-theme-surface-border hover:bg-theme-surface-hover text-theme-text-secondary flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium"
          >
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
        )}
      </div>

      {/* Content */}
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
            <div className="bg-theme-surface border-theme-surface-border rounded-xl border p-4">
              <div className="flex h-40 items-end gap-1">
                {trendData.trends.map((entry) => {
                  const total = entry.passCount + entry.failCount + entry.notApplicableCount + entry.notCheckedCount;
                  const maxHeight = 128;
                  const passH = total > 0 ? (entry.passCount / total) * maxHeight : 0;
                  const failH = total > 0 ? (entry.failCount / total) * maxHeight : 0;
                  const notApplicableH = total > 0 ? (entry.notApplicableCount / total) * maxHeight : 0;
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
                        {notCheckedH > 0 && (
                          <div
                            className="bg-theme-text-muted/40 w-full rounded-t-sm"
                            style={{ height: notCheckedH }}
                            title={`Not checked: ${entry.notCheckedCount}`}
                          />
                        )}
                        {notApplicableH > 0 && (
                          <div
                            className="w-full rounded-t-sm bg-slate-400"
                            style={{ height: notApplicableH }}
                            title={`Not applicable: ${entry.notApplicableCount}`}
                          />
                        )}
                      </div>
                      <span className="text-theme-text-muted max-w-[40px] truncate text-[10px]">{entry.period}</span>
                    </div>
                  );
                })}
              </div>
              <div className="text-theme-text-muted mt-3 flex items-center gap-4 text-xs">
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-sm bg-slate-400" /> Not applicable
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-sm bg-green-500" /> Pass
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-sm bg-red-500" /> Fail
                </span>
                <span className="flex items-center gap-1">
                  <span className="bg-theme-text-muted/40 h-2.5 w-2.5 rounded-sm" /> Not checked
                </span>
              </div>
            </div>
          ) : (
            <p className="text-theme-text-muted text-sm">No trend data for this period.</p>
          )}

          {/* History table */}
          {trendData.history.length > 0 && (
            <div>
              <h4 className="text-theme-text-secondary mb-2 text-xs font-semibold">Check History</h4>
              <div className="bg-theme-surface border-theme-surface-border overflow-x-auto rounded-xl border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-theme-surface-border bg-theme-surface-hover/50 border-b">
                      <th scope="col" className="text-theme-text-muted px-4 py-2 text-left text-xs font-medium">
                        Date
                      </th>
                      <th scope="col" className="text-theme-text-muted px-4 py-2 text-left text-xs font-medium">
                        Status
                      </th>
                      <th scope="col" className="text-theme-text-muted px-4 py-2 text-left text-xs font-medium">
                        Checked By
                      </th>
                      <th scope="col" className="text-theme-text-muted px-4 py-2 text-left text-xs font-medium">
                        Notes
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {trendData.history.map((h) => (
                      <tr key={h.checkId} className="border-theme-surface-border border-b last:border-0">
                        <td className="text-theme-text-secondary px-4 py-2 whitespace-nowrap">
                          {h.checkedAt ? formatDateTime(h.checkedAt, tz) : '-'}
                        </td>
                        <td className="px-4 py-2">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
                              h.status === 'pass'
                                ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                                : h.status === 'fail' || h.status === 'out_of_service'
                                  ? 'bg-red-500/10 text-red-700 dark:text-red-400'
                                  : 'bg-theme-surface-hover text-theme-text-muted'
                            }`}
                          >
                            {h.status === 'pass' ? <CheckCircle className="h-3 w-3" /> : null}
                            {h.status === 'fail' || h.status === 'out_of_service' ? (
                              <XCircle className="h-3 w-3" />
                            ) : null}
                            {h.status === 'not_applicable'
                              ? 'Not applicable'
                              : h.status === 'out_of_service'
                                ? 'Out of service'
                                : h.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="text-theme-text-secondary px-4 py-2">{h.checkedByName ?? '-'}</td>
                        <td className="text-theme-text-muted max-w-[200px] truncate px-4 py-2 text-xs">
                          {h.notes ?? '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
};

// ─── Stat Card Component ────────────────────────────────────────────────────

const StatCard: React.FC<{ label: string; value: string; color?: 'green' | 'amber' | 'red' | undefined }> = ({
  label,
  value,
  color,
}) => {
  const colorClasses = {
    green: 'text-green-600 dark:text-green-400',
    amber: 'text-amber-600 dark:text-amber-400',
    red: 'text-red-600 dark:text-red-400',
  };

  return (
    <div className="bg-theme-surface border-theme-surface-border rounded-xl border p-4 text-center">
      <p className="mb-0.5 text-2xl font-bold">
        <span className={color ? colorClasses[color] : 'text-theme-text-primary'}>{value}</span>
      </p>
      <p className="text-theme-text-muted text-xs">{label}</p>
    </div>
  );
};

export default EquipmentCheckReportsPage;
