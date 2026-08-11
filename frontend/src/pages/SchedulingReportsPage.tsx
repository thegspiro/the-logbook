/**
 * Scheduling Reports Page
 *
 * Displays scheduling reports and member availability data.
 * Tabs: Member Hours, Coverage, Call Volume, Availability.
 * Each tab has date range filters and displays tabular data.
 */

import React, { useState, useCallback, useEffect } from 'react';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../utils/errorHandling';
import { useRanks } from '../hooks/useRanks';
import {
  BarChart3,
  Clock,
  Shield,
  Phone,
  Users,
  RefreshCw,
  Search,
  AlertCircle,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { schedulingService } from '../modules/scheduling/services/api';
import type { RequirementComplianceSummary } from '../modules/scheduling/services/api';
import type {
  MemberHoursReport,
  CoverageReportEntry,
  CallVolumeReportEntry,
  AvailabilityRecord,
} from '../modules/scheduling/types';
import { useTimezone } from '../hooks/useTimezone';
import { formatDate, getTodayLocalDate, toLocalDateString } from '../utils/dateFormatting';
import { DateRangePicker } from '../components/ux/DateRangePicker';

type TabView = 'member-hours' | 'coverage' | 'call-volume' | 'availability' | 'compliance';

// ============================================
// Date Range Filter Component
// ============================================

interface DateRangeFilterProps {
  startDate: string;
  endDate: string;
  onStartChange: (v: string) => void;
  onEndChange: (v: string) => void;
  onSearch: () => void;
  loading: boolean;
  extraControls?: React.ReactNode;
}

const DateRangeFilter: React.FC<DateRangeFilterProps> = ({
  startDate,
  endDate,
  onStartChange,
  onEndChange,
  onSearch,
  loading,
  extraControls,
}) => {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch();
  };

  return (
    <form onSubmit={handleSubmit} className="card-secondary mb-6 flex flex-wrap items-end gap-3 p-4">
      {/* Two bare mm/dd/yyyy boxes with no default meant every visit to every
          one of these five reports began with typing. The app's own picker
          carries the presets, and the range arrives filled in. */}
      <DateRangePicker
        label="Dates covered"
        startDate={startDate}
        endDate={endDate}
        onChange={(s, e) => {
          onStartChange(s);
          onEndChange(e);
        }}
      />
      {extraControls}
      <button
        type="submit"
        disabled={loading || !startDate || !endDate}
        className="btn-primary flex items-center gap-2"
      >
        {loading ? (
          <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Search className="h-4 w-4" aria-hidden="true" />
        )}
        {loading ? 'Loading...' : 'Generate Report'}
      </button>
    </form>
  );
};

// ============================================
// Summary Stats Component
// ============================================

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
}

const StatCard: React.FC<StatCardProps> = ({ label, value, icon }) => (
  <div className="bg-theme-surface border-theme-surface-border rounded-lg border p-4">
    <div className="flex items-center gap-3">
      <div className="bg-theme-surface-secondary rounded-lg p-2">{icon}</div>
      <div>
        <p className="text-theme-text-muted text-xs">{label}</p>
        <p className="text-theme-text-primary text-xl font-bold">{value}</p>
      </div>
    </div>
  </div>
);

// ============================================
// Main Page
// ============================================

export const SchedulingReportsPage: React.FC = () => {
  const tz = useTimezone();
  const { formatRank } = useRanks();
  const [activeTab, setActiveTab] = useState<TabView>('member-hours');

  // Date ranges. Defaulted to this month: a report that opens on two empty
  // boxes makes the reader do setup work before it will say anything at all.
  const [startDate, setStartDate] = useState(() => {
    const now = new Date();
    return toLocalDateString(new Date(now.getFullYear(), now.getMonth(), 1), tz);
  });
  const [endDate, setEndDate] = useState(() => getTodayLocalDate(tz));
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Member Hours state
  const [memberHoursReport, setMemberHoursReport] = useState<MemberHoursReport | null>(null);

  // Coverage state
  const [coverageData, setCoverageData] = useState<CoverageReportEntry[]>([]);

  // Call Volume state
  const [callVolumeData, setCallVolumeData] = useState<CallVolumeReportEntry[]>([]);
  const [groupBy, setGroupBy] = useState('day');

  // Availability state
  const [availabilityData, setAvailabilityData] = useState<AvailabilityRecord[]>([]);

  // Compliance state
  const [complianceData, setComplianceData] = useState<RequirementComplianceSummary[]>([]);
  const [complianceRefDate, setComplianceRefDate] = useState('');
  const [expandedRequirements, setExpandedRequirements] = useState<Set<string>>(new Set());
  const [complianceFilter, setComplianceFilter] = useState<'all' | 'non-compliant'>('all');

  // Reset when tab changes
  const handleTabChange = (tab: TabView) => {
    setActiveTab(tab);
    setHasSearched(false);
    setMemberHoursReport(null);
    setCoverageData([]);
    setCallVolumeData([]);
    setAvailabilityData([]);
    setComplianceData([]);
    setExpandedRequirements(new Set());
  };

  // Load Member Hours
  const loadMemberHours = useCallback(async () => {
    setLoading(true);
    setHasSearched(true);
    try {
      const data = await schedulingService.getMemberHoursReport({ start_date: startDate, end_date: endDate });
      setMemberHoursReport(data);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load member hours report'));
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  // Load Coverage
  const loadCoverage = useCallback(async () => {
    setLoading(true);
    setHasSearched(true);
    try {
      const data = await schedulingService.getCoverageReport({ start_date: startDate, end_date: endDate });
      setCoverageData(data);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load coverage report'));
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  // Load Call Volume
  const loadCallVolume = useCallback(async () => {
    setLoading(true);
    setHasSearched(true);
    try {
      const data = await schedulingService.getCallVolumeReport({
        start_date: startDate,
        end_date: endDate,
        group_by: groupBy,
      });
      setCallVolumeData(data);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load call volume report'));
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, groupBy]);

  // Load Availability
  const loadAvailability = useCallback(async () => {
    setLoading(true);
    setHasSearched(true);
    try {
      const data = await schedulingService.getAvailability({ start_date: startDate, end_date: endDate });
      setAvailabilityData(data);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load availability'));
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  // Load Compliance
  const loadCompliance = useCallback(async () => {
    setLoading(true);
    setHasSearched(true);
    try {
      const params: Record<string, string> = {};
      if (complianceRefDate) params.reference_date = complianceRefDate;
      const data = await schedulingService.getComplianceReport(params);
      setComplianceData(data.requirements || []);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load compliance report'));
    } finally {
      setLoading(false);
    }
  }, [complianceRefDate]);

  const toggleRequirement = (reqId: string) => {
    setExpandedRequirements((prev) => {
      const next = new Set(prev);
      if (next.has(reqId)) {
        next.delete(reqId);
      } else {
        next.add(reqId);
      }
      return next;
    });
  };

  const handleSearch = useCallback(() => {
    switch (activeTab) {
      case 'member-hours':
        void loadMemberHours();
        break;
      case 'coverage':
        void loadCoverage();
        break;
      case 'call-volume':
        void loadCallVolume();
        break;
      case 'availability':
        void loadAvailability();
        break;
      case 'compliance':
        void loadCompliance();
        break;
    }
  }, [activeTab, loadMemberHours, loadCoverage, loadCallVolume, loadAvailability, loadCompliance]);

  /**
   * Run the active report as soon as there is a range to run it over — on
   * arrival, and again when a tab switch clears the previous tab's data. Each
   * loader sets `hasSearched` before it awaits, so a failed load does not
   * re-trigger this.
   */
  useEffect(() => {
    if (!startDate || !endDate || hasSearched || loading) return;
    handleSearch();
  }, [startDate, endDate, hasSearched, loading, handleSearch]);

  const formatResponseTime = (seconds?: number) => {
    if (!seconds) return '-';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}m ${s}s`;
  };

  return (
    <div className="mx-auto max-w-7xl p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-theme-text-primary flex items-center gap-3 text-2xl font-bold">
          <BarChart3 className="h-7 w-7" aria-hidden="true" />
          Scheduling Reports
        </h1>
        <p className="text-theme-text-muted mt-1">View scheduling analytics, member hours, and coverage data</p>
      </div>

      {/* Tabs */}
      <div className="tab-scroll mb-6" role="tablist" aria-label="Scheduling reports">
        <button
          onClick={() => handleTabChange('member-hours')}
          role="tab"
          aria-selected={activeTab === 'member-hours'}
          className={`px-4 py-3 text-sm font-medium ${
            activeTab === 'member-hours'
              ? 'border-b-2 border-red-500 text-red-700 dark:text-red-500'
              : 'text-theme-text-muted hover:text-theme-text-primary'
          }`}
        >
          <Clock className="mr-2 inline-block h-4 w-4" aria-hidden="true" />
          Member Hours
        </button>
        <button
          onClick={() => handleTabChange('coverage')}
          role="tab"
          aria-selected={activeTab === 'coverage'}
          className={`px-4 py-3 text-sm font-medium ${
            activeTab === 'coverage'
              ? 'border-b-2 border-red-500 text-red-700 dark:text-red-500'
              : 'text-theme-text-muted hover:text-theme-text-primary'
          }`}
        >
          <Shield className="mr-2 inline-block h-4 w-4" aria-hidden="true" />
          Coverage
        </button>
        <button
          onClick={() => handleTabChange('call-volume')}
          role="tab"
          aria-selected={activeTab === 'call-volume'}
          className={`px-4 py-3 text-sm font-medium ${
            activeTab === 'call-volume'
              ? 'border-b-2 border-red-500 text-red-700 dark:text-red-500'
              : 'text-theme-text-muted hover:text-theme-text-primary'
          }`}
        >
          <Phone className="mr-2 inline-block h-4 w-4" aria-hidden="true" />
          Call Volume
        </button>
        <button
          onClick={() => handleTabChange('availability')}
          role="tab"
          aria-selected={activeTab === 'availability'}
          className={`px-4 py-3 text-sm font-medium ${
            activeTab === 'availability'
              ? 'border-b-2 border-red-500 text-red-700 dark:text-red-500'
              : 'text-theme-text-muted hover:text-theme-text-primary'
          }`}
        >
          <Users className="mr-2 inline-block h-4 w-4" aria-hidden="true" />
          Availability
        </button>
        <button
          onClick={() => handleTabChange('compliance')}
          role="tab"
          aria-selected={activeTab === 'compliance'}
          className={`px-4 py-3 text-sm font-medium ${
            activeTab === 'compliance'
              ? 'border-b-2 border-red-500 text-red-700 dark:text-red-500'
              : 'text-theme-text-muted hover:text-theme-text-primary'
          }`}
        >
          <CheckCircle2 className="mr-2 inline-block h-4 w-4" aria-hidden="true" />
          Shift Compliance
        </button>
      </div>

      {/* ============================== */}
      {/* Member Hours Tab */}
      {/* ============================== */}
      {activeTab === 'member-hours' && (
        <div role="tabpanel">
          <DateRangeFilter
            startDate={startDate}
            endDate={endDate}
            onStartChange={setStartDate}
            onEndChange={setEndDate}
            onSearch={handleSearch}
            loading={loading}
          />

          {!hasSearched ? (
            <div className="card-secondary py-12 text-center">
              <Clock className="text-theme-text-muted mx-auto mb-4 h-12 w-12" aria-hidden="true" />
              <h3 className="text-theme-text-primary mb-2 text-lg font-semibold">Pick the dates to cover</h3>
              <p className="text-theme-text-muted">Choose start and end dates to generate the member hours report</p>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
              <RefreshCw className="text-theme-text-muted h-8 w-8 animate-spin" aria-hidden="true" />
              <span className="sr-only">Loading report...</span>
            </div>
          ) : memberHoursReport ? (
            <div>
              {/* Summary Stats */}
              <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
                <StatCard
                  label="Total Members"
                  value={memberHoursReport.total_members}
                  icon={<Users className="text-theme-text-muted h-5 w-5" aria-hidden="true" />}
                />
                <StatCard
                  label="Period"
                  value={`${formatDate(memberHoursReport.period_start, tz)} - ${formatDate(memberHoursReport.period_end, tz)}`}
                  icon={<Clock className="text-theme-text-muted h-5 w-5" aria-hidden="true" />}
                />
                <StatCard
                  label="Shifts Worked"
                  value={memberHoursReport.members.reduce((sum, m) => sum + m.shifts_attended, 0)}
                  icon={<Shield className="text-theme-text-muted h-5 w-5" aria-hidden="true" />}
                />
                <StatCard
                  label="Hours Worked"
                  value={memberHoursReport.members.reduce((sum, m) => sum + m.worked_hours, 0).toFixed(1)}
                  icon={<BarChart3 className="text-theme-text-muted h-5 w-5" aria-hidden="true" />}
                />
              </div>

              {/* Say what the numbers are, so nobody has to infer it from a
                  column header that could mean either measure. */}
              <p className="text-theme-text-muted mb-4 text-xs">
                Hours worked are measured from shift check-in and check-out. Scheduled hours are the assigned shift
                length — shown for comparison, since a shift can run short or long, or be assigned and not worked.
              </p>

              {/* Table */}
              {memberHoursReport.members.length === 0 ? (
                <div className="card-secondary py-8 text-center">
                  <AlertCircle className="text-theme-text-muted mx-auto mb-3 h-10 w-10" aria-hidden="true" />
                  <p className="text-theme-text-muted">No data for this period</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-theme-surface-border border-b">
                        <th scope="col" className="text-theme-text-secondary px-4 py-3 text-left font-medium">
                          Member
                        </th>
                        <th scope="col" className="text-theme-text-secondary px-4 py-3 text-right font-medium">
                          Shifts Worked
                        </th>
                        <th scope="col" className="text-theme-text-secondary px-4 py-3 text-right font-medium">
                          Hours Worked
                        </th>
                        <th scope="col" className="text-theme-text-secondary px-4 py-3 text-right font-medium">
                          Scheduled Hours
                        </th>
                        <th scope="col" className="text-theme-text-secondary px-4 py-3 text-right font-medium">
                          Difference
                        </th>
                        <th scope="col" className="text-theme-text-secondary px-4 py-3 text-right font-medium">
                          Avg Per Shift
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {memberHoursReport.members.map((m) => (
                        <tr
                          key={m.user_id}
                          className="border-theme-surface-border hover:bg-theme-surface-hover border-b"
                        >
                          <td className="px-4 py-3">
                            <div>
                              <p className="text-theme-text-primary font-medium">
                                {m.first_name || m.last_name ? `${m.first_name} ${m.last_name}`.trim() : m.email}
                              </p>
                              <p className="text-theme-text-muted text-xs">{m.email}</p>
                            </div>
                          </td>
                          <td className="text-theme-text-primary px-4 py-3 text-right">{m.shifts_attended}</td>
                          <td className="text-theme-text-primary px-4 py-3 text-right font-medium">
                            {m.worked_hours.toFixed(1)}
                          </td>
                          <td className="text-theme-text-secondary px-4 py-3 text-right">
                            {m.scheduled_hours.toFixed(1)}
                          </td>
                          <td className="text-theme-text-secondary px-4 py-3 text-right">
                            {m.worked_hours - m.scheduled_hours >= 0 ? '+' : ''}
                            {(m.worked_hours - m.scheduled_hours).toFixed(1)}
                          </td>
                          <td className="text-theme-text-muted px-4 py-3 text-right">
                            {m.shifts_attended > 0 ? (m.worked_hours / m.shifts_attended).toFixed(1) : '0'}h
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div className="card-secondary py-8 text-center">
              <AlertCircle className="text-theme-text-muted mx-auto mb-3 h-10 w-10" aria-hidden="true" />
              <p className="text-theme-text-muted">No report data available</p>
            </div>
          )}
        </div>
      )}

      {/* ============================== */}
      {/* Coverage Tab */}
      {/* ============================== */}
      {activeTab === 'coverage' && (
        <div role="tabpanel">
          <DateRangeFilter
            startDate={startDate}
            endDate={endDate}
            onStartChange={setStartDate}
            onEndChange={setEndDate}
            onSearch={handleSearch}
            loading={loading}
          />

          {!hasSearched ? (
            <div className="card-secondary py-12 text-center">
              <Shield className="text-theme-text-muted mx-auto mb-4 h-12 w-12" aria-hidden="true" />
              <h3 className="text-theme-text-primary mb-2 text-lg font-semibold">Pick the dates to cover</h3>
              <p className="text-theme-text-muted">Choose start and end dates to view shift coverage data</p>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
              <RefreshCw className="text-theme-text-muted h-8 w-8 animate-spin" aria-hidden="true" />
              <span className="sr-only">Loading report...</span>
            </div>
          ) : coverageData.length === 0 ? (
            <div className="card-secondary py-8 text-center">
              <AlertCircle className="text-theme-text-muted mx-auto mb-3 h-10 w-10" aria-hidden="true" />
              <p className="text-theme-text-muted">No coverage data for this period</p>
            </div>
          ) : (
            <div>
              {/* Summary Stats */}
              <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
                <StatCard
                  label="Total Days"
                  value={coverageData.length}
                  icon={<BarChart3 className="text-theme-text-muted h-5 w-5" aria-hidden="true" />}
                />
                <StatCard
                  label="Total Shifts"
                  value={coverageData.reduce((sum, d) => sum + d.total_shifts, 0)}
                  icon={<Shield className="text-theme-text-muted h-5 w-5" aria-hidden="true" />}
                />
                <StatCard
                  label="Confirmed"
                  value={coverageData.reduce((sum, d) => sum + d.total_confirmed, 0)}
                  icon={<Users className="text-theme-text-muted h-5 w-5" aria-hidden="true" />}
                />
                <StatCard
                  label="Understaffed"
                  value={coverageData.reduce((sum, d) => sum + d.understaffed_shifts, 0)}
                  icon={<AlertCircle className="text-theme-text-muted h-5 w-5" aria-hidden="true" />}
                />
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-theme-surface-border border-b">
                      <th scope="col" className="text-theme-text-secondary px-4 py-3 text-left font-medium">
                        Date
                      </th>
                      <th scope="col" className="text-theme-text-secondary px-4 py-3 text-right font-medium">
                        Total Shifts
                      </th>
                      <th scope="col" className="text-theme-text-secondary px-4 py-3 text-right font-medium">
                        Assigned
                      </th>
                      <th scope="col" className="text-theme-text-secondary px-4 py-3 text-right font-medium">
                        Confirmed
                      </th>
                      <th scope="col" className="text-theme-text-secondary px-4 py-3 text-right font-medium">
                        Understaffed
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {coverageData.map((row, idx) => (
                      <tr key={idx} className="border-theme-surface-border hover:bg-theme-surface-hover border-b">
                        <td className="text-theme-text-primary px-4 py-3 font-medium">{formatDate(row.date, tz)}</td>
                        <td className="text-theme-text-primary px-4 py-3 text-right">{row.total_shifts}</td>
                        <td className="text-theme-text-secondary px-4 py-3 text-right">{row.total_assigned}</td>
                        <td className="px-4 py-3 text-right">
                          <span className="inline-flex items-center rounded-sm bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-500/20 dark:text-green-400">
                            {row.total_confirmed}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {row.understaffed_shifts > 0 ? (
                            <span className="inline-flex items-center rounded-sm bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-500/20 dark:text-red-400">
                              {row.understaffed_shifts}
                            </span>
                          ) : (
                            <span className="text-theme-text-muted">0</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============================== */}
      {/* Call Volume Tab */}
      {/* ============================== */}
      {activeTab === 'call-volume' && (
        <div role="tabpanel">
          <DateRangeFilter
            startDate={startDate}
            endDate={endDate}
            onStartChange={setStartDate}
            onEndChange={setEndDate}
            onSearch={handleSearch}
            loading={loading}
            extraControls={
              <div>
                <label htmlFor="call-group-by" className="text-theme-text-secondary mb-1 block text-sm font-medium">
                  Group By
                </label>
                <select
                  id="call-group-by"
                  value={groupBy}
                  onChange={(e) => setGroupBy(e.target.value)}
                  className="form-input"
                >
                  <option value="day">Day</option>
                  <option value="week">Week</option>
                  <option value="month">Month</option>
                </select>
              </div>
            }
          />

          {!hasSearched ? (
            <div className="card-secondary py-12 text-center">
              <Phone className="text-theme-text-muted mx-auto mb-4 h-12 w-12" aria-hidden="true" />
              <h3 className="text-theme-text-primary mb-2 text-lg font-semibold">Pick the dates to cover</h3>
              <p className="text-theme-text-muted">Choose start and end dates to view call volume data</p>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
              <RefreshCw className="text-theme-text-muted h-8 w-8 animate-spin" aria-hidden="true" />
              <span className="sr-only">Loading report...</span>
            </div>
          ) : callVolumeData.length === 0 ? (
            <div className="card-secondary py-8 text-center">
              <AlertCircle className="text-theme-text-muted mx-auto mb-3 h-10 w-10" aria-hidden="true" />
              <p className="text-theme-text-muted">No call volume data for this period</p>
            </div>
          ) : (
            <div>
              {/* Summary Stats */}
              <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3">
                <StatCard
                  label="Total Calls"
                  value={callVolumeData.reduce((sum, d) => sum + d.total_calls, 0)}
                  icon={<Phone className="text-theme-text-muted h-5 w-5" aria-hidden="true" />}
                />
                <StatCard
                  label="Periods"
                  value={callVolumeData.length}
                  icon={<BarChart3 className="text-theme-text-muted h-5 w-5" aria-hidden="true" />}
                />
                <StatCard
                  label="Avg Response"
                  value={formatResponseTime(
                    callVolumeData.filter((d) => d.avg_response_seconds).length > 0
                      ? callVolumeData.reduce((sum, d) => sum + (d.avg_response_seconds || 0), 0) /
                          callVolumeData.filter((d) => d.avg_response_seconds).length
                      : undefined
                  )}
                  icon={<Clock className="text-theme-text-muted h-5 w-5" aria-hidden="true" />}
                />
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-theme-surface-border border-b">
                      <th scope="col" className="text-theme-text-secondary px-4 py-3 text-left font-medium">
                        Period
                      </th>
                      <th scope="col" className="text-theme-text-secondary px-4 py-3 text-right font-medium">
                        Total Calls
                      </th>
                      <th scope="col" className="text-theme-text-secondary px-4 py-3 text-left font-medium">
                        By Type
                      </th>
                      <th scope="col" className="text-theme-text-secondary px-4 py-3 text-right font-medium">
                        Avg Response
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {callVolumeData.map((row, idx) => (
                      <tr key={idx} className="border-theme-surface-border hover:bg-theme-surface-hover border-b">
                        <td className="text-theme-text-primary px-4 py-3 font-medium">{row.period}</td>
                        <td className="text-theme-text-primary px-4 py-3 text-right font-medium">{row.total_calls}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(row.by_type).map(([type, count]) => (
                              <span
                                key={type}
                                className="inline-flex items-center rounded-sm bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-500/20 dark:text-blue-400"
                              >
                                {type}: {count}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="text-theme-text-secondary px-4 py-3 text-right">
                          {formatResponseTime(row.avg_response_seconds)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============================== */}
      {/* Availability Tab */}
      {/* ============================== */}
      {activeTab === 'availability' && (
        <div role="tabpanel">
          <DateRangeFilter
            startDate={startDate}
            endDate={endDate}
            onStartChange={setStartDate}
            onEndChange={setEndDate}
            onSearch={handleSearch}
            loading={loading}
          />

          {!hasSearched ? (
            <div className="card-secondary py-12 text-center">
              <Users className="text-theme-text-muted mx-auto mb-4 h-12 w-12" aria-hidden="true" />
              <h3 className="text-theme-text-primary mb-2 text-lg font-semibold">Pick the dates to cover</h3>
              <p className="text-theme-text-muted">Choose start and end dates to check member availability</p>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
              <RefreshCw className="text-theme-text-muted h-8 w-8 animate-spin" aria-hidden="true" />
              <span className="sr-only">Loading availability...</span>
            </div>
          ) : availabilityData.length === 0 ? (
            <div className="card-secondary py-8 text-center">
              <AlertCircle className="text-theme-text-muted mx-auto mb-3 h-10 w-10" aria-hidden="true" />
              <p className="text-theme-text-muted">No availability data for this period</p>
            </div>
          ) : (
            <div>
              {/* Summary */}
              <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3">
                <StatCard
                  label="Members"
                  value={availabilityData.length}
                  icon={<Users className="text-theme-text-muted h-5 w-5" aria-hidden="true" />}
                />
                <StatCard
                  label="Total Assignments"
                  value={availabilityData.reduce((sum, m) => sum + (m.total_shifts_assigned || 0), 0)}
                  icon={<Shield className="text-theme-text-muted h-5 w-5" aria-hidden="true" />}
                />
                <StatCard
                  label="Time Off Days"
                  value={availabilityData.reduce((sum, m) => sum + (m.time_off_days || 0), 0)}
                  icon={<Clock className="text-theme-text-muted h-5 w-5" aria-hidden="true" />}
                />
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-theme-surface-border border-b">
                      <th scope="col" className="text-theme-text-secondary px-4 py-3 text-left font-medium">
                        Member
                      </th>
                      <th scope="col" className="text-theme-text-secondary px-4 py-3 text-right font-medium">
                        Shifts Assigned
                      </th>
                      <th scope="col" className="text-theme-text-secondary px-4 py-3 text-right font-medium">
                        Time Off Days
                      </th>
                      <th scope="col" className="text-theme-text-secondary px-4 py-3 text-right font-medium">
                        Available Days
                      </th>
                      <th scope="col" className="text-theme-text-secondary px-4 py-3 text-right font-medium">
                        Unavailable Days
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {availabilityData.map((member, idx) => (
                      <tr
                        key={member.user_id || idx}
                        className="border-theme-surface-border hover:bg-theme-surface-hover border-b"
                      >
                        <td className="px-4 py-3">
                          <div>
                            <p className="text-theme-text-primary font-medium">
                              {member.user_name || member.email || member.user_id}
                            </p>
                            {member.email && member.user_name && (
                              <p className="text-theme-text-muted text-xs">{member.email}</p>
                            )}
                          </div>
                        </td>
                        <td className="text-theme-text-primary px-4 py-3 text-right">
                          {member.total_shifts_assigned || 0}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {(member.time_off_days || 0) > 0 ? (
                            <span className="inline-flex items-center rounded-sm bg-yellow-500/10 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400">
                              {member.time_off_days}
                            </span>
                          ) : (
                            <span className="text-theme-text-muted">0</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="inline-flex items-center rounded-sm bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-500/20 dark:text-green-400">
                            {member.available_dates?.length || 0}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {(member.unavailable_dates?.length || 0) > 0 ? (
                            <span className="inline-flex items-center rounded-sm bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-500/20 dark:text-red-400">
                              {member.unavailable_dates.length}
                            </span>
                          ) : (
                            <span className="text-theme-text-muted">0</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============================== */}
      {/* Shift Compliance Tab */}
      {/* ============================== */}
      {activeTab === 'compliance' && (
        <div role="tabpanel">
          {/* Compliance filter bar */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSearch();
            }}
            className="card-secondary mb-6 flex flex-wrap items-end gap-3 p-4"
          >
            <div>
              <label htmlFor="compliance-ref-date" className="text-theme-text-secondary mb-1 block text-sm font-medium">
                Reference Date (optional)
              </label>
              <input
                id="compliance-ref-date"
                type="date"
                value={complianceRefDate}
                onChange={(e) => setComplianceRefDate(e.target.value)}
                className="form-input"
              />
            </div>
            <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
              {loading ? (
                <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Search className="h-4 w-4" aria-hidden="true" />
              )}
              {loading ? 'Loading...' : 'Check Compliance'}
            </button>
          </form>

          {!hasSearched ? (
            <div className="card-secondary py-12 text-center">
              <CheckCircle2 className="text-theme-text-muted mx-auto mb-4 h-12 w-12" aria-hidden="true" />
              <h3 className="text-theme-text-primary mb-2 text-lg font-semibold">Shift Compliance</h3>
              <p className="text-theme-text-muted">
                Check member compliance against shift and hours requirements.
                <br />
                Leave the reference date blank to use today.
              </p>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
              <RefreshCw className="text-theme-text-muted h-8 w-8 animate-spin" aria-hidden="true" />
              <span className="sr-only">Loading compliance...</span>
            </div>
          ) : complianceData.length === 0 ? (
            <div className="card-secondary py-8 text-center">
              <AlertCircle className="text-theme-text-muted mx-auto mb-3 h-10 w-10" aria-hidden="true" />
              <p className="text-theme-text-muted">
                No active shift or hours requirements found.
                <br />
                Create training requirements with type &quot;Shifts&quot; or &quot;Hours&quot; to track compliance.
              </p>
            </div>
          ) : (
            <div>
              {/* Overall Summary */}
              <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
                <StatCard
                  label="Requirements"
                  value={complianceData.length}
                  icon={<Shield className="text-theme-text-muted h-5 w-5" aria-hidden="true" />}
                />
                <StatCard
                  label="Total Members"
                  value={complianceData.reduce((sum, r) => sum + r.total_members, 0)}
                  icon={<Users className="text-theme-text-muted h-5 w-5" aria-hidden="true" />}
                />
                <StatCard
                  label="Compliant"
                  value={complianceData.reduce((sum, r) => sum + r.compliant_count, 0)}
                  icon={<CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" aria-hidden="true" />}
                />
                <StatCard
                  label="Non-Compliant"
                  value={complianceData.reduce((sum, r) => sum + r.non_compliant_count, 0)}
                  icon={<XCircle className="h-5 w-5 text-red-600 dark:text-red-400" aria-hidden="true" />}
                />
              </div>

              {/* Filter toggle */}
              <div className="mb-4 flex items-center gap-2">
                <button
                  onClick={() => setComplianceFilter('all')}
                  className={`rounded-lg border px-3 py-1.5 text-sm ${
                    complianceFilter === 'all'
                      ? 'border-red-600 bg-red-600 text-white'
                      : 'bg-theme-surface border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover'
                  }`}
                >
                  All Members
                </button>
                <button
                  onClick={() => setComplianceFilter('non-compliant')}
                  className={`rounded-lg border px-3 py-1.5 text-sm ${
                    complianceFilter === 'non-compliant'
                      ? 'border-red-600 bg-red-600 text-white'
                      : 'bg-theme-surface border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover'
                  }`}
                >
                  Non-Compliant Only
                </button>
              </div>

              {/* Requirement cards */}
              <div className="space-y-4">
                {complianceData.map((req) => {
                  const isExpanded = expandedRequirements.has(req.requirement_id);
                  const filteredMembers =
                    complianceFilter === 'non-compliant' ? req.members.filter((m) => !m.compliant) : req.members;

                  return (
                    <div
                      key={req.requirement_id}
                      className="bg-theme-surface border-theme-surface-border overflow-hidden rounded-lg border"
                    >
                      {/* Requirement header */}
                      <button
                        onClick={() => toggleRequirement(req.requirement_id)}
                        className="hover:bg-theme-surface-hover flex w-full items-center justify-between p-4 text-left transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          {isExpanded ? (
                            <ChevronDown className="text-theme-text-muted h-5 w-5 shrink-0" aria-hidden="true" />
                          ) : (
                            <ChevronRight className="text-theme-text-muted h-5 w-5 shrink-0" aria-hidden="true" />
                          )}
                          <div>
                            <h3 className="text-theme-text-primary font-semibold">{req.requirement_name}</h3>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <span className="inline-flex items-center rounded-sm bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-500/20 dark:text-blue-400">
                                {req.requirement_type === 'shifts' ? 'Shifts' : 'Hours'}
                              </span>
                              <span className="text-theme-text-muted text-xs capitalize">
                                {req.frequency.replace('_', ' ')}
                              </span>
                              <span className="text-theme-text-muted text-xs">
                                {formatDate(req.period_start, tz)} — {formatDate(req.period_end, tz)}
                              </span>
                              <span className="text-theme-text-secondary text-xs font-medium">
                                Required: {req.required_value} {req.requirement_type === 'shifts' ? 'shifts' : 'hours'}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="ml-4 flex shrink-0 items-center gap-4">
                          {/* Compliance rate badge */}
                          <div className="text-right">
                            <div
                              className={`text-lg font-bold ${
                                req.compliance_rate >= 80
                                  ? 'text-green-700 dark:text-green-400'
                                  : req.compliance_rate >= 50
                                    ? 'text-yellow-700 dark:text-yellow-400'
                                    : 'text-red-700 dark:text-red-400'
                              }`}
                            >
                              {req.compliance_rate}%
                            </div>
                            <div className="text-theme-text-muted text-xs">
                              {req.compliant_count}/{req.total_members} compliant
                            </div>
                          </div>
                          {/* Progress bar */}
                          <div className="bg-theme-surface-secondary h-2 w-24 overflow-hidden rounded-full">
                            <div
                              className={`h-full rounded-full transition-all ${
                                req.compliance_rate >= 80
                                  ? 'bg-green-500'
                                  : req.compliance_rate >= 50
                                    ? 'bg-yellow-500'
                                    : 'bg-red-500'
                              }`}
                              style={{ width: `${req.compliance_rate}%` }}
                            />
                          </div>
                        </div>
                      </button>

                      {/* Expanded member list */}
                      {isExpanded && (
                        <div className="border-theme-surface-border overflow-x-auto border-t">
                          {filteredMembers.length === 0 ? (
                            <div className="text-theme-text-muted p-4 text-center text-sm">
                              {complianceFilter === 'non-compliant' ? 'All members are compliant!' : 'No members found'}
                            </div>
                          ) : (
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-theme-surface-border bg-theme-surface-secondary border-b">
                                  <th scope="col" className="text-theme-text-secondary px-4 py-2 text-left font-medium">
                                    Member
                                  </th>
                                  <th scope="col" className="text-theme-text-secondary px-4 py-2 text-left font-medium">
                                    Rank
                                  </th>
                                  <th
                                    scope="col"
                                    className="text-theme-text-secondary px-4 py-2 text-right font-medium"
                                  >
                                    Shifts
                                  </th>
                                  <th
                                    scope="col"
                                    className="text-theme-text-secondary px-4 py-2 text-right font-medium"
                                  >
                                    Hours
                                  </th>
                                  <th
                                    scope="col"
                                    className="text-theme-text-secondary px-4 py-2 text-right font-medium"
                                  >
                                    Progress
                                  </th>
                                  <th
                                    scope="col"
                                    className="text-theme-text-secondary px-4 py-2 text-center font-medium"
                                  >
                                    Status
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {filteredMembers.map((member) => (
                                  <tr
                                    key={member.user_id}
                                    className="border-theme-surface-border hover:bg-theme-surface-hover border-b"
                                  >
                                    <td className="px-4 py-2">
                                      <span className="text-theme-text-primary font-medium">
                                        {member.full_name ||
                                          `${member.first_name || ''} ${member.last_name || ''}`.trim() ||
                                          member.user_id}
                                      </span>
                                    </td>
                                    <td className="px-4 py-2">
                                      <span className="text-theme-text-secondary text-xs">
                                        {formatRank(member.rank) || '-'}
                                      </span>
                                    </td>
                                    <td className="text-theme-text-primary px-4 py-2 text-right">
                                      {member.shift_count}
                                    </td>
                                    <td className="text-theme-text-primary px-4 py-2 text-right">
                                      {member.total_hours}
                                    </td>
                                    <td className="px-4 py-2 text-right">
                                      <div className="flex items-center justify-end gap-2">
                                        <div className="bg-theme-surface-secondary h-1.5 w-16 overflow-hidden rounded-full">
                                          <div
                                            className={`h-full rounded-full ${member.compliant ? 'bg-green-500' : 'bg-red-500'}`}
                                            style={{ width: `${member.percentage}%` }}
                                          />
                                        </div>
                                        <span className="text-theme-text-muted w-10 text-right text-xs">
                                          {member.percentage}%
                                        </span>
                                      </div>
                                    </td>
                                    <td className="px-4 py-2 text-center">
                                      {member.compliant ? (
                                        <span className="inline-flex items-center gap-1 rounded-sm bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-500/20 dark:text-green-400">
                                          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                                          Compliant
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center gap-1 rounded-sm bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-500/20 dark:text-red-400">
                                          <XCircle className="h-3 w-3" aria-hidden="true" />
                                          Behind
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SchedulingReportsPage;
