import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import toast from 'react-hot-toast';
import { organizationService } from '../services/userServices';
import {
  ArrowLeft,
  ClipboardList,
  Clock,
  Phone,
  Calendar,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Plus,
  Send,
  FileText,
  TrendingUp,
} from 'lucide-react';
import { shiftCompletionService, userService } from '../services/api';
import { useTimezone } from '../hooks/useTimezone';
import { formatDate } from '../utils/dateFormatting';
import type { ShiftCompletionReport, TraineeShiftStats } from '../types/training';
import { StarRating } from '../modules/scheduling/components/StarRating';
import { ReportContentDisplay } from '../modules/scheduling/components/ReportContentDisplay';

// ==================== Report Card ====================

const ReportCard: React.FC<{
  report: ShiftCompletionReport;
  memberMap: Record<string, string>;
}> = ({ report, memberMap }) => {
  const tz = useTimezone();
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-theme-surface border-theme-surface-border overflow-hidden rounded-lg border">
      <button
        onClick={() => setExpanded(!expanded)}
        className="hover:bg-theme-surface-hover w-full p-4 text-left transition-colors"
      >
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="mb-1 flex items-center space-x-2">
              <span className="text-theme-text-primary font-medium">{memberMap[report.trainee_id] || 'Unknown'}</span>
              {report.performance_rating && (
                <StarRating value={report.performance_rating} onChange={() => {}} size="sm" />
              )}
              {report.trainee_acknowledged && <CheckCircle2 className="h-4 w-4 text-green-700 dark:text-green-400" />}
            </div>
            <div className="text-theme-text-muted flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span className="flex items-center space-x-1">
                <Calendar className="h-3 w-3" />
                <span>{report.shift_date}</span>
              </span>
              <span className="flex items-center space-x-1">
                <Clock className="h-3 w-3" />
                <span>{report.hours_on_shift}h</span>
              </span>
              {report.calls_responded > 0 && (
                <span className="flex items-center space-x-1">
                  <Phone className="h-3 w-3" />
                  <span>{report.calls_responded} calls</span>
                </span>
              )}
            </div>
          </div>
          {expanded ? (
            <ChevronUp className="text-theme-text-muted h-5 w-5" />
          ) : (
            <ChevronDown className="text-theme-text-muted h-5 w-5" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-theme-surface-border space-y-3 border-t px-4 pt-3 pb-4">
          <ReportContentDisplay report={report} />
          {report.requirements_progressed && report.requirements_progressed.length > 0 && (
            <div className="rounded-sm border border-blue-500/30 bg-blue-500/10 p-2 text-xs text-blue-700 dark:text-blue-300">
              Updated {report.requirements_progressed.length} pipeline requirement(s)
            </div>
          )}
          <div className="text-theme-text-muted text-xs">
            Filed by: {memberMap[report.officer_id] || 'Unknown Officer'} on {formatDate(report.created_at, tz)}
          </div>
          {(report.reviewer_name || report.reviewed_by) && (
            <div className="text-theme-text-muted text-xs">
              Reviewed by: {report.reviewer_name || memberMap[report.reviewed_by || ''] || 'Unknown'}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ==================== Main Page ====================

interface SimpleUser {
  id: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  username: string;
}

const ShiftReportPage: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'new' | 'filed' | 'received'>('new');
  const [filedReports, setFiledReports] = useState<ShiftCompletionReport[]>([]);
  const [receivedReports, setReceivedReports] = useState<ShiftCompletionReport[]>([]);
  const [myStats, setMyStats] = useState<TraineeShiftStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [memberMap, setMemberMap] = useState<Record<string, string>>({});
  const [schedulingEnabled, setSchedulingEnabled] = useState(true);

  useEffect(() => {
    void loadData();
    organizationService
      .isModuleEnabled('scheduling')
      .then((enabled) => setSchedulingEnabled(enabled))
      .catch(() => {});
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [membersData, filedData, receivedData, statsData] = await Promise.all([
        userService.getUsers(),
        shiftCompletionService.getReportsByOfficer().catch(() => []),
        shiftCompletionService.getMyReports().catch(() => []),
        shiftCompletionService.getMyStats().catch(() => null),
      ]);

      const map: Record<string, string> = {};
      (membersData as SimpleUser[]).forEach((m) => {
        map[m.id] = m.full_name || `${m.first_name || ''} ${m.last_name || ''}`.trim() || m.username;
      });
      setMemberMap(map);
      setFiledReports(filedData);
      setReceivedReports(receivedData);
      setMyStats(statsData);
    } catch {
      // Error silently handled - empty state shown
    } finally {
      setLoading(false);
    }
  };

  const handleAcknowledge = async (reportId: string) => {
    try {
      await shiftCompletionService.acknowledgeReport(reportId);
      toast.success('Report acknowledged');
      void loadData();
    } catch {
      toast.error('Failed to acknowledge report');
    }
  };

  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6 flex items-center space-x-4">
          <button
            onClick={() => void navigate('/training/officer')}
            className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface rounded-lg p-2"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-theme-text-primary flex items-center space-x-2 text-2xl font-bold">
              <ClipboardList className="h-7 w-7 text-red-500" />
              <span>Shift Completion Reports</span>
            </h1>
            <p className="text-theme-text-muted text-sm">Document trainee performance and experiences during shifts</p>
          </div>
        </div>

        {/* Stats Bar */}
        {myStats && myStats.total_reports > 0 && (
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="bg-theme-surface rounded-lg p-3 text-center">
              <div className="text-theme-text-primary text-2xl font-bold">{myStats.total_reports}</div>
              <div className="text-theme-text-muted text-xs">Reports</div>
            </div>
            <div className="bg-theme-surface rounded-lg p-3 text-center">
              <div className="text-theme-text-primary text-2xl font-bold">{myStats.total_hours}</div>
              <div className="text-theme-text-muted text-xs">Shift Hours</div>
            </div>
            <div className="bg-theme-surface rounded-lg p-3 text-center">
              <div className="text-theme-text-primary text-2xl font-bold">{myStats.total_calls}</div>
              <div className="text-theme-text-muted text-xs">Calls</div>
            </div>
            <div className="bg-theme-surface rounded-lg p-3 text-center">
              <div className="text-theme-text-primary text-2xl font-bold">{myStats.avg_rating || '-'}</div>
              <div className="text-theme-text-muted text-xs">Avg Rating</div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="bg-theme-surface hscroll mb-6 flex space-x-1 rounded-lg p-1">
          <button
            onClick={() => setActiveTab('new')}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'new'
                ? 'bg-red-600 text-white'
                : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover'
            }`}
          >
            <Plus className="mr-1 inline h-4 w-4" /> New Report
          </button>
          <button
            onClick={() => setActiveTab('filed')}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'filed'
                ? 'bg-red-600 text-white'
                : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover'
            }`}
          >
            <FileText className="mr-1 inline h-4 w-4" /> Filed ({filedReports.length})
          </button>
          <button
            onClick={() => setActiveTab('received')}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'received'
                ? 'bg-red-600 text-white'
                : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover'
            }`}
          >
            <TrendingUp className="mr-1 inline h-4 w-4" /> My Reports ({receivedReports.length})
          </button>
        </div>

        {/* New Report — route to scheduling or manual entry */}
        {activeTab === 'new' && (
          <div className="bg-theme-surface border-theme-surface-border space-y-4 rounded-lg border p-8 text-center">
            <ClipboardList className="mx-auto h-12 w-12 text-red-500" />
            <h2 className="text-theme-text-primary text-lg font-semibold">File Shift Completion Report</h2>
            {schedulingEnabled ? (
              <>
                <p className="text-theme-text-secondary mx-auto max-w-md text-sm">
                  Shift reports are now filed from the Shift Scheduling section. Select a shift, validate hours and
                  calls for the entire crew, and evaluate trainees — all in one streamlined form.
                </p>
                <button
                  onClick={() => void navigate('/scheduling?tab=shift-reports&view=create')}
                  className="btn-primary inline-flex items-center gap-2 px-6 py-2.5 text-sm font-medium"
                >
                  <Send className="h-4 w-4" />
                  Go to Shift Reports
                </button>
              </>
            ) : (
              <>
                <p className="text-theme-text-secondary mx-auto max-w-md text-sm">
                  Log shift hours, calls, and evaluations for your crew members. Hours and calls will be credited to
                  each selected member.
                </p>
                <button
                  onClick={() => void navigate('/training/log-shift')}
                  className="btn-primary inline-flex items-center gap-2 px-6 py-2.5 text-sm font-medium"
                >
                  <Send className="h-4 w-4" />
                  Log Shift Report
                </button>
              </>
            )}
          </div>
        )}

        {/* Filed Reports */}
        {activeTab === 'filed' && (
          <div className="space-y-3">
            {loading ? (
              <div className="py-12 text-center">
                <div className="inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-red-500" />
              </div>
            ) : filedReports.length === 0 ? (
              <div className="bg-theme-surface rounded-lg py-12 text-center">
                <ClipboardList className="text-theme-text-muted mx-auto mb-4 h-16 w-16" />
                <p className="text-theme-text-muted">No reports filed yet.</p>
              </div>
            ) : (
              filedReports.map((r) => <ReportCard key={r.id} report={r} memberMap={memberMap} />)
            )}
          </div>
        )}

        {/* Received Reports (trainee view) */}
        {activeTab === 'received' && (
          <div className="space-y-3">
            {loading ? (
              <div className="py-12 text-center">
                <div className="inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-red-500" />
              </div>
            ) : receivedReports.length === 0 ? (
              <div className="bg-theme-surface rounded-lg py-12 text-center">
                <TrendingUp className="text-theme-text-muted mx-auto mb-4 h-16 w-16" />
                <p className="text-theme-text-muted">No shift reports about you yet.</p>
              </div>
            ) : (
              receivedReports.map((r) => (
                <div key={r.id}>
                  <ReportCard report={r} memberMap={memberMap} />
                  {!r.trainee_acknowledged && (
                    <div className="mt-1 flex justify-end">
                      <button
                        onClick={() => {
                          void handleAcknowledge(r.id);
                        }}
                        className="btn-success rounded-sm px-3 py-1 text-xs"
                      >
                        Acknowledge
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default ShiftReportPage;
