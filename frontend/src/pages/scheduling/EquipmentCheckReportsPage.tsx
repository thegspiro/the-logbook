/**
 * Equipment Check Reports Page
 *
 * Three-tab reports page: Compliance Dashboard, Failure/Deficiency Log,
 * and Item Trend History. Includes CSV and PDF export support.
 */

import React, { useState, useEffect, useCallback } from 'react';
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
import { useNavigate } from 'react-router-dom';
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
    <div className="min-h-screen bg-theme-bg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => void navigate('/scheduling')}
            className="p-1.5 rounded-lg hover:bg-theme-surface-hover text-theme-text-muted"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-violet-500" />
            <h1 className="text-xl font-bold text-theme-text-primary">
              Equipment Check Reports
            </h1>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-5 bg-theme-surface border border-theme-surface-border rounded-xl p-1">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-colors flex-1 justify-center ${
                  activeTab === tab.id
                    ? 'bg-violet-600 text-white'
                    : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover'
                }`}
              >
                <Icon className="w-4 h-4" />
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
        {activeTab === 'compliance' && (
          <ComplianceTab startDate={startDate} endDate={endDate} tz={tz} />
        )}
        {activeTab === 'failures' && (
          <FailuresTab startDate={startDate} endDate={endDate} tz={tz} />
        )}
        {activeTab === 'trends' && (
          <TrendsTab startDate={startDate} endDate={endDate} tz={tz} />
        )}
      </div>
    </div>
  );
};

// ─── Compliance Tab ─────────────────────────────────────────────────────────

const ComplianceTab: React.FC<{ startDate: string; endDate: string; tz: string }> = ({
  startDate,
  endDate,
  tz,
}) => {
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
      <div className="flex items-center justify-center py-12 text-theme-text-muted">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading compliance data...
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-5">
      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-theme-surface border border-theme-surface-border rounded-lg hover:bg-theme-surface-hover text-theme-text-secondary"
        >
          <Download className="w-3.5 h-3.5" /> CSV
        </button>
        <button
          onClick={handleExportPdf}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-theme-surface border border-theme-surface-border rounded-lg hover:bg-theme-surface-hover text-theme-text-secondary"
        >
          <FileText className="w-3.5 h-3.5" /> PDF
        </button>
      </div>

      {/* Apparatus compliance cards */}
      <div>
        <h3 className="text-sm font-semibold text-theme-text-primary mb-3">Apparatus Compliance</h3>
        {data.apparatus.length === 0 ? (
          <p className="text-sm text-theme-text-muted py-4">No apparatus data available.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.apparatus.map((a) => (
              <div
                key={a.apparatusId}
                className="bg-theme-surface border border-theme-surface-border rounded-xl p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-theme-text-primary">{a.apparatusName}</span>
                  {a.hasDeficiency && (
                    <span className="px-1.5 py-0.5 text-xs bg-red-500/10 text-red-700 dark:text-red-400 rounded-full">
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
                      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full ${
                        a.lastStatus === 'pass'
                          ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                          : 'bg-red-500/10 text-red-700 dark:text-red-400'
                      }`}
                    >
                      {a.lastStatus === 'pass' ? (
                        <CheckCircle className="w-3 h-3" />
                      ) : (
                        <XCircle className="w-3 h-3" />
                      )}
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
        <h3 className="text-sm font-semibold text-theme-text-primary mb-3">Member Completion</h3>
        {data.members.length === 0 ? (
          <p className="text-sm text-theme-text-muted py-4">No member data available.</p>
        ) : (
          <div className="bg-theme-surface border border-theme-surface-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-theme-surface-border bg-theme-surface-hover/50">
                  <th className="text-left px-4 py-2 text-xs font-medium text-theme-text-muted">Member</th>
                  <th className="text-right px-4 py-2 text-xs font-medium text-theme-text-muted">Checks</th>
                  <th className="text-right px-4 py-2 text-xs font-medium text-theme-text-muted">Pass</th>
                  <th className="text-right px-4 py-2 text-xs font-medium text-theme-text-muted">Fail</th>
                  <th className="text-right px-4 py-2 text-xs font-medium text-theme-text-muted">Rate</th>
                </tr>
              </thead>
              <tbody>
                {data.members.map((m) => {
                  const rate = m.checksCompleted > 0
                    ? Math.round((m.passCount / m.checksCompleted) * 100)
                    : 0;
                  return (
                    <tr key={m.userId} className="border-b border-theme-surface-border last:border-0">
                      <td className="px-4 py-2 text-theme-text-primary">{m.userName}</td>
                      <td className="px-4 py-2 text-right text-theme-text-secondary">{m.checksCompleted}</td>
                      <td className="px-4 py-2 text-right text-green-600">{m.passCount}</td>
                      <td className="px-4 py-2 text-right text-red-600">{m.failCount}</td>
                      <td className="px-4 py-2 text-right text-theme-text-secondary">{rate}%</td>
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

const FailuresTab: React.FC<{ startDate: string; endDate: string; tz: string }> = ({
  startDate,
  endDate,
  tz,
}) => {
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

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [startDate, endDate, searchTerm]);

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
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" />
          <input
            type="text"
            placeholder="Search by item name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-hidden focus:ring-1 focus:ring-violet-500"
          />
        </div>
        <button
          onClick={handleExportCsv}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-theme-surface border border-theme-surface-border rounded-lg hover:bg-theme-surface-hover text-theme-text-secondary"
        >
          <Download className="w-3.5 h-3.5" /> CSV
        </button>
        <button
          onClick={handleExportPdf}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-theme-surface border border-theme-surface-border rounded-lg hover:bg-theme-surface-hover text-theme-text-secondary"
        >
          <FileText className="w-3.5 h-3.5" /> PDF
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-theme-text-muted">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading failures...
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="text-center py-12 text-theme-text-muted">
          <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No failed items found for this period.</p>
        </div>
      ) : (
        <>
          <p className="text-xs text-theme-text-muted">{data.total} total failures</p>

          <div className="bg-theme-surface border border-theme-surface-border rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-theme-surface-border bg-theme-surface-hover/50">
                  <th className="text-left px-4 py-2 text-xs font-medium text-theme-text-muted">Date</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-theme-text-muted">Apparatus</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-theme-text-muted">Compartment</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-theme-text-muted">Item</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-theme-text-muted">Checked By</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-theme-text-muted">Notes</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((f: FailureLogRecord) => (
                  <tr key={f.id} className="border-b border-theme-surface-border last:border-0">
                    <td className="px-4 py-2 text-theme-text-secondary whitespace-nowrap">
                      {f.checkedAt ? formatDateTime(f.checkedAt, tz) : '-'}
                    </td>
                    <td className="px-4 py-2 text-theme-text-primary">{f.apparatusName ?? '-'}</td>
                    <td className="px-4 py-2 text-theme-text-secondary">{f.compartmentName}</td>
                    <td className="px-4 py-2 text-theme-text-primary font-medium">{f.itemName}</td>
                    <td className="px-4 py-2 text-theme-text-secondary">{f.checkedByName ?? '-'}</td>
                    <td className="px-4 py-2 text-theme-text-muted text-xs max-w-[200px] truncate">
                      {f.notes ?? '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.total > PAGE_SIZE && (
            <Pagination
              currentPage={page}
              totalItems={data.total}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
            />
          )}
        </>
      )}
    </div>
  );
};

// ─── Trends Tab ─────────────────────────────────────────────────────────────

const TrendsTab: React.FC<{ startDate: string; endDate: string; tz: string }> = ({
  startDate,
  endDate,
  tz,
}) => {
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
      <div className="flex flex-col sm:flex-row gap-3">
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
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-theme-surface border border-theme-surface-border rounded-lg hover:bg-theme-surface-hover text-theme-text-secondary"
          >
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
        )}
      </div>

      {/* Content */}
      {!selectedItemId ? (
        <div className="text-center py-12 text-theme-text-muted">
          <TrendingUp className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Select a template and item to view trend data.</p>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-12 text-theme-text-muted">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading trend data...
        </div>
      ) : trendData ? (
        <>
          <h3 className="text-sm font-semibold text-theme-text-primary">
            Trend: {trendData.itemName}
          </h3>

          {/* Bar chart visualization */}
          {trendData.trends.length > 0 ? (
            <div className="bg-theme-surface border border-theme-surface-border rounded-xl p-4">
              <div className="flex items-end gap-1 h-40">
                {trendData.trends.map((entry) => {
                  const total = entry.passCount + entry.failCount + entry.notCheckedCount;
                  const maxHeight = 128;
                  const passH = total > 0 ? (entry.passCount / total) * maxHeight : 0;
                  const failH = total > 0 ? (entry.failCount / total) * maxHeight : 0;
                  return (
                    <div key={entry.period} className="flex-1 flex flex-col items-center gap-0.5">
                      <div className="flex flex-col-reverse w-full max-w-[32px]" style={{ height: maxHeight }}>
                        {passH > 0 && (
                          <div
                            className="bg-green-500 rounded-t-sm w-full"
                            style={{ height: passH }}
                            title={`Pass: ${entry.passCount}`}
                          />
                        )}
                        {failH > 0 && (
                          <div
                            className="bg-red-500 w-full"
                            style={{ height: failH }}
                            title={`Fail: ${entry.failCount}`}
                          />
                        )}
                      </div>
                      <span className="text-[10px] text-theme-text-muted truncate max-w-[40px]">
                        {entry.period}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-4 mt-3 text-xs text-theme-text-muted">
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm bg-green-500" /> Pass
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm bg-red-500" /> Fail
                </span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-theme-text-muted">No trend data for this period.</p>
          )}

          {/* History table */}
          {trendData.history.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-theme-text-secondary mb-2">Check History</h4>
              <div className="bg-theme-surface border border-theme-surface-border rounded-xl overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-theme-surface-border bg-theme-surface-hover/50">
                      <th className="text-left px-4 py-2 text-xs font-medium text-theme-text-muted">Date</th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-theme-text-muted">Status</th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-theme-text-muted">Checked By</th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-theme-text-muted">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trendData.history.map((h) => (
                      <tr key={h.checkId} className="border-b border-theme-surface-border last:border-0">
                        <td className="px-4 py-2 text-theme-text-secondary whitespace-nowrap">
                          {h.checkedAt ? formatDateTime(h.checkedAt, tz) : '-'}
                        </td>
                        <td className="px-4 py-2">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full ${
                              h.status === 'pass'
                                ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                                : h.status === 'fail'
                                  ? 'bg-red-500/10 text-red-700 dark:text-red-400'
                                  : 'bg-theme-surface-hover text-theme-text-muted'
                            }`}
                          >
                            {h.status === 'pass' ? <CheckCircle className="w-3 h-3" /> : null}
                            {h.status === 'fail' ? <XCircle className="w-3 h-3" /> : null}
                            {h.status}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-theme-text-secondary">{h.checkedByName ?? '-'}</td>
                        <td className="px-4 py-2 text-theme-text-muted text-xs max-w-[200px] truncate">
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
    <div className="bg-theme-surface border border-theme-surface-border rounded-xl p-4 text-center">
      <p className="text-2xl font-bold mb-0.5">
        <span className={color ? colorClasses[color] : 'text-theme-text-primary'}>{value}</span>
      </p>
      <p className="text-xs text-theme-text-muted">{label}</p>
    </div>
  );
};

export default EquipmentCheckReportsPage;
