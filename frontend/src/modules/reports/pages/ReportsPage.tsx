/**
 * Reports Page
 *
 * Central hub for viewing and generating departmental reports.
 * Supports 12 report types across 6 categories with export,
 * period comparison, and saved report functionality.
 */

import React, { useMemo } from 'react';
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
  Briefcase,
  Building,
  Shield,
  Truck,
  Package,
  Award,
  PhoneCall,
  GitCompareArrows,
} from 'lucide-react';
import { HelpLink } from '../../../components/HelpLink';
import { useTimezone } from '../../../hooks/useTimezone';
import { useRanks } from '../../../hooks/useRanks';
import { useReportsStore } from '../store/reportsStore';
import type { ReportCardDefinition, ReportData, DatePreset } from '../types';
import { ExportControls } from '../components/ExportControls';
import {
  MemberRosterRenderer,
  getMemberRosterExportData,
  TrainingSummaryRenderer,
  getTrainingSummaryExportData,
  EventAttendanceRenderer,
  getEventAttendanceExportData,
  TrainingProgressRenderer,
  getTrainingProgressExportData,
  AnnualTrainingRenderer,
  getAnnualTrainingExportData,
  AdminHoursRenderer,
  getAdminHoursExportData,
  DepartmentOverviewRenderer,
  getDepartmentOverviewExportData,
  CertExpirationRenderer,
  getCertExpirationExportData,
  ApparatusStatusRenderer,
  getApparatusStatusExportData,
  InventoryStatusRenderer,
  getInventoryStatusExportData,
  ComplianceStatusRenderer,
  getComplianceStatusExportData,
  CallVolumeRenderer,
  getCallVolumeExportData,
} from '../components/renderers';
import type {
  MemberRosterReport,
  TrainingSummaryReport,
  EventAttendanceReport,
  TrainingProgressReport,
  AnnualTrainingReport,
  AdminHoursReport,
  DepartmentOverviewReport,
  CertExpirationReport,
  ApparatusStatusReport,
  InventoryStatusReport,
  ComplianceStatusReport,
  CallVolumeReport,
} from '../types';

// ============================================================================
// Report type → API mapping
// ============================================================================

const REPORT_TYPE_MAP: Record<string, string> = {
  'member-roster': 'member_roster',
  'training-summary': 'training_summary',
  'event-attendance': 'event_attendance',
  'training-progress': 'training_progress',
  'annual-training': 'annual_training',
  'admin-hours': 'admin_hours',
  'department-overview': 'department_overview',
  'certification-expiration': 'certification_expiration',
  'apparatus-status': 'apparatus_status',
  'inventory-status': 'inventory_status',
  'compliance-status': 'compliance_status',
  'call-volume': 'call_volume',
};

// ============================================================================
// Icon mapping
// ============================================================================

const ICON_MAP: Record<string, React.ElementType> = {
  Users,
  TrendingUp,
  CalendarIcon,
  ClipboardList,
  BarChart3,
  Briefcase,
  Building,
  Shield,
  Truck,
  Package,
  Award,
  PhoneCall,
};

// ============================================================================
// Report definitions
// ============================================================================

const REPORT_CARDS: ReportCardDefinition[] = [
  {
    id: 'member-roster',
    title: 'Member Roster',
    description: 'Complete list of all active members with contact information',
    icon: 'Users',
    category: 'member',
    available: true,
  },
  {
    id: 'training-summary',
    title: 'Training Summary',
    description: 'Training hours, certifications, and completion rates by member',
    icon: 'TrendingUp',
    category: 'training',
    available: true,
    usesDateRange: true,
  },
  {
    id: 'event-attendance',
    title: 'Event Attendance',
    description: 'Attendance records and RSVP statistics for all events',
    icon: 'CalendarIcon',
    category: 'event',
    available: true,
    usesDateRange: true,
  },
  {
    id: 'training-progress',
    title: 'Training Progress',
    description: 'Pipeline enrollment progress and requirement completion',
    icon: 'ClipboardList',
    category: 'training',
    available: true,
  },
  {
    id: 'annual-training',
    title: 'Annual Training Report',
    description: 'Comprehensive annual breakdown of training hours, shift experience, and performance',
    icon: 'BarChart3',
    category: 'training',
    available: true,
    usesDateRange: true,
  },
  {
    id: 'admin-hours',
    title: 'Admin Hours Report',
    description: 'Administrative hours logged by members, broken down by category',
    icon: 'Briefcase',
    category: 'admin',
    available: true,
    usesDateRange: true,
  },
  {
    id: 'department-overview',
    title: 'Department Overview',
    description: 'Cross-module health report: members, training, events, and action items',
    icon: 'Building',
    category: 'compliance',
    available: true,
    usesDateRange: true,
  },
  {
    id: 'certification-expiration',
    title: 'Certification Expiration',
    description: 'Track expiring and overdue certifications across all members',
    icon: 'Award',
    category: 'compliance',
    available: true,
  },
  {
    id: 'compliance-status',
    title: 'Compliance Status',
    description: 'Member-by-member compliance against requirements with gap analysis',
    icon: 'Shield',
    category: 'compliance',
    available: true,
  },
  {
    id: 'apparatus-status',
    title: 'Fleet / Apparatus Status',
    description: 'Vehicle status, maintenance due dates, mileage, and work orders',
    icon: 'Truck',
    category: 'operations',
    available: true,
  },
  {
    id: 'inventory-status',
    title: 'Inventory Status',
    description: 'Stock levels, assigned equipment, and low-stock alerts',
    icon: 'Package',
    category: 'operations',
    available: true,
  },
  {
    id: 'call-volume',
    title: 'Incident / Call Volume',
    description: 'Call volume trends, incident type breakdown, and peak activity',
    icon: 'PhoneCall',
    category: 'operations',
    available: true,
    usesDateRange: true,
  },
];

const CATEGORIES = [
  { id: 'all', label: 'All Reports' },
  { id: 'member', label: 'Member' },
  { id: 'training', label: 'Training' },
  { id: 'event', label: 'Events' },
  { id: 'admin', label: 'Admin' },
  { id: 'compliance', label: 'Compliance' },
  { id: 'operations', label: 'Operations' },
];

const DATE_PRESETS: Array<{ id: DatePreset; label: string }> = [
  { id: 'this-year', label: 'This Year' },
  { id: 'last-year', label: 'Last Year' },
  { id: 'this-quarter', label: 'This Quarter' },
  { id: 'last-quarter', label: 'Last Quarter' },
  { id: 'last-90', label: 'Last 90 Days' },
  { id: 'last-30', label: 'Last 30 Days' },
  { id: 'custom', label: 'Custom' },
];

// ============================================================================
// Component
// ============================================================================

export const ReportsPage: React.FC = () => {
  const tz = useTimezone();
  const { formatRank } = useRanks();

  const {
    generatingReportType,
    activeReportData,
    activeReportType,
    datePreset,
    startDate,
    endDate,
    selectedCategory,
    comparisonData,
    comparisonPeriod,
    error,
    generateReport,
    clearActiveReport,
    setDatePreset,
    setCustomDates,
    setSelectedCategory,
    setError,
    generateComparisonReport,
    clearComparison,
  } = useReportsStore();

  const filteredReports = useMemo(
    () => (selectedCategory === 'all' ? REPORT_CARDS : REPORT_CARDS.filter((r) => r.category === selectedCategory)),
    [selectedCategory]
  );

  // Find the active card definition
  const activeCard = useMemo(
    () => REPORT_CARDS.find((r) => REPORT_TYPE_MAP[r.id] === activeReportType),
    [activeReportType]
  );

  const handleGenerateReport = async (card: ReportCardDefinition) => {
    const reportType = REPORT_TYPE_MAP[card.id];
    if (!reportType) return;

    const params: { report_type: string; start_date?: string; end_date?: string } = {
      report_type: reportType,
    };

    if (card.usesDateRange && startDate) {
      params.start_date = startDate;
    }
    if (card.usesDateRange && endDate) {
      params.end_date = endDate;
    }

    try {
      await generateReport(params);
    } catch {
      // Error is already set in store
    }
  };

  const handleComparePreviousPeriod = () => {
    if (!activeCard || !activeReportType) return;

    // Calculate the previous period of the same duration
    const start = new Date(startDate);
    const end = new Date(endDate);
    const durationMs = end.getTime() - start.getTime();
    const prevEnd = new Date(start.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - durationMs);

    const prevStartStr = prevStart.toISOString().slice(0, 10);
    const prevEndStr = prevEnd.toISOString().slice(0, 10);

    void generateComparisonReport({
      report_type: activeReportType,
      start_date: prevStartStr,
      end_date: prevEndStr,
    });
  };

  const handlePresetChange = (preset: DatePreset) => {
    setDatePreset(preset, tz);
    if (preset === 'custom') {
      // Keep current dates
    }
  };

  // ---- Report content renderer ----
  const renderReportContent = (data: ReportData, reportType: string) => {
    switch (reportType) {
      case 'member_roster':
        return <MemberRosterRenderer data={data as MemberRosterReport} />;
      case 'training_summary':
        return <TrainingSummaryRenderer data={data as TrainingSummaryReport} />;
      case 'event_attendance':
        return <EventAttendanceRenderer data={data as EventAttendanceReport} />;
      case 'training_progress':
        return <TrainingProgressRenderer data={data as TrainingProgressReport} />;
      case 'annual_training':
        return <AnnualTrainingRenderer data={data as AnnualTrainingReport} formatRank={formatRank} />;
      case 'admin_hours':
        return <AdminHoursRenderer data={data as AdminHoursReport} />;
      case 'department_overview':
        return <DepartmentOverviewRenderer data={data as DepartmentOverviewReport} />;
      case 'certification_expiration':
        return <CertExpirationRenderer data={data as CertExpirationReport} />;
      case 'apparatus_status':
        return <ApparatusStatusRenderer data={data as ApparatusStatusReport} />;
      case 'inventory_status':
        return <InventoryStatusRenderer data={data as InventoryStatusReport} />;
      case 'compliance_status':
        return <ComplianceStatusRenderer data={data as ComplianceStatusReport} />;
      case 'call_volume':
        return <CallVolumeRenderer data={data as CallVolumeReport} />;
      default:
        return (
          <pre className="text-theme-text-secondary max-h-[50vh] overflow-auto text-sm whitespace-pre-wrap">
            {JSON.stringify(data, null, 2)}
          </pre>
        );
    }
  };

  // ---- Export data resolver ----
  const getExportData = (data: ReportData, reportType: string) => {
    const exportMap: Record<
      string,
      (d: ReportData) => { rows: Array<Record<string, unknown>>; columns: Array<{ key: string; header: string }> }
    > = {
      member_roster: (d) => getMemberRosterExportData(d as MemberRosterReport),
      training_summary: (d) => getTrainingSummaryExportData(d as TrainingSummaryReport),
      event_attendance: (d) => getEventAttendanceExportData(d as EventAttendanceReport),
      training_progress: (d) => getTrainingProgressExportData(d as TrainingProgressReport),
      annual_training: (d) => getAnnualTrainingExportData(d as AnnualTrainingReport),
      admin_hours: (d) => getAdminHoursExportData(d as AdminHoursReport),
      department_overview: (d) => getDepartmentOverviewExportData(d as DepartmentOverviewReport),
      certification_expiration: (d) => getCertExpirationExportData(d as CertExpirationReport),
      apparatus_status: (d) => getApparatusStatusExportData(d as ApparatusStatusReport),
      inventory_status: (d) => getInventoryStatusExportData(d as InventoryStatusReport),
      compliance_status: (d) => getComplianceStatusExportData(d as ComplianceStatusReport),
      call_volume: (d) => getCallVolumeExportData(d as CallVolumeReport),
    };

    const fn = exportMap[reportType];
    return fn ? fn(data) : { rows: [], columns: [] };
  };

  const exportData = activeReportData && activeReportType ? getExportData(activeReportData, activeReportType) : null;

  const closeModal = () => {
    clearActiveReport();
    clearComparison();
  };

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-theme-text-primary mb-2 text-3xl font-bold">Reports</h1>
              <p className="text-theme-text-secondary">
                Generate, export, and compare departmental reports across all modules
              </p>
            </div>
            <HelpLink
              topic="reports"
              variant="icon"
              tooltip="Click any report card to generate. Use category filters and date range presets to customize. Export to CSV or print to PDF."
              tooltipPosition="left"
            />
          </div>
        </div>

        {/* Category Filter */}
        <div className="mb-6 flex items-center space-x-2">
          <Filter className="text-theme-text-muted h-5 w-5" aria-hidden="true" />
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((category) => (
              <button
                key={category.id}
                onClick={() => setSelectedCategory(category.id)}
                className={`focus:ring-theme-focus-ring rounded-lg px-4 py-2 text-sm font-medium transition-colors focus:ring-2 focus:outline-hidden ${
                  selectedCategory === category.id
                    ? 'bg-red-600 text-white'
                    : 'bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover'
                }`}
              >
                {category.label}
              </button>
            ))}
          </div>
        </div>

        {/* Date Range Picker */}
        <div className="card-secondary mb-6 p-4">
          <div className="mb-3 flex items-center space-x-2">
            <CalendarIcon className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
            <span className="text-theme-text-secondary text-sm font-medium">Reporting Period</span>
            <span className="text-theme-text-muted text-xs">(applies to date-based reports)</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {DATE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => handlePresetChange(preset.id)}
                className={`focus:ring-theme-focus-ring rounded px-3 py-1.5 text-sm font-medium transition-colors focus:ring-2 focus:outline-hidden ${
                  datePreset === preset.id
                    ? 'bg-red-600 text-white'
                    : 'bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover'
                }`}
              >
                {preset.label}
              </button>
            ))}

            <div className="ml-2 flex items-center gap-2">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setCustomDates(e.target.value, endDate)}
                className="form-input bg-theme-surface border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring rounded-sm border px-3 py-1.5 text-sm focus:ring-2 focus:outline-hidden"
              />
              <span className="text-theme-text-muted text-sm">to</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setCustomDates(startDate, e.target.value)}
                className="form-input bg-theme-surface border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring rounded-sm border px-3 py-1.5 text-sm focus:ring-2 focus:outline-hidden"
              />
            </div>
          </div>
        </div>

        {/* Error Banner */}
        {error && !activeCard && (
          <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
            <div className="flex items-start space-x-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" aria-hidden="true" />
              <div className="flex-1">
                <p className="text-sm text-red-300">{error}</p>
              </div>
              <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Reports Grid */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filteredReports.map((report) => {
            const Icon = ICON_MAP[report.icon] ?? FileText;
            const isGenerating = generatingReportType === REPORT_TYPE_MAP[report.id];
            return (
              <div
                key={report.id}
                className={`card-secondary p-6 backdrop-blur-xs transition-all ${
                  report.available
                    ? 'hover:bg-theme-surface hover:border-theme-surface-border cursor-pointer'
                    : 'cursor-not-allowed opacity-60'
                }`}
              >
                <div className="mb-4 flex items-start justify-between">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-red-600/20">
                    <Icon className="h-6 w-6 text-red-500" aria-hidden="true" />
                  </div>
                  {!report.available && (
                    <span className="rounded-sm bg-yellow-500/20 px-2 py-1 text-xs font-medium text-yellow-300">
                      Coming Soon
                    </span>
                  )}
                  {report.usesDateRange && report.available && (
                    <span className="rounded-sm bg-blue-500/20 px-2 py-1 text-xs font-medium text-blue-300">
                      Date Range
                    </span>
                  )}
                </div>

                <h3 className="text-theme-text-primary mb-2 text-lg font-semibold">{report.title}</h3>
                <p className="text-theme-text-secondary mb-4 text-sm">{report.description}</p>

                {report.available && (
                  <button
                    disabled={isGenerating}
                    className="btn-primary flex w-full items-center justify-center space-x-2 text-sm font-medium disabled:cursor-wait disabled:opacity-70"
                    onClick={() => {
                      void handleGenerateReport(report);
                    }}
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        <span>Generating...</span>
                      </>
                    ) : (
                      <>
                        <Download className="h-4 w-4" aria-hidden="true" />
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
          <div className="py-12 text-center">
            <FileText className="mx-auto mb-4 h-16 w-16 text-slate-600" aria-hidden="true" />
            <h3 className="text-theme-text-primary mb-2 text-xl font-semibold">No reports found</h3>
            <p className="text-theme-text-muted">Try selecting a different category</p>
          </div>
        )}

        {/* Info Banner */}
        <div className="mt-8 rounded-lg border border-blue-500/30 bg-blue-500/10 p-4">
          <div className="flex items-start space-x-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-blue-400" aria-hidden="true" />
            <div>
              <h4 className="mb-1 text-sm font-medium text-blue-300">Report Generation</h4>
              <p className="text-sm text-blue-200">
                Reports are generated in real-time. Use the date range presets or set a custom period for date-based
                reports. All reports can be exported to CSV or printed to PDF. Use the Compare button in the report
                modal to see period-over-period trends.
              </p>
            </div>
          </div>
        </div>

        {/* Report Results Modal */}
        {activeCard && activeReportData && activeReportType && (
          <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="flex min-h-screen items-center justify-center px-4">
              <div className="fixed inset-0 bg-black/60" onClick={closeModal} />
              <div className="bg-theme-surface-modal border-theme-surface-border relative w-full max-w-5xl rounded-lg border shadow-xl">
                {/* Modal header */}
                <div className="px-6 pt-5 pb-4">
                  <div className="mb-4 flex items-start justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-600/20">
                        {React.createElement(ICON_MAP[activeCard.icon] ?? FileText, {
                          className: 'w-5 h-5 text-red-500',
                          'aria-hidden': true,
                        })}
                      </div>
                      <div>
                        <h3 className="text-theme-text-primary text-lg font-medium">{activeCard.title}</h3>
                        {activeCard.usesDateRange && startDate && endDate && (
                          <p className="text-theme-text-muted mt-0.5 text-xs">
                            {startDate} — {endDate}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Export Controls */}
                      {exportData && (
                        <ExportControls
                          reportTitle={activeCard.title}
                          rows={exportData.rows}
                          columns={exportData.columns}
                        />
                      )}
                      {/* Compare button */}
                      {activeCard.usesDateRange && !comparisonData && (
                        <button
                          type="button"
                          onClick={handleComparePreviousPeriod}
                          className="bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover focus:ring-theme-focus-ring inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus:ring-2 focus:outline-hidden"
                        >
                          <GitCompareArrows className="h-3.5 w-3.5" aria-hidden="true" />
                          Compare
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={closeModal}
                        className="text-theme-text-muted hover:text-theme-text-primary"
                      >
                        <X className="h-5 w-5" />
                      </button>
                    </div>
                  </div>

                  {/* Main report content */}
                  {renderReportContent(activeReportData, activeReportType)}

                  {/* Comparison section */}
                  {comparisonData && comparisonPeriod && (
                    <div className="border-theme-surface-border mt-6 border-t pt-6">
                      <div className="mb-3 flex items-center justify-between">
                        <h4 className="text-theme-text-primary flex items-center gap-2 text-sm font-semibold">
                          <GitCompareArrows className="h-4 w-4" />
                          Previous Period: {comparisonPeriod.start} — {comparisonPeriod.end}
                        </h4>
                        <button
                          type="button"
                          onClick={clearComparison}
                          className="text-theme-text-muted hover:text-theme-text-primary text-xs"
                        >
                          Remove comparison
                        </button>
                      </div>
                      {renderReportContent(comparisonData, activeReportType)}
                    </div>
                  )}
                </div>

                {/* Modal footer */}
                <div className="border-theme-surface-border flex justify-end border-t px-6 py-4">
                  <button
                    onClick={closeModal}
                    className="bg-theme-surface hover:bg-theme-surface-hover text-theme-text-primary focus:ring-theme-focus-ring rounded-lg px-4 py-2 text-sm font-medium transition-colors focus:ring-2 focus:outline-hidden"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ReportsPage;
