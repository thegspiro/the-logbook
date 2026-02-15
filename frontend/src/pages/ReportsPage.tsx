/**
 * Reports Page
 *
 * Central hub for viewing and generating various reports.
 */

import React, { useState } from 'react';
import {
  FileText,
  Calendar as CalendarIcon,
  Users,
  TrendingUp,
  Download,
  Filter,
  AlertCircle,
  X,
  Loader2,
  ClipboardList,
  BarChart3,
} from 'lucide-react';
import { HelpLink } from '../components/HelpLink';
import { reportsService } from '../services/api';

interface ReportCard {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  category: 'member' | 'training' | 'event' | 'compliance';
  available: boolean;
  usesDateRange?: boolean;
}

/** Maps frontend report IDs to the API report_type values. */
const REPORT_TYPE_MAP: Record<string, string> = {
  'member-roster': 'member_roster',
  'training-summary': 'training_summary',
  'event-attendance': 'event_attendance',
  'training-progress': 'training_progress',
  'annual-training': 'annual_training',
};

type DatePreset = 'this-year' | 'last-year' | 'last-90' | 'custom';

const getPresetDates = (preset: DatePreset): { start: string; end: string } => {
  const now = new Date();
  switch (preset) {
    case 'this-year':
      return { start: `${now.getFullYear()}-01-01`, end: `${now.getFullYear()}-12-31` };
    case 'last-year':
      return { start: `${now.getFullYear() - 1}-01-01`, end: `${now.getFullYear() - 1}-12-31` };
    case 'last-90': {
      const ago = new Date(now);
      ago.setDate(ago.getDate() - 90);
      return { start: ago.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
    }
    default:
      return { start: '', end: '' };
  }
};

export const ReportsPage: React.FC = () => {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [reportData, setReportData] = useState<Record<string, unknown> | null>(null);
  const [activeReport, setActiveReport] = useState<ReportCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [datePreset, setDatePreset] = useState<DatePreset>('this-year');
  const [startDate, setStartDate] = useState<string>(() => getPresetDates('this-year').start);
  const [endDate, setEndDate] = useState<string>(() => getPresetDates('this-year').end);

  const handlePresetChange = (preset: DatePreset) => {
    setDatePreset(preset);
    if (preset !== 'custom') {
      const { start, end } = getPresetDates(preset);
      setStartDate(start);
      setEndDate(end);
    }
  };

  const reports: ReportCard[] = [
    {
      id: 'member-roster',
      title: 'Member Roster',
      description: 'Complete list of all active members with contact information',
      icon: Users,
      category: 'member',
      available: true,
    },
    {
      id: 'training-summary',
      title: 'Training Summary',
      description: 'Overview of training hours and certifications by member',
      icon: TrendingUp,
      category: 'training',
      available: true,
      usesDateRange: true,
    },
    {
      id: 'event-attendance',
      title: 'Event Attendance',
      description: 'Attendance records for all events and training sessions',
      icon: CalendarIcon,
      category: 'event',
      available: true,
      usesDateRange: true,
    },
    {
      id: 'training-progress',
      title: 'Training Progress',
      description: 'Pipeline enrollment progress, requirement completion, and member advancement',
      icon: ClipboardList,
      category: 'training',
      available: true,
    },
    {
      id: 'annual-training',
      title: 'Annual Training Report',
      description: 'Comprehensive annual breakdown of training hours, shift experience, and performance',
      icon: BarChart3,
      category: 'training',
      available: true,
      usesDateRange: true,
    },
    {
      id: 'compliance-status',
      title: 'Compliance Status',
      description: 'Current compliance status for certifications and requirements',
      icon: AlertCircle,
      category: 'compliance',
      available: false,
    },
  ];

  const categories = [
    { id: 'all', label: 'All Reports' },
    { id: 'member', label: 'Member Reports' },
    { id: 'training', label: 'Training Reports' },
    { id: 'event', label: 'Event Reports' },
    { id: 'compliance', label: 'Compliance Reports' },
  ];

  const filteredReports =
    selectedCategory === 'all'
      ? reports
      : reports.filter((r) => r.category === selectedCategory);

  const handleGenerateReport = async (report: ReportCard) => {
    const reportType = REPORT_TYPE_MAP[report.id];
    if (!reportType) return;

    setGeneratingId(report.id);
    setError(null);

    try {
      const params: { report_type: string; start_date?: string; end_date?: string } = {
        report_type: reportType,
      };

      if (report.usesDateRange && startDate) {
        params.start_date = startDate;
      }
      if (report.usesDateRange && endDate) {
        params.end_date = endDate;
      }

      const data = await reportsService.generateReport(params);
      setReportData(data);
      setActiveReport(report);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to generate report. Please try again.';
      setError(message);
    } finally {
      setGeneratingId(null);
    }
  };

  const closeModal = () => {
    setReportData(null);
    setActiveReport(null);
    setError(null);
  };

  // ---------------------------------------------------------------------------
  // Report-specific rendering helpers
  // ---------------------------------------------------------------------------

  const renderMemberRoster = (data: Record<string, unknown>) => {
    const members = (data.members ?? data.data ?? []) as Array<Record<string, unknown>>;
    const totalCount = (data.total_count ?? data.member_count ?? members.length) as number;

    return (
      <>
        <p className="text-sm text-slate-300 mb-4">
          Total members: <span className="font-semibold text-white">{totalCount}</span>
        </p>
        {members.length > 0 && (
          <div className="overflow-x-auto max-h-[50vh] overflow-y-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-400 uppercase bg-slate-900/50 sticky top-0">
                <tr>
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Email</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {members.map((m, i) => (
                  <tr key={i} className="text-slate-200">
                    <td className="px-4 py-2 whitespace-nowrap">
                      {String(m.first_name ?? m.name ?? '')} {String(m.last_name ?? '')}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">{String(m.email ?? '-')}</td>
                    <td className="px-4 py-2 whitespace-nowrap capitalize">{String(m.status ?? '-')}</td>
                    <td className="px-4 py-2 whitespace-nowrap capitalize">{String(m.role ?? '-')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {members.length === 0 && (
          <p className="text-slate-400 text-sm">No member records found.</p>
        )}
      </>
    );
  };

  const renderTrainingSummary = (data: Record<string, unknown>) => {
    const completionRate = data.completion_rate ?? data.overall_completion_rate;
    const entries = (data.entries ?? data.training_records ?? data.data ?? []) as Array<Record<string, unknown>>;

    return (
      <>
        {completionRate !== undefined && (
          <p className="text-sm text-slate-300 mb-4">
            Overall completion rate:{' '}
            <span className="font-semibold text-white">
              {typeof completionRate === 'number'
                ? `${Math.round(completionRate * (completionRate <= 1 ? 100 : 1))}%`
                : String(completionRate)}
            </span>
          </p>
        )}
        {entries.length > 0 && (
          <div className="overflow-x-auto max-h-[50vh] overflow-y-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-400 uppercase bg-slate-900/50 sticky top-0">
                <tr>
                  <th className="px-4 py-2">Member</th>
                  <th className="px-4 py-2">Course / Requirement</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Hours</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {entries.map((e, i) => (
                  <tr key={i} className="text-slate-200">
                    <td className="px-4 py-2 whitespace-nowrap">
                      {String(e.member_name ?? e.member ?? e.name ?? '-')}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {String(e.course ?? e.requirement ?? e.title ?? '-')}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap capitalize">
                      {String(e.status ?? e.completion_status ?? '-')}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {e.hours != null ? String(e.hours) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {entries.length === 0 && (
          <p className="text-slate-400 text-sm">No training entries found.</p>
        )}
      </>
    );
  };

  const renderEventAttendance = (data: Record<string, unknown>) => {
    const events = (data.events ?? data.data ?? []) as Array<Record<string, unknown>>;
    const overallRate = data.overall_attendance_rate ?? data.attendance_rate;

    return (
      <>
        {overallRate !== undefined && (
          <p className="text-sm text-slate-300 mb-4">
            Overall attendance rate:{' '}
            <span className="font-semibold text-white">
              {typeof overallRate === 'number'
                ? `${Math.round(overallRate * (overallRate <= 1 ? 100 : 1))}%`
                : String(overallRate)}
            </span>
          </p>
        )}
        {events.length > 0 && (
          <div className="overflow-x-auto max-h-[50vh] overflow-y-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-400 uppercase bg-slate-900/50 sticky top-0">
                <tr>
                  <th className="px-4 py-2">Event</th>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Attendees</th>
                  <th className="px-4 py-2">Attendance Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {events.map((ev, i) => {
                  const rate = ev.attendance_rate ?? ev.rate;
                  return (
                    <tr key={i} className="text-slate-200">
                      <td className="px-4 py-2 whitespace-nowrap">
                        {String(ev.title ?? ev.name ?? ev.event ?? '-')}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        {ev.date ? String(ev.date) : '-'}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        {ev.attendees != null ? String(ev.attendees) : ev.attendee_count != null ? String(ev.attendee_count) : '-'}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        {rate !== undefined && rate !== null
                          ? typeof rate === 'number'
                            ? `${Math.round(rate * (rate <= 1 ? 100 : 1))}%`
                            : String(rate)
                          : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {events.length === 0 && (
          <p className="text-slate-400 text-sm">No event attendance records found.</p>
        )}
      </>
    );
  };

  const renderTrainingProgress = (data: Record<string, unknown>) => {
    const entries = (data.entries ?? []) as Array<Record<string, unknown>>;
    const statusSummary = (data.status_summary ?? {}) as Record<string, number>;
    const avgProgress = data.average_progress;

    return (
      <>
        <div className="flex flex-wrap gap-4 mb-4">
          {avgProgress !== undefined && (
            <p className="text-sm text-slate-300">
              Average progress: <span className="font-semibold text-white">{String(avgProgress)}%</span>
            </p>
          )}
          {Object.entries(statusSummary).map(([status, count]) => (
            <span key={status} className="text-xs px-2 py-1 bg-white/10 rounded text-slate-300">
              {status}: <span className="font-semibold text-white">{count}</span>
            </span>
          ))}
        </div>
        {entries.length > 0 && (
          <div className="overflow-x-auto max-h-[50vh] overflow-y-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-400 uppercase bg-slate-900/50 sticky top-0">
                <tr>
                  <th className="px-4 py-2">Member</th>
                  <th className="px-4 py-2">Program</th>
                  <th className="px-4 py-2">Progress</th>
                  <th className="px-4 py-2">Requirements</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {entries.map((e, i) => (
                  <tr key={i} className="text-slate-200">
                    <td className="px-4 py-2 whitespace-nowrap">{String(e.member_name ?? '-')}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{String(e.program_name ?? '-')}</td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <div className="flex items-center space-x-2">
                        <div className="w-24 bg-slate-700 rounded-full h-2">
                          <div
                            className="bg-red-500 h-2 rounded-full"
                            style={{ width: `${Number(e.progress_percentage ?? 0)}%` }}
                          />
                        </div>
                        <span className="text-xs">{String(e.progress_percentage ?? 0)}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-xs">
                      {String(e.requirements_completed ?? 0)} / {String(e.requirements_total ?? 0)}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap capitalize">{String(e.status ?? '-')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {entries.length === 0 && (
          <p className="text-slate-400 text-sm">No pipeline enrollments found.</p>
        )}
      </>
    );
  };

  const renderAnnualTraining = (data: Record<string, unknown>) => {
    const summary = (data.summary ?? {}) as Record<string, unknown>;
    const entries = (data.entries ?? []) as Array<Record<string, unknown>>;
    const byType = (summary.training_by_type ?? {}) as Record<string, number>;

    return (
      <>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="bg-slate-900/50 rounded-lg p-3 text-center">
            <div className="text-xl font-bold text-white">{String(summary.total_combined_hours ?? 0)}</div>
            <div className="text-xs text-slate-400">Total Hours</div>
          </div>
          <div className="bg-slate-900/50 rounded-lg p-3 text-center">
            <div className="text-xl font-bold text-white">{String(summary.total_completions ?? 0)}</div>
            <div className="text-xs text-slate-400">Completions</div>
          </div>
          <div className="bg-slate-900/50 rounded-lg p-3 text-center">
            <div className="text-xl font-bold text-white">{String(summary.total_calls_responded ?? 0)}</div>
            <div className="text-xs text-slate-400">Calls Responded</div>
          </div>
          <div className="bg-slate-900/50 rounded-lg p-3 text-center">
            <div className="text-xl font-bold text-white">{String(summary.avg_hours_per_member ?? 0)}</div>
            <div className="text-xs text-slate-400">Avg Hours/Member</div>
          </div>
        </div>

        {Object.keys(byType).length > 0 && (
          <div className="mb-4">
            <p className="text-xs text-slate-400 mb-1">By Training Type:</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(byType).map(([type, count]) => (
                <span key={type} className="text-xs px-2 py-1 bg-white/10 rounded text-slate-300">
                  {type.replace(/_/g, ' ')}: <span className="font-semibold text-white">{count}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {entries.length > 0 && (
          <div className="overflow-x-auto max-h-[50vh] overflow-y-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-400 uppercase bg-slate-900/50 sticky top-0">
                <tr>
                  <th className="px-4 py-2">Member</th>
                  <th className="px-4 py-2">Rank</th>
                  <th className="px-4 py-2">Training Hrs</th>
                  <th className="px-4 py-2">Shift Hrs</th>
                  <th className="px-4 py-2">Courses</th>
                  <th className="px-4 py-2">Shifts</th>
                  <th className="px-4 py-2">Calls</th>
                  <th className="px-4 py-2">Rating</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {entries.map((e, i) => (
                  <tr key={i} className="text-slate-200">
                    <td className="px-4 py-2 whitespace-nowrap">{String(e.member_name ?? '-')}</td>
                    <td className="px-4 py-2 whitespace-nowrap capitalize">{String(e.rank ?? '-')}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{String(e.training_hours ?? 0)}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{String(e.shift_hours ?? 0)}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{String(e.courses_completed ?? 0)}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{String(e.shifts_completed ?? 0)}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{String(e.calls_responded ?? 0)}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{e.avg_performance_rating != null ? String(e.avg_performance_rating) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {entries.length === 0 && (
          <p className="text-slate-400 text-sm">No training data found for this period.</p>
        )}
      </>
    );
  };

  const renderReportContent = () => {
    if (!reportData || !activeReport) return null;

    switch (activeReport.id) {
      case 'member-roster':
        return renderMemberRoster(reportData);
      case 'training-summary':
        return renderTrainingSummary(reportData);
      case 'event-attendance':
        return renderEventAttendance(reportData);
      case 'training-progress':
        return renderTrainingProgress(reportData);
      case 'annual-training':
        return renderAnnualTraining(reportData);
      default:
        return (
          <pre className="text-sm text-slate-300 whitespace-pre-wrap overflow-auto max-h-[50vh]">
            {JSON.stringify(reportData, null, 2)}
          </pre>
        );
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Reports</h1>
            <p className="text-slate-300">
              Generate and download reports for members, training, events, and compliance
            </p>
          </div>
          <HelpLink
            topic="reports"
            variant="icon"
            tooltip="Click any report card to generate and download. Use the category filters to find specific report types. Reports with 'Coming Soon' badges are in development."
            tooltipPosition="left"
          />
        </div>
      </div>

      {/* Category Filter */}
      <div className="mb-6 flex items-center space-x-2">
        <Filter className="w-5 h-5 text-slate-400" aria-hidden="true" />
        <div className="flex flex-wrap gap-2">
          {categories.map((category) => (
            <button
              key={category.id}
              onClick={() => setSelectedCategory(category.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 ${
                selectedCategory === category.id
                  ? 'bg-red-600 text-white'
                  : 'bg-white/10 text-slate-300 hover:bg-white/20'
              }`}
            >
              {category.label}
            </button>
          ))}
        </div>
      </div>

      {/* Date Range Picker */}
      <div className="mb-6 bg-white/5 border border-white/10 rounded-lg p-4">
        <div className="flex items-center space-x-2 mb-3">
          <CalendarIcon className="w-4 h-4 text-slate-400" aria-hidden="true" />
          <span className="text-sm font-medium text-slate-300">Reporting Period</span>
          <span className="text-xs text-slate-500">(applies to date-based reports)</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {([
            { id: 'this-year' as DatePreset, label: 'This Year' },
            { id: 'last-year' as DatePreset, label: 'Last Year' },
            { id: 'last-90' as DatePreset, label: 'Last 90 Days' },
            { id: 'custom' as DatePreset, label: 'Custom' },
          ]).map((preset) => (
            <button
              key={preset.id}
              onClick={() => handlePresetChange(preset.id)}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 ${
                datePreset === preset.id
                  ? 'bg-red-600 text-white'
                  : 'bg-white/10 text-slate-300 hover:bg-white/20'
              }`}
            >
              {preset.label}
            </button>
          ))}

          <div className="flex items-center gap-2 ml-2">
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setDatePreset('custom');
              }}
              className="bg-slate-700 border border-white/20 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            <span className="text-slate-500 text-sm">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setDatePreset('custom');
              }}
              className="bg-slate-700 border border-white/20 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {error && !activeReport && (
        <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <div className="flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex-1">
              <p className="text-sm text-red-300">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Reports Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredReports.map((report) => {
          const Icon = report.icon;
          const isGenerating = generatingId === report.id;
          return (
            <div
              key={report.id}
              className={`bg-white/5 backdrop-blur-sm border border-white/10 rounded-lg p-6 transition-all ${
                report.available
                  ? 'hover:bg-white/10 hover:border-white/20 cursor-pointer'
                  : 'opacity-60 cursor-not-allowed'
              }`}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 bg-red-600/20 rounded-lg flex items-center justify-center">
                  <Icon className="w-6 h-6 text-red-500" aria-hidden="true" />
                </div>
                {!report.available && (
                  <span className="px-2 py-1 bg-yellow-500/20 text-yellow-300 text-xs font-medium rounded">
                    Coming Soon
                  </span>
                )}
              </div>

              <h3 className="text-lg font-semibold text-white mb-2">
                {report.title}
              </h3>
              <p className="text-sm text-slate-300 mb-4">{report.description}</p>

              {report.available && (
                <button
                  disabled={isGenerating}
                  className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-70 disabled:cursor-wait text-white text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
                  onClick={() => handleGenerateReport(report)}
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                      <span>Generating...</span>
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" aria-hidden="true" />
                      <span>Generate Report</span>
                    </>
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Empty State */}
      {filteredReports.length === 0 && (
        <div className="text-center py-12">
          <FileText className="w-16 h-16 text-slate-600 mx-auto mb-4" aria-hidden="true" />
          <h3 className="text-xl font-semibold text-white mb-2">
            No reports found
          </h3>
          <p className="text-slate-400">
            Try selecting a different category or check back later for new reports
          </p>
        </div>
      )}

      {/* Info Banner */}
      <div className="mt-8 bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
        <div className="flex items-start space-x-3">
          <AlertCircle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <h4 className="text-sm font-medium text-blue-300 mb-1">
              Report Generation
            </h4>
            <p className="text-sm text-blue-200">
              Reports are generated in real-time based on current data. Some reports may
              take a few moments to compile depending on the amount of data. Reports with
              "Coming Soon" badges are currently in development and will be available in
              future updates.
            </p>
          </div>
        </div>
      </div>

      {/* Report Results Modal */}
      {activeReport && reportData && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4">
            <div className="fixed inset-0 bg-black/60" onClick={closeModal} />
            <div className="relative bg-slate-800 rounded-lg shadow-xl max-w-4xl w-full border border-white/20">
              <div className="px-6 pt-5 pb-4">
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-red-600/20 rounded-lg flex items-center justify-center">
                      {React.createElement(activeReport.icon, {
                        className: 'w-5 h-5 text-red-500',
                        'aria-hidden': true,
                      })}
                    </div>
                    <div>
                      <h3 className="text-lg font-medium text-white">{activeReport.title}</h3>
                      {activeReport.usesDateRange && (!!reportData?.period_start || !!reportData?.period_end) && (
                        <p className="text-xs text-slate-400 mt-0.5">
                          {reportData.period_start ? String(reportData.period_start) : 'Start'} — {reportData.period_end ? String(reportData.period_end) : 'End'}
                        </p>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={closeModal}
                    className="text-slate-400 hover:text-white"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {renderReportContent()}
              </div>

              <div className="px-6 py-4 border-t border-white/10 flex justify-end">
                <button
                  onClick={closeModal}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReportsPage;
