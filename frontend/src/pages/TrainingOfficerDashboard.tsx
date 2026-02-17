import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  GraduationCap,
  Users,
  AlertTriangle,
  CheckCircle,
  Clock,
  FileText,
  Settings,
  Plus,
  TrendingUp,
  Calendar,
  Award,
  RefreshCw,
  ClipboardCheck,
  ClipboardList,
} from 'lucide-react';
import { trainingService, userService, trainingSubmissionService } from '../services/api';
import { formatDate } from '../utils/dateFormatting';
import { useTimezone } from '../hooks/useTimezone';
import type { TrainingRequirement } from '../types/training';

interface DashboardStats {
  totalMembers: number;
  compliantMembers: number;
  compliancePercentage: number;
  expiringCount: number;
  completionsThisMonth: number;
  totalHoursThisYear: number;
  avgHoursPerMember: number;
}

interface MemberSummary {
  id: string;
  name: string;
  username: string;
}

interface ExpirationItem {
  id: string;
  memberName: string;
  memberId: string;
  courseName: string;
  daysLeft: number;
  expirationDate: string;
}

interface CompletionItem {
  id: string;
  memberName: string;
  memberId: string;
  courseName: string;
  completionDate: string;
  hoursCompleted: number;
}

/**
 * Training Officer Dashboard
 *
 * Main hub for training management with real-time data from APIs.
 * Officers can toggle which metrics and tools they want visible.
 */
const TrainingOfficerDashboard: React.FC = () => {
  const navigate = useNavigate();
  const tz = useTimezone();

  // Data states
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<DashboardStats>({
    totalMembers: 0,
    compliantMembers: 0,
    compliancePercentage: 0,
    expiringCount: 0,
    completionsThisMonth: 0,
    totalHoursThisYear: 0,
    avgHoursPerMember: 0,
  });
  const [expiringCertifications, setExpiringCertifications] = useState<ExpirationItem[]>([]);
  const [recentCompletions, setRecentCompletions] = useState<CompletionItem[]>([]);
  const [requirements, setRequirements] = useState<TrainingRequirement[]>([]);
  const [pendingSubmissionCount, setPendingSubmissionCount] = useState(0);
  const [_memberMap, setMemberMap] = useState<Map<string, MemberSummary>>(new Map());

  // Widget visibility preferences
  const [showSettings, setShowSettings] = useState(false);
  const [enabledWidgets, setEnabledWidgets] = useState({
    'compliance-overview': true,
    'upcoming-expirations': true,
    'recent-completions': true,
    'training-hours': true,
    'requirements-status': true,
  });

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch all data in parallel
      const [members, expiring, allRecords, reqs, pendingCount] = await Promise.all([
        userService.getUsers(),
        trainingService.getExpiringCertifications(90),
        trainingService.getRecords(),
        trainingService.getRequirements({ active_only: true }),
        trainingSubmissionService.getPendingCount().catch(() => ({ pending_count: 0 })),
      ]);
      setPendingSubmissionCount(pendingCount.pending_count);

      // Build member map for lookups
      const memberMapData = new Map<string, MemberSummary>();
      members.forEach((m) => {
        memberMapData.set(m.id, {
          id: m.id,
          name: m.full_name || `${m.first_name || ''} ${m.last_name || ''}`.trim() || m.username,
          username: m.username,
        });
      });
      setMemberMap(memberMapData);

      // Process expiring certifications
      const expiringItems: ExpirationItem[] = expiring.map((record) => {
        const member = memberMapData.get(record.user_id);
        const expDate = new Date(record.expiration_date!);
        const now = new Date();
        const daysLeft = Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return {
          id: record.id,
          memberName: member?.name || 'Unknown',
          memberId: record.user_id,
          courseName: record.course_name,
          daysLeft: Math.max(0, daysLeft),
          expirationDate: record.expiration_date!,
        };
      }).sort((a, b) => a.daysLeft - b.daysLeft);
      setExpiringCertifications(expiringItems);

      // Process recent completions (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const recentRecords = allRecords
        .filter((r) => r.status === 'completed' && r.completion_date)
        .filter((r) => new Date(r.completion_date!) >= thirtyDaysAgo)
        .sort((a, b) => new Date(b.completion_date!).getTime() - new Date(a.completion_date!).getTime());

      const completionItems: CompletionItem[] = recentRecords.slice(0, 10).map((record) => {
        const member = memberMapData.get(record.user_id);
        return {
          id: record.id,
          memberName: member?.name || 'Unknown',
          memberId: record.user_id,
          courseName: record.course_name,
          completionDate: record.completion_date!,
          hoursCompleted: record.hours_completed || 0,
        };
      });
      setRecentCompletions(completionItems);

      // Calculate stats
      const startOfYear = new Date(new Date().getFullYear(), 0, 1);
      const completedThisYear = allRecords.filter(
        (r) => r.status === 'completed' && r.completion_date && new Date(r.completion_date) >= startOfYear
      );
      const totalHours = completedThisYear.reduce((sum, r) => sum + (r.hours_completed || 0), 0);

      // Calculate compliance (members with no expired required training)
      const expiredByMember = new Map<string, number>();
      allRecords.forEach((r) => {
        if (r.expiration_date && new Date(r.expiration_date) < new Date()) {
          expiredByMember.set(r.user_id, (expiredByMember.get(r.user_id) || 0) + 1);
        }
      });
      const compliantCount = members.filter((m) => !expiredByMember.has(m.id)).length;

      setStats({
        totalMembers: members.length,
        compliantMembers: compliantCount,
        compliancePercentage: members.length > 0 ? Math.round((compliantCount / members.length) * 100) : 0,
        expiringCount: expiringItems.length,
        completionsThisMonth: recentRecords.length,
        totalHoursThisYear: totalHours,
        avgHoursPerMember: members.length > 0 ? Math.round((totalHours / members.length) * 10) / 10 : 0,
      });

      setRequirements(reqs);
    } catch (err) {
      setError('Unable to load training dashboard data. Please check your connection and refresh the page.');
    } finally {
      setLoading(false);
    }
  };

  const toggleWidget = (widgetId: keyof typeof enabledWidgets) => {
    setEnabledWidgets((prev) => ({
      ...prev,
      [widgetId]: !prev[widgetId],
    }));
  };

  const formatRelativeDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffDays = Math.ceil((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.ceil(diffDays / 7)} weeks ago`;
    return formatDate(dateString, tz);
  };

  if (loading) {
    return (
      <div className="min-h-screen">
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-center h-64">
            <div className="flex items-center space-x-3 text-white">
              <RefreshCw className="w-6 h-6 animate-spin" />
              <span>Loading training dashboard...</span>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center space-x-3">
              <GraduationCap className="w-8 h-8 text-red-500" />
              <span>Training Officer Dashboard</span>
            </h1>
            <p className="text-slate-400 mt-1">
              Manage training, track compliance, and monitor certifications
            </p>
          </div>

          <div className="flex items-center space-x-3">
            {/* Refresh Button */}
            <button
              onClick={fetchDashboardData}
              className="p-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
              title="Refresh Data"
            >
              <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
            </button>

            {/* Quick Actions */}
            <button
              onClick={() => navigate('/training/sessions/new')}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors flex items-center space-x-2"
            >
              <Plus className="w-5 h-5" />
              <span>New Training Session</span>
            </button>

            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
              title="Dashboard Settings"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 mb-6">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {/* Dashboard Settings Panel */}
        {showSettings && (
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20 mb-6">
            <h3 className="text-white font-semibold mb-4">Customize Dashboard</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {[
                { id: 'compliance-overview', title: 'Compliance Overview', icon: CheckCircle },
                { id: 'upcoming-expirations', title: 'Upcoming Expirations', icon: AlertTriangle },
                { id: 'recent-completions', title: 'Recent Completions', icon: Award },
                { id: 'training-hours', title: 'Training Hours Summary', icon: Clock },
                { id: 'requirements-status', title: 'Requirements Status', icon: FileText },
              ].map((widget) => {
                const Icon = widget.icon;
                return (
                  <label
                    key={widget.id}
                    className="flex items-center space-x-3 p-3 bg-slate-800/50 rounded-lg cursor-pointer hover:bg-slate-800 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={enabledWidgets[widget.id as keyof typeof enabledWidgets]}
                      onChange={() => toggleWidget(widget.id as keyof typeof enabledWidgets)}
                      className="w-4 h-4 rounded border-slate-600 bg-slate-900/50 text-red-600 focus:ring-red-500"
                    />
                    <Icon className="w-5 h-5 text-slate-400" />
                    <span className="text-slate-300 text-sm">{widget.title}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <StatCard
            icon={Users}
            label="Total Members"
            value={stats.totalMembers.toString()}
            color="blue"
            onClick={() => navigate('/training/members')}
          />
          <StatCard
            icon={CheckCircle}
            label="Compliant"
            value={stats.compliantMembers.toString()}
            subtitle={`${stats.compliancePercentage}%`}
            color="green"
            onClick={() => navigate('/training/compliance')}
          />
          <StatCard
            icon={AlertTriangle}
            label="Need Attention"
            value={stats.expiringCount.toString()}
            subtitle="Expiring Soon"
            color="yellow"
            onClick={() => navigate('/training/expirations')}
          />
          <StatCard
            icon={Award}
            label="This Month"
            value={stats.completionsThisMonth.toString()}
            subtitle="Completions"
            color="purple"
          />
        </div>

        {/* Main Navigation Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          <NavigationCard
            icon={FileText}
            title="Training Requirements"
            description="Manage department, state, and national training requirements"
            onClick={() => navigate('/training/requirements')}
            color="red"
          />
          <NavigationCard
            icon={Users}
            title="Member Progress"
            description="Track individual member training progress and compliance"
            onClick={() => navigate('/training/members')}
            color="blue"
          />
          <NavigationCard
            icon={Calendar}
            title="Training Sessions"
            description="Schedule and manage upcoming training sessions"
            onClick={() => navigate('/training/sessions')}
            color="green"
          />
          <NavigationCard
            icon={GraduationCap}
            title="Courses & Certifications"
            description="Manage available courses and certification programs"
            onClick={() => navigate('/training/courses')}
            color="purple"
          />
          <NavigationCard
            icon={TrendingUp}
            title="Reports & Analytics"
            description="Generate compliance reports and training analytics"
            onClick={() => navigate('/training/reports')}
            color="orange"
          />
          <NavigationCard
            icon={ClipboardList}
            title="Shift Reports"
            description="File and review shift completion reports for trainees"
            onClick={() => navigate('/training/shift-reports')}
            color="orange"
          />
          <NavigationCard
            icon={ClipboardCheck}
            title="Review Submissions"
            description={pendingSubmissionCount > 0 ? `${pendingSubmissionCount} pending submissions to review` : 'Review member self-reported training'}
            onClick={() => navigate('/training/submissions')}
            color="yellow"
          />
          <NavigationCard
            icon={FileText}
            title="Submit Training"
            description="Submit external training for yourself"
            onClick={() => navigate('/training/submit')}
            color="cyan"
          />
          <NavigationCard
            icon={Settings}
            title="External Integrations"
            description="Connect to Vector Solutions and other training platforms"
            onClick={() => navigate('/training/integrations')}
            color="cyan"
          />
        </div>

        {/* Customizable Widget Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {enabledWidgets['compliance-overview'] && (
            <div className="bg-white/10 backdrop-blur-sm rounded-lg border border-white/20">
              <ComplianceOverviewWidget stats={stats} />
            </div>
          )}
          {enabledWidgets['upcoming-expirations'] && (
            <div className="bg-white/10 backdrop-blur-sm rounded-lg border border-white/20">
              <UpcomingExpirationsWidget
                expirations={expiringCertifications.slice(0, 5)}
                onViewMember={(memberId) => navigate(`/members/${memberId}/training`)}
              />
            </div>
          )}
          {enabledWidgets['recent-completions'] && (
            <div className="bg-white/10 backdrop-blur-sm rounded-lg border border-white/20">
              <RecentCompletionsWidget
                completions={recentCompletions.slice(0, 5)}
                formatDate={formatRelativeDate}
              />
            </div>
          )}
          {enabledWidgets['training-hours'] && (
            <div className="bg-white/10 backdrop-blur-sm rounded-lg border border-white/20">
              <TrainingHoursSummaryWidget stats={stats} />
            </div>
          )}
          {enabledWidgets['requirements-status'] && (
            <div className="bg-white/10 backdrop-blur-sm rounded-lg border border-white/20">
              <RequirementsStatusWidget requirements={requirements} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

// Stat Card Component
interface StatCardProps {
  icon: React.ElementType;
  label: string;
  value: string;
  subtitle?: string;
  color: 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'orange' | 'cyan';
  onClick?: () => void;
}

const StatCard: React.FC<StatCardProps> = ({ icon: Icon, label, value, subtitle, color, onClick }) => {
  const colorClasses = {
    blue: 'bg-blue-600',
    green: 'bg-green-600',
    yellow: 'bg-yellow-600',
    red: 'bg-red-600',
    purple: 'bg-purple-600',
    orange: 'bg-orange-600',
    cyan: 'bg-cyan-600',
  };

  return (
    <div
      onClick={onClick}
      className={`bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20 ${
        onClick ? 'cursor-pointer hover:bg-white/15 transition-colors' : ''
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-slate-400 text-sm font-medium">{label}</p>
          <p className="text-white text-3xl font-bold mt-1">{value}</p>
          {subtitle && <p className="text-slate-400 text-xs mt-1">{subtitle}</p>}
        </div>
        <div className={`${colorClasses[color]} rounded-full p-3`}>
          <Icon className="w-6 h-6 text-white" />
        </div>
      </div>
    </div>
  );
};

// Navigation Card Component
interface NavigationCardProps {
  icon: React.ElementType;
  title: string;
  description: string;
  color: 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'orange' | 'cyan';
  onClick: () => void;
}

const NavigationCard: React.FC<NavigationCardProps> = ({ icon: Icon, title, description, color, onClick }) => {
  const colorClasses = {
    blue: 'from-blue-600 to-blue-700',
    green: 'from-green-600 to-green-700',
    yellow: 'from-yellow-600 to-yellow-700',
    red: 'from-red-600 to-red-700',
    purple: 'from-purple-600 to-purple-700',
    orange: 'from-orange-600 to-orange-700',
    cyan: 'from-cyan-600 to-cyan-700',
  };

  return (
    <button
      onClick={onClick}
      className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20 hover:bg-white/15 transition-all text-left group"
    >
      <div className={`bg-gradient-to-br ${colorClasses[color]} rounded-lg p-3 w-fit mb-4 group-hover:scale-110 transition-transform`}>
        <Icon className="w-6 h-6 text-white" />
      </div>
      <h3 className="text-white font-bold text-lg mb-2">{title}</h3>
      <p className="text-slate-400 text-sm">{description}</p>
    </button>
  );
};

// Widget Components with Real Data

interface ComplianceOverviewWidgetProps {
  stats: DashboardStats;
}

const ComplianceOverviewWidget: React.FC<ComplianceOverviewWidgetProps> = ({ stats }) => (
  <div className="p-6">
    <h3 className="text-white font-semibold mb-4">Department Compliance</h3>
    <div className="space-y-3">
      <ComplianceBar
        label="Member Compliance"
        percentage={stats.compliancePercentage}
        detail={`${stats.compliantMembers} of ${stats.totalMembers} members`}
      />
      <ComplianceBar
        label="Training Hours Goal"
        percentage={Math.min(100, Math.round((stats.totalHoursThisYear / Math.max(1, stats.totalMembers * 40)) * 100))}
        detail={`${stats.totalHoursThisYear} total hours this year`}
      />
    </div>
  </div>
);

interface UpcomingExpirationsWidgetProps {
  expirations: ExpirationItem[];
  onViewMember: (memberId: string) => void;
}

const UpcomingExpirationsWidget: React.FC<UpcomingExpirationsWidgetProps> = ({ expirations, onViewMember }) => (
  <div className="p-6">
    <h3 className="text-white font-semibold mb-4">Upcoming Expirations</h3>
    {expirations.length === 0 ? (
      <p className="text-slate-400 text-sm">No certifications expiring soon!</p>
    ) : (
      <div className="space-y-3">
        {expirations.map((item) => (
          <div
            key={item.id}
            onClick={() => onViewMember(item.memberId)}
            className="flex items-center justify-between p-3 bg-slate-800/50 rounded cursor-pointer hover:bg-slate-800 transition-colors"
          >
            <div>
              <p className="text-white text-sm font-medium">{item.memberName}</p>
              <p className="text-slate-400 text-xs">{item.courseName}</p>
            </div>
            <span
              className={`text-xs font-semibold px-2 py-1 rounded ${
                item.daysLeft <= 14 ? 'bg-red-600 text-white' : item.daysLeft <= 30 ? 'bg-orange-600 text-white' : 'bg-yellow-600 text-white'
              }`}
            >
              {item.daysLeft} days
            </span>
          </div>
        ))}
      </div>
    )}
  </div>
);

interface RecentCompletionsWidgetProps {
  completions: CompletionItem[];
  formatDate: (date: string) => string;
}

const RecentCompletionsWidget: React.FC<RecentCompletionsWidgetProps> = ({ completions, formatDate }) => (
  <div className="p-6">
    <h3 className="text-white font-semibold mb-4">Recent Completions</h3>
    {completions.length === 0 ? (
      <p className="text-slate-400 text-sm">No recent completions.</p>
    ) : (
      <div className="space-y-3">
        {completions.map((item) => (
          <div key={item.id} className="flex items-center space-x-3 p-3 bg-slate-800/50 rounded">
            <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium truncate">{item.memberName}</p>
              <p className="text-slate-400 text-xs">{item.courseName}</p>
            </div>
            <span className="text-slate-500 text-xs whitespace-nowrap">{formatDate(item.completionDate)}</span>
          </div>
        ))}
      </div>
    )}
  </div>
);

interface TrainingHoursSummaryWidgetProps {
  stats: DashboardStats;
}

const TrainingHoursSummaryWidget: React.FC<TrainingHoursSummaryWidgetProps> = ({ stats }) => {
  const yearGoal = Math.max(1, stats.totalMembers * 40); // Assuming 40 hours/year goal per member
  const progressPercent = Math.min(100, Math.round((stats.totalHoursThisYear / yearGoal) * 100));

  return (
    <div className="p-6">
      <h3 className="text-white font-semibold mb-4">Training Hours (This Year)</h3>
      <div className="space-y-4">
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-slate-400">Department Total</span>
            <span className="text-white font-semibold">{stats.totalHoursThisYear.toLocaleString()} hrs</span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-2">
            <div className="bg-green-600 h-2 rounded-full" style={{ width: `${progressPercent}%` }}></div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 pt-2">
          <div className="bg-slate-800/50 rounded p-3">
            <p className="text-slate-400 text-xs">Average per Member</p>
            <p className="text-white font-bold text-xl">{stats.avgHoursPerMember} hrs</p>
          </div>
          <div className="bg-slate-800/50 rounded p-3">
            <p className="text-slate-400 text-xs">Goal Progress</p>
            <p className="text-white font-bold text-xl">{progressPercent}%</p>
          </div>
        </div>
      </div>
    </div>
  );
};

interface RequirementsStatusWidgetProps {
  requirements: TrainingRequirement[];
}

const RequirementsStatusWidget: React.FC<RequirementsStatusWidgetProps> = ({ requirements }) => {
  const now = new Date();

  const getRequirementStatus = (req: TrainingRequirement): 'complete' | 'on-track' | 'needs-attention' => {
    if (!req.due_date) return 'on-track';
    const dueDate = new Date(req.due_date);
    const daysUntilDue = (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    if (daysUntilDue < 0) return 'needs-attention';
    if (daysUntilDue < 30) return 'needs-attention';
    return 'on-track';
  };

  return (
    <div className="p-6">
      <h3 className="text-white font-semibold mb-4">Requirements Status</h3>
      {requirements.length === 0 ? (
        <p className="text-slate-400 text-sm">No active requirements.</p>
      ) : (
        <div className="space-y-3">
          {requirements.slice(0, 5).map((req) => {
            const status = getRequirementStatus(req);
            return (
              <RequirementStatusItem key={req.id} name={req.name} status={status} />
            );
          })}
        </div>
      )}
    </div>
  );
};

// Helper Components

interface ComplianceBarProps {
  label: string;
  percentage: number;
  detail?: string;
}

const ComplianceBar: React.FC<ComplianceBarProps> = ({ label, percentage, detail }) => (
  <div>
    <div className="flex justify-between text-sm mb-1">
      <span className="text-slate-400">{label}</span>
      <span className="text-white font-semibold">{percentage}%</span>
    </div>
    <div className="w-full bg-slate-800 rounded-full h-2">
      <div
        className={`h-2 rounded-full ${percentage >= 80 ? 'bg-green-600' : percentage >= 60 ? 'bg-yellow-600' : 'bg-red-600'}`}
        style={{ width: `${percentage}%` }}
      ></div>
    </div>
    {detail && <p className="text-slate-500 text-xs mt-1">{detail}</p>}
  </div>
);

interface RequirementStatusItemProps {
  name: string;
  status: 'complete' | 'on-track' | 'needs-attention';
}

const RequirementStatusItem: React.FC<RequirementStatusItemProps> = ({ name, status }) => {
  const statusConfig = {
    complete: { color: 'bg-green-600', label: 'Complete' },
    'on-track': { color: 'bg-blue-600', label: 'On Track' },
    'needs-attention': { color: 'bg-yellow-600', label: 'Needs Attention' },
  };

  return (
    <div className="p-3 bg-slate-800/50 rounded">
      <div className="flex items-center justify-between">
        <span className="text-white text-sm font-medium truncate flex-1 mr-2">{name}</span>
        <span className={`text-xs font-semibold px-2 py-1 rounded ${statusConfig[status].color} text-white whitespace-nowrap`}>
          {statusConfig[status].label}
        </span>
      </div>
    </div>
  );
};

export default TrainingOfficerDashboard;
