/**
 * Scheduling Reports Page
 *
 * Displays scheduling reports and member availability data.
 * Tabs: Member Hours, Coverage, Call Volume, Availability.
 * Each tab has date range filters and displays tabular data.
 */

import React, { useState, useCallback } from 'react';
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
import { schedulingService } from '../services/api';
import type { RequirementComplianceSummary } from '../services/api';
import { useTimezone } from '../hooks/useTimezone';
import { formatDate } from '../utils/dateFormatting';

// ============================================
// Interfaces
// ============================================

interface MemberHoursRecord {
  user_id: string;
  email: string;
  shift_count: number;
  total_minutes: number;
  total_hours: number;
}

interface MemberHoursReport {
  members: MemberHoursRecord[];
  period_start: string;
  period_end: string;
  total_members: number;
}

interface CoverageRecord {
  date: string;
  total_shifts: number;
  total_assigned: number;
  total_confirmed: number;
  understaffed_shifts: number;
}

interface CallVolumeRecord {
  period: string;
  total_calls: number;
  by_type: Record<string, number>;
  avg_response_seconds?: number;
}

interface AvailabilityRecord {
  user_id: string;
  user_name?: string;
  email?: string;
  available_dates: string[];
  unavailable_dates: string[];
  total_shifts_assigned: number;
  time_off_days: number;
}

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
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 mb-6 p-4 bg-theme-surface-secondary rounded-lg border border-theme-surface-border">
      <div>
        <label htmlFor="report-start" className="block text-sm font-medium text-theme-text-secondary mb-1">
          Start Date
        </label>
        <input
          id="report-start"
          type="date"
          value={startDate}
          onChange={(e) => onStartChange(e.target.value)}
          className="px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
          required
        />
      </div>
      <div>
        <label htmlFor="report-end" className="block text-sm font-medium text-theme-text-secondary mb-1">
          End Date
        </label>
        <input
          id="report-end"
          type="date"
          value={endDate}
          onChange={(e) => onEndChange(e.target.value)}
          className="px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
          required
        />
      </div>
      {extraControls}
      <button
        type="submit"
        disabled={loading || !startDate || !endDate}
        className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50"
      >
        {loading ? (
          <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
        ) : (
          <Search className="w-4 h-4" aria-hidden="true" />
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
  <div className="bg-theme-surface rounded-lg p-4 border border-theme-surface-border">
    <div className="flex items-center gap-3">
      <div className="p-2 bg-theme-surface-secondary rounded-lg">
        {icon}
      </div>
      <div>
        <p className="text-xs text-theme-text-muted">{label}</p>
        <p className="text-xl font-bold text-theme-text-primary">{value}</p>
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

  // Date ranges
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Member Hours state
  const [memberHoursReport, setMemberHoursReport] = useState<MemberHoursReport | null>(null);

  // Coverage state
  const [coverageData, setCoverageData] = useState<CoverageRecord[]>([]);

  // Call Volume state
  const [callVolumeData, setCallVolumeData] = useState<CallVolumeRecord[]>([]);
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
      setMemberHoursReport(data as unknown as MemberHoursReport);
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
      // Data might be an array or an object with records
      const records = Array.isArray(data) ? data : (data).records || [];
      setCoverageData(records as unknown as CoverageRecord[]);
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
      const data = await schedulingService.getCallVolumeReport({ start_date: startDate, end_date: endDate, group_by: groupBy });
      const records = Array.isArray(data) ? data : (data).records || [];
      setCallVolumeData(records as unknown as CallVolumeRecord[]);
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
      setAvailabilityData(data as unknown as AvailabilityRecord[]);
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
    setExpandedRequirements(prev => {
      const next = new Set(prev);
      if (next.has(reqId)) {
        next.delete(reqId);
      } else {
        next.add(reqId);
      }
      return next;
    });
  };

  const handleSearch = () => {
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
  };

  const formatDuration = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}h ${m}m`;
  };

  const formatResponseTime = (seconds?: number) => {
    if (!seconds) return '-';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}m ${s}s`;
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-theme-text-primary flex items-center gap-3">
          <BarChart3 className="w-7 h-7" aria-hidden="true" />
          Scheduling Reports
        </h1>
        <p className="text-theme-text-muted mt-1">View scheduling analytics, member hours, and coverage data</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-theme-surface-border mb-6" role="tablist" aria-label="Scheduling reports">
        <button
          onClick={() => handleTabChange('member-hours')}
          role="tab"
          aria-selected={activeTab === 'member-hours'}
          className={`px-4 py-3 text-sm font-medium ${
            activeTab === 'member-hours'
              ? 'text-red-700 dark:text-red-500 border-b-2 border-red-500'
              : 'text-theme-text-muted hover:text-theme-text-primary'
          }`}
        >
          <Clock className="w-4 h-4 inline-block mr-2" aria-hidden="true" />
          Member Hours
        </button>
        <button
          onClick={() => handleTabChange('coverage')}
          role="tab"
          aria-selected={activeTab === 'coverage'}
          className={`px-4 py-3 text-sm font-medium ${
            activeTab === 'coverage'
              ? 'text-red-700 dark:text-red-500 border-b-2 border-red-500'
              : 'text-theme-text-muted hover:text-theme-text-primary'
          }`}
        >
          <Shield className="w-4 h-4 inline-block mr-2" aria-hidden="true" />
          Coverage
        </button>
        <button
          onClick={() => handleTabChange('call-volume')}
          role="tab"
          aria-selected={activeTab === 'call-volume'}
          className={`px-4 py-3 text-sm font-medium ${
            activeTab === 'call-volume'
              ? 'text-red-700 dark:text-red-500 border-b-2 border-red-500'
              : 'text-theme-text-muted hover:text-theme-text-primary'
          }`}
        >
          <Phone className="w-4 h-4 inline-block mr-2" aria-hidden="true" />
          Call Volume
        </button>
        <button
          onClick={() => handleTabChange('availability')}
          role="tab"
          aria-selected={activeTab === 'availability'}
          className={`px-4 py-3 text-sm font-medium ${
            activeTab === 'availability'
              ? 'text-red-700 dark:text-red-500 border-b-2 border-red-500'
              : 'text-theme-text-muted hover:text-theme-text-primary'
          }`}
        >
          <Users className="w-4 h-4 inline-block mr-2" aria-hidden="true" />
          Availability
        </button>
        <button
          onClick={() => handleTabChange('compliance')}
          role="tab"
          aria-selected={activeTab === 'compliance'}
          className={`px-4 py-3 text-sm font-medium ${
            activeTab === 'compliance'
              ? 'text-red-700 dark:text-red-500 border-b-2 border-red-500'
              : 'text-theme-text-muted hover:text-theme-text-primary'
          }`}
        >
          <CheckCircle2 className="w-4 h-4 inline-block mr-2" aria-hidden="true" />
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
            <div className="text-center py-12 bg-theme-surface-secondary rounded-lg border border-theme-surface-border">
              <Clock className="w-12 h-12 text-theme-text-muted mx-auto mb-4" aria-hidden="true" />
              <h3 className="text-lg font-semibold text-theme-text-primary mb-2">Select a Date Range</h3>
              <p className="text-theme-text-muted">Choose start and end dates to generate the member hours report</p>
            </div>
          ) : loading ? (
            <div className="flex justify-center items-center py-12" role="status" aria-live="polite">
              <RefreshCw className="w-8 h-8 text-theme-text-muted animate-spin" aria-hidden="true" />
              <span className="sr-only">Loading report...</span>
            </div>
          ) : memberHoursReport ? (
            <div>
              {/* Summary Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <StatCard
                  label="Total Members"
                  value={memberHoursReport.total_members}
                  icon={<Users className="w-5 h-5 text-theme-text-muted" aria-hidden="true" />}
                />
                <StatCard
                  label="Period"
                  value={`${formatDate(memberHoursReport.period_start, tz)} - ${formatDate(memberHoursReport.period_end, tz)}`}
                  icon={<Clock className="w-5 h-5 text-theme-text-muted" aria-hidden="true" />}
                />
                <StatCard
                  label="Total Shifts"
                  value={memberHoursReport.members.reduce((sum, m) => sum + m.shift_count, 0)}
                  icon={<Shield className="w-5 h-5 text-theme-text-muted" aria-hidden="true" />}
                />
                <StatCard
                  label="Total Hours"
                  value={memberHoursReport.members.reduce((sum, m) => sum + m.total_hours, 0).toFixed(1)}
                  icon={<BarChart3 className="w-5 h-5 text-theme-text-muted" aria-hidden="true" />}
                />
              </div>

              {/* Table */}
              {memberHoursReport.members.length === 0 ? (
                <div className="text-center py-8 bg-theme-surface-secondary rounded-lg border border-theme-surface-border">
                  <AlertCircle className="w-10 h-10 text-theme-text-muted mx-auto mb-3" aria-hidden="true" />
                  <p className="text-theme-text-muted">No data for this period</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-theme-surface-border">
                        <th className="text-left py-3 px-4 text-theme-text-secondary font-medium">Member</th>
                        <th className="text-right py-3 px-4 text-theme-text-secondary font-medium">Shifts</th>
                        <th className="text-right py-3 px-4 text-theme-text-secondary font-medium">Total Minutes</th>
                        <th className="text-right py-3 px-4 text-theme-text-secondary font-medium">Total Hours</th>
                        <th className="text-right py-3 px-4 text-theme-text-secondary font-medium">Avg Per Shift</th>
                      </tr>
                    </thead>
                    <tbody>
                      {memberHoursReport.members.map(m => (
                        <tr key={m.user_id} className="border-b border-theme-surface-border hover:bg-theme-surface-hover">
                          <td className="py-3 px-4">
                            <div>
                              <p className="text-theme-text-primary font-medium">{m.email}</p>
                              <p className="text-xs text-theme-text-muted">{m.user_id}</p>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right text-theme-text-primary">{m.shift_count}</td>
                          <td className="py-3 px-4 text-right text-theme-text-secondary">{formatDuration(m.total_minutes)}</td>
                          <td className="py-3 px-4 text-right text-theme-text-primary font-medium">{m.total_hours.toFixed(1)}</td>
                          <td className="py-3 px-4 text-right text-theme-text-muted">
                            {m.shift_count > 0 ? (m.total_hours / m.shift_count).toFixed(1) : '0'}h
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8 bg-theme-surface-secondary rounded-lg border border-theme-surface-border">
              <AlertCircle className="w-10 h-10 text-theme-text-muted mx-auto mb-3" aria-hidden="true" />
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
            <div className="text-center py-12 bg-theme-surface-secondary rounded-lg border border-theme-surface-border">
              <Shield className="w-12 h-12 text-theme-text-muted mx-auto mb-4" aria-hidden="true" />
              <h3 className="text-lg font-semibold text-theme-text-primary mb-2">Select a Date Range</h3>
              <p className="text-theme-text-muted">Choose start and end dates to view shift coverage data</p>
            </div>
          ) : loading ? (
            <div className="flex justify-center items-center py-12" role="status" aria-live="polite">
              <RefreshCw className="w-8 h-8 text-theme-text-muted animate-spin" aria-hidden="true" />
              <span className="sr-only">Loading report...</span>
            </div>
          ) : coverageData.length === 0 ? (
            <div className="text-center py-8 bg-theme-surface-secondary rounded-lg border border-theme-surface-border">
              <AlertCircle className="w-10 h-10 text-theme-text-muted mx-auto mb-3" aria-hidden="true" />
              <p className="text-theme-text-muted">No coverage data for this period</p>
            </div>
          ) : (
            <div>
              {/* Summary Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <StatCard
                  label="Total Days"
                  value={coverageData.length}
                  icon={<BarChart3 className="w-5 h-5 text-theme-text-muted" aria-hidden="true" />}
                />
                <StatCard
                  label="Total Shifts"
                  value={coverageData.reduce((sum, d) => sum + d.total_shifts, 0)}
                  icon={<Shield className="w-5 h-5 text-theme-text-muted" aria-hidden="true" />}
                />
                <StatCard
                  label="Confirmed"
                  value={coverageData.reduce((sum, d) => sum + d.total_confirmed, 0)}
                  icon={<Users className="w-5 h-5 text-theme-text-muted" aria-hidden="true" />}
                />
                <StatCard
                  label="Understaffed"
                  value={coverageData.reduce((sum, d) => sum + d.understaffed_shifts, 0)}
                  icon={<AlertCircle className="w-5 h-5 text-theme-text-muted" aria-hidden="true" />}
                />
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-theme-surface-border">
                      <th className="text-left py-3 px-4 text-theme-text-secondary font-medium">Date</th>
                      <th className="text-right py-3 px-4 text-theme-text-secondary font-medium">Total Shifts</th>
                      <th className="text-right py-3 px-4 text-theme-text-secondary font-medium">Assigned</th>
                      <th className="text-right py-3 px-4 text-theme-text-secondary font-medium">Confirmed</th>
                      <th className="text-right py-3 px-4 text-theme-text-secondary font-medium">Understaffed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coverageData.map((row, idx) => (
                      <tr key={idx} className="border-b border-theme-surface-border hover:bg-theme-surface-hover">
                        <td className="py-3 px-4 text-theme-text-primary font-medium">{formatDate(row.date, tz)}</td>
                        <td className="py-3 px-4 text-right text-theme-text-primary">{row.total_shifts}</td>
                        <td className="py-3 px-4 text-right text-theme-text-secondary">{row.total_assigned}</td>
                        <td className="py-3 px-4 text-right">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400">
                            {row.total_confirmed}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          {row.understaffed_shifts > 0 ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400">
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
                <label htmlFor="call-group-by" className="block text-sm font-medium text-theme-text-secondary mb-1">
                  Group By
                </label>
                <select
                  id="call-group-by"
                  value={groupBy}
                  onChange={(e) => setGroupBy(e.target.value)}
                  className="px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
                >
                  <option value="day">Day</option>
                  <option value="week">Week</option>
                  <option value="month">Month</option>
                </select>
              </div>
            }
          />

          {!hasSearched ? (
            <div className="text-center py-12 bg-theme-surface-secondary rounded-lg border border-theme-surface-border">
              <Phone className="w-12 h-12 text-theme-text-muted mx-auto mb-4" aria-hidden="true" />
              <h3 className="text-lg font-semibold text-theme-text-primary mb-2">Select a Date Range</h3>
              <p className="text-theme-text-muted">Choose start and end dates to view call volume data</p>
            </div>
          ) : loading ? (
            <div className="flex justify-center items-center py-12" role="status" aria-live="polite">
              <RefreshCw className="w-8 h-8 text-theme-text-muted animate-spin" aria-hidden="true" />
              <span className="sr-only">Loading report...</span>
            </div>
          ) : callVolumeData.length === 0 ? (
            <div className="text-center py-8 bg-theme-surface-secondary rounded-lg border border-theme-surface-border">
              <AlertCircle className="w-10 h-10 text-theme-text-muted mx-auto mb-3" aria-hidden="true" />
              <p className="text-theme-text-muted">No call volume data for this period</p>
            </div>
          ) : (
            <div>
              {/* Summary Stats */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
                <StatCard
                  label="Total Calls"
                  value={callVolumeData.reduce((sum, d) => sum + d.total_calls, 0)}
                  icon={<Phone className="w-5 h-5 text-theme-text-muted" aria-hidden="true" />}
                />
                <StatCard
                  label="Periods"
                  value={callVolumeData.length}
                  icon={<BarChart3 className="w-5 h-5 text-theme-text-muted" aria-hidden="true" />}
                />
                <StatCard
                  label="Avg Response"
                  value={formatResponseTime(
                    callVolumeData.filter(d => d.avg_response_seconds).length > 0
                      ? callVolumeData.reduce((sum, d) => sum + (d.avg_response_seconds || 0), 0) / callVolumeData.filter(d => d.avg_response_seconds).length
                      : undefined
                  )}
                  icon={<Clock className="w-5 h-5 text-theme-text-muted" aria-hidden="true" />}
                />
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-theme-surface-border">
                      <th className="text-left py-3 px-4 text-theme-text-secondary font-medium">Period</th>
                      <th className="text-right py-3 px-4 text-theme-text-secondary font-medium">Total Calls</th>
                      <th className="text-left py-3 px-4 text-theme-text-secondary font-medium">By Type</th>
                      <th className="text-right py-3 px-4 text-theme-text-secondary font-medium">Avg Response</th>
                    </tr>
                  </thead>
                  <tbody>
                    {callVolumeData.map((row, idx) => (
                      <tr key={idx} className="border-b border-theme-surface-border hover:bg-theme-surface-hover">
                        <td className="py-3 px-4 text-theme-text-primary font-medium">{row.period}</td>
                        <td className="py-3 px-4 text-right text-theme-text-primary font-medium">{row.total_calls}</td>
                        <td className="py-3 px-4">
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(row.by_type).map(([type, count]) => (
                              <span
                                key={type}
                                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400"
                              >
                                {type}: {count}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right text-theme-text-secondary">
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
            <div className="text-center py-12 bg-theme-surface-secondary rounded-lg border border-theme-surface-border">
              <Users className="w-12 h-12 text-theme-text-muted mx-auto mb-4" aria-hidden="true" />
              <h3 className="text-lg font-semibold text-theme-text-primary mb-2">Select a Date Range</h3>
              <p className="text-theme-text-muted">Choose start and end dates to check member availability</p>
            </div>
          ) : loading ? (
            <div className="flex justify-center items-center py-12" role="status" aria-live="polite">
              <RefreshCw className="w-8 h-8 text-theme-text-muted animate-spin" aria-hidden="true" />
              <span className="sr-only">Loading availability...</span>
            </div>
          ) : availabilityData.length === 0 ? (
            <div className="text-center py-8 bg-theme-surface-secondary rounded-lg border border-theme-surface-border">
              <AlertCircle className="w-10 h-10 text-theme-text-muted mx-auto mb-3" aria-hidden="true" />
              <p className="text-theme-text-muted">No availability data for this period</p>
            </div>
          ) : (
            <div>
              {/* Summary */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
                <StatCard
                  label="Members"
                  value={availabilityData.length}
                  icon={<Users className="w-5 h-5 text-theme-text-muted" aria-hidden="true" />}
                />
                <StatCard
                  label="Total Assignments"
                  value={availabilityData.reduce((sum, m) => sum + (m.total_shifts_assigned || 0), 0)}
                  icon={<Shield className="w-5 h-5 text-theme-text-muted" aria-hidden="true" />}
                />
                <StatCard
                  label="Time Off Days"
                  value={availabilityData.reduce((sum, m) => sum + (m.time_off_days || 0), 0)}
                  icon={<Clock className="w-5 h-5 text-theme-text-muted" aria-hidden="true" />}
                />
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-theme-surface-border">
                      <th className="text-left py-3 px-4 text-theme-text-secondary font-medium">Member</th>
                      <th className="text-right py-3 px-4 text-theme-text-secondary font-medium">Shifts Assigned</th>
                      <th className="text-right py-3 px-4 text-theme-text-secondary font-medium">Time Off Days</th>
                      <th className="text-right py-3 px-4 text-theme-text-secondary font-medium">Available Days</th>
                      <th className="text-right py-3 px-4 text-theme-text-secondary font-medium">Unavailable Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {availabilityData.map((member, idx) => (
                      <tr key={member.user_id || idx} className="border-b border-theme-surface-border hover:bg-theme-surface-hover">
                        <td className="py-3 px-4">
                          <div>
                            <p className="text-theme-text-primary font-medium">{member.user_name || member.email || member.user_id}</p>
                            {member.email && member.user_name && (
                              <p className="text-xs text-theme-text-muted">{member.email}</p>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right text-theme-text-primary">{member.total_shifts_assigned || 0}</td>
                        <td className="py-3 px-4 text-right">
                          {(member.time_off_days || 0) > 0 ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-500/10 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400">
                              {member.time_off_days}
                            </span>
                          ) : (
                            <span className="text-theme-text-muted">0</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400">
                            {member.available_dates?.length || 0}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          {(member.unavailable_dates?.length || 0) > 0 ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400">
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
            onSubmit={(e) => { e.preventDefault(); handleSearch(); }}
            className="flex flex-wrap items-end gap-3 mb-6 p-4 bg-theme-surface-secondary rounded-lg border border-theme-surface-border"
          >
            <div>
              <label htmlFor="compliance-ref-date" className="block text-sm font-medium text-theme-text-secondary mb-1">
                Reference Date (optional)
              </label>
              <input
                id="compliance-ref-date"
                type="date"
                value={complianceRefDate}
                onChange={(e) => setComplianceRefDate(e.target.value)}
                className="px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50"
            >
              {loading ? (
                <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <Search className="w-4 h-4" aria-hidden="true" />
              )}
              {loading ? 'Loading...' : 'Check Compliance'}
            </button>
          </form>

          {!hasSearched ? (
            <div className="text-center py-12 bg-theme-surface-secondary rounded-lg border border-theme-surface-border">
              <CheckCircle2 className="w-12 h-12 text-theme-text-muted mx-auto mb-4" aria-hidden="true" />
              <h3 className="text-lg font-semibold text-theme-text-primary mb-2">Shift Compliance</h3>
              <p className="text-theme-text-muted">
                Check member compliance against shift and hours requirements.
                <br />
                Leave the reference date blank to use today.
              </p>
            </div>
          ) : loading ? (
            <div className="flex justify-center items-center py-12" role="status" aria-live="polite">
              <RefreshCw className="w-8 h-8 text-theme-text-muted animate-spin" aria-hidden="true" />
              <span className="sr-only">Loading compliance...</span>
            </div>
          ) : complianceData.length === 0 ? (
            <div className="text-center py-8 bg-theme-surface-secondary rounded-lg border border-theme-surface-border">
              <AlertCircle className="w-10 h-10 text-theme-text-muted mx-auto mb-3" aria-hidden="true" />
              <p className="text-theme-text-muted">
                No active shift or hours requirements found.
                <br />
                Create training requirements with type &quot;Shifts&quot; or &quot;Hours&quot; to track compliance.
              </p>
            </div>
          ) : (
            <div>
              {/* Overall Summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <StatCard
                  label="Requirements"
                  value={complianceData.length}
                  icon={<Shield className="w-5 h-5 text-theme-text-muted" aria-hidden="true" />}
                />
                <StatCard
                  label="Total Members"
                  value={complianceData.reduce((sum, r) => sum + r.total_members, 0)}
                  icon={<Users className="w-5 h-5 text-theme-text-muted" aria-hidden="true" />}
                />
                <StatCard
                  label="Compliant"
                  value={complianceData.reduce((sum, r) => sum + r.compliant_count, 0)}
                  icon={<CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" aria-hidden="true" />}
                />
                <StatCard
                  label="Non-Compliant"
                  value={complianceData.reduce((sum, r) => sum + r.non_compliant_count, 0)}
                  icon={<XCircle className="w-5 h-5 text-red-600 dark:text-red-400" aria-hidden="true" />}
                />
              </div>

              {/* Filter toggle */}
              <div className="flex items-center gap-2 mb-4">
                <button
                  onClick={() => setComplianceFilter('all')}
                  className={`px-3 py-1.5 text-sm rounded-lg border ${
                    complianceFilter === 'all'
                      ? 'bg-red-600 text-white border-red-600'
                      : 'bg-theme-surface border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover'
                  }`}
                >
                  All Members
                </button>
                <button
                  onClick={() => setComplianceFilter('non-compliant')}
                  className={`px-3 py-1.5 text-sm rounded-lg border ${
                    complianceFilter === 'non-compliant'
                      ? 'bg-red-600 text-white border-red-600'
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
                  const filteredMembers = complianceFilter === 'non-compliant'
                    ? req.members.filter(m => !m.compliant)
                    : req.members;

                  return (
                    <div
                      key={req.requirement_id}
                      className="bg-theme-surface rounded-lg border border-theme-surface-border overflow-hidden"
                    >
                      {/* Requirement header */}
                      <button
                        onClick={() => toggleRequirement(req.requirement_id)}
                        className="w-full flex items-center justify-between p-4 hover:bg-theme-surface-hover transition-colors text-left"
                      >
                        <div className="flex items-center gap-3">
                          {isExpanded ? (
                            <ChevronDown className="w-5 h-5 text-theme-text-muted flex-shrink-0" aria-hidden="true" />
                          ) : (
                            <ChevronRight className="w-5 h-5 text-theme-text-muted flex-shrink-0" aria-hidden="true" />
                          )}
                          <div>
                            <h3 className="font-semibold text-theme-text-primary">{req.requirement_name}</h3>
                            <div className="flex flex-wrap items-center gap-2 mt-1">
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400">
                                {req.requirement_type === 'shifts' ? 'Shifts' : 'Hours'}
                              </span>
                              <span className="text-xs text-theme-text-muted capitalize">
                                {req.frequency.replace('_', ' ')}
                              </span>
                              <span className="text-xs text-theme-text-muted">
                                {formatDate(req.period_start, tz)} — {formatDate(req.period_end, tz)}
                              </span>
                              <span className="text-xs text-theme-text-secondary font-medium">
                                Required: {req.required_value} {req.requirement_type === 'shifts' ? 'shifts' : 'hours'}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 flex-shrink-0 ml-4">
                          {/* Compliance rate badge */}
                          <div className="text-right">
                            <div className={`text-lg font-bold ${
                              req.compliance_rate >= 80
                                ? 'text-green-700 dark:text-green-400'
                                : req.compliance_rate >= 50
                                  ? 'text-yellow-700 dark:text-yellow-400'
                                  : 'text-red-700 dark:text-red-400'
                            }`}>
                              {req.compliance_rate}%
                            </div>
                            <div className="text-xs text-theme-text-muted">
                              {req.compliant_count}/{req.total_members} compliant
                            </div>
                          </div>
                          {/* Progress bar */}
                          <div className="w-24 h-2 bg-theme-surface-secondary rounded-full overflow-hidden">
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
                        <div className="border-t border-theme-surface-border">
                          {filteredMembers.length === 0 ? (
                            <div className="p-4 text-center text-theme-text-muted text-sm">
                              {complianceFilter === 'non-compliant' ? 'All members are compliant!' : 'No members found'}
                            </div>
                          ) : (
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b border-theme-surface-border bg-theme-surface-secondary">
                                  <th className="text-left py-2 px-4 text-theme-text-secondary font-medium">Member</th>
                                  <th className="text-left py-2 px-4 text-theme-text-secondary font-medium">Rank</th>
                                  <th className="text-right py-2 px-4 text-theme-text-secondary font-medium">Shifts</th>
                                  <th className="text-right py-2 px-4 text-theme-text-secondary font-medium">Hours</th>
                                  <th className="text-right py-2 px-4 text-theme-text-secondary font-medium">Progress</th>
                                  <th className="text-center py-2 px-4 text-theme-text-secondary font-medium">Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {filteredMembers.map((member) => (
                                  <tr key={member.user_id} className="border-b border-theme-surface-border hover:bg-theme-surface-hover">
                                    <td className="py-2 px-4">
                                      <span className="text-theme-text-primary font-medium">{member.full_name || `${member.first_name || ''} ${member.last_name || ''}`.trim() || member.user_id}</span>
                                    </td>
                                    <td className="py-2 px-4">
                                      <span className="text-theme-text-secondary text-xs">{formatRank(member.rank) || '-'}</span>
                                    </td>
                                    <td className="py-2 px-4 text-right text-theme-text-primary">{member.shift_count}</td>
                                    <td className="py-2 px-4 text-right text-theme-text-primary">{member.total_hours}</td>
                                    <td className="py-2 px-4 text-right">
                                      <div className="flex items-center justify-end gap-2">
                                        <div className="w-16 h-1.5 bg-theme-surface-secondary rounded-full overflow-hidden">
                                          <div
                                            className={`h-full rounded-full ${member.compliant ? 'bg-green-500' : 'bg-red-500'}`}
                                            style={{ width: `${member.percentage}%` }}
                                          />
                                        </div>
                                        <span className="text-xs text-theme-text-muted w-10 text-right">{member.percentage}%</span>
                                      </div>
                                    </td>
                                    <td className="py-2 px-4 text-center">
                                      {member.compliant ? (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400">
                                          <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                                          Compliant
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400">
                                          <XCircle className="w-3 h-3" aria-hidden="true" />
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
