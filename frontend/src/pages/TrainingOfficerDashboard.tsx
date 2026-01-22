import React, { useState } from 'react';
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
} from 'lucide-react';
import { AppLayout } from '../components/layout';

interface DashboardWidget {
  id: string;
  title: string;
  icon: React.ElementType;
  enabled: boolean;
  component: React.ReactNode;
}

/**
 * Training Officer Dashboard
 *
 * Main hub for training management with customizable widgets.
 * Officers can toggle which metrics and tools they want visible.
 */
const TrainingOfficerDashboard: React.FC = () => {
  const navigate = useNavigate();

  // Widget visibility preferences (would be saved to user preferences in production)
  const [widgets, setWidgets] = useState<DashboardWidget[]>([
    {
      id: 'compliance-overview',
      title: 'Compliance Overview',
      icon: CheckCircle,
      enabled: true,
      component: <ComplianceOverviewWidget />,
    },
    {
      id: 'upcoming-expirations',
      title: 'Upcoming Expirations',
      icon: AlertTriangle,
      enabled: true,
      component: <UpcomingExpirationsWidget />,
    },
    {
      id: 'recent-completions',
      title: 'Recent Completions',
      icon: Award,
      enabled: true,
      component: <RecentCompletionsWidget />,
    },
    {
      id: 'training-hours',
      title: 'Training Hours Summary',
      icon: Clock,
      enabled: true,
      component: <TrainingHoursSummaryWidget />,
    },
    {
      id: 'upcoming-sessions',
      title: 'Upcoming Training Sessions',
      icon: Calendar,
      enabled: true,
      component: <UpcomingSessionsWidget />,
    },
    {
      id: 'requirements-status',
      title: 'Requirements Status',
      icon: FileText,
      enabled: true,
      component: <RequirementsStatusWidget />,
    },
  ]);

  const [showSettings, setShowSettings] = useState(false);

  const toggleWidget = (widgetId: string) => {
    setWidgets(widgets.map(w =>
      w.id === widgetId ? { ...w, enabled: !w.enabled } : w
    ));
  };

  const enabledWidgets = widgets.filter(w => w.enabled);

  return (
    <AppLayout>
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

        {/* Dashboard Settings Panel */}
        {showSettings && (
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20 mb-6">
            <h3 className="text-white font-semibold mb-4">Customize Dashboard</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {widgets.map(widget => {
                const Icon = widget.icon;
                return (
                  <label
                    key={widget.id}
                    className="flex items-center space-x-3 p-3 bg-slate-800/50 rounded-lg cursor-pointer hover:bg-slate-800 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={widget.enabled}
                      onChange={() => toggleWidget(widget.id)}
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
            value="45"
            color="blue"
            onClick={() => navigate('/training/members')}
          />
          <StatCard
            icon={CheckCircle}
            label="Compliant"
            value="38"
            subtitle="84%"
            color="green"
            onClick={() => navigate('/training/compliance')}
          />
          <StatCard
            icon={AlertTriangle}
            label="Need Attention"
            value="7"
            subtitle="Expiring Soon"
            color="yellow"
            onClick={() => navigate('/training/expirations')}
          />
          <StatCard
            icon={Award}
            label="This Month"
            value="23"
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
            icon={Settings}
            title="External Integrations"
            description="Connect to Vector Solutions and other training platforms"
            onClick={() => navigate('/training/integrations')}
            color="cyan"
          />
        </div>

        {/* Customizable Widget Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {enabledWidgets.map(widget => (
            <div
              key={widget.id}
              className="bg-white/10 backdrop-blur-sm rounded-lg border border-white/20"
            >
              {widget.component}
            </div>
          ))}
        </div>
      </main>
    </AppLayout>
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

// Widget Components (Placeholders - will be implemented with real data)
const ComplianceOverviewWidget: React.FC = () => (
  <div className="p-6">
    <h3 className="text-white font-semibold mb-4">Department Compliance</h3>
    <div className="space-y-3">
      <ComplianceBar label="Annual Hours Requirement" percentage={84} />
      <ComplianceBar label="State Registry Current" percentage={92} />
      <ComplianceBar label="Certification Status" percentage={78} />
    </div>
  </div>
);

const UpcomingExpirationsWidget: React.FC = () => (
  <div className="p-6">
    <h3 className="text-white font-semibold mb-4">Upcoming Expirations</h3>
    <div className="space-y-3">
      <ExpirationItem member="John Smith" cert="EMT-B" daysLeft={14} />
      <ExpirationItem member="Jane Doe" cert="FF1" daysLeft={28} />
      <ExpirationItem member="Mike Johnson" cert="CPR" daysLeft={45} />
    </div>
  </div>
);

const RecentCompletionsWidget: React.FC = () => (
  <div className="p-6">
    <h3 className="text-white font-semibold mb-4">Recent Completions</h3>
    <div className="space-y-3">
      <CompletionItem member="Sarah Wilson" course="Hazmat Ops" date="2 days ago" />
      <CompletionItem member="Tom Brown" course="Pump Operations" date="1 week ago" />
      <CompletionItem member="Lisa Davis" course="Vehicle Rescue" date="1 week ago" />
    </div>
  </div>
);

const TrainingHoursSummaryWidget: React.FC = () => (
  <div className="p-6">
    <h3 className="text-white font-semibold mb-4">Training Hours (This Year)</h3>
    <div className="space-y-4">
      <div>
        <div className="flex justify-between text-sm mb-1">
          <span className="text-slate-400">Department Total</span>
          <span className="text-white font-semibold">1,247 hrs</span>
        </div>
        <div className="w-full bg-slate-800 rounded-full h-2">
          <div className="bg-green-600 h-2 rounded-full" style={{ width: '78%' }}></div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 pt-2">
        <div className="bg-slate-800/50 rounded p-3">
          <p className="text-slate-400 text-xs">Average per Member</p>
          <p className="text-white font-bold text-xl">27.7 hrs</p>
        </div>
        <div className="bg-slate-800/50 rounded p-3">
          <p className="text-slate-400 text-xs">Goal Progress</p>
          <p className="text-white font-bold text-xl">78%</p>
        </div>
      </div>
    </div>
  </div>
);

const UpcomingSessionsWidget: React.FC = () => (
  <div className="p-6">
    <h3 className="text-white font-semibold mb-4">Upcoming Sessions</h3>
    <div className="space-y-3">
      <SessionItem title="CPR/AED Renewal" date="Jan 25" attendees={12} />
      <SessionItem title="Hazmat Awareness" date="Jan 28" attendees={8} />
      <SessionItem title="Pump Operations" date="Feb 2" attendees={15} />
    </div>
  </div>
);

const RequirementsStatusWidget: React.FC = () => (
  <div className="p-6">
    <h3 className="text-white font-semibold mb-4">Requirements Status</h3>
    <div className="space-y-3">
      <RequirementStatus name="Annual Training Hours" status="on-track" progress={84} />
      <RequirementStatus name="State Certifications" status="needs-attention" progress={78} />
      <RequirementStatus name="Department Certifications" status="complete" progress={100} />
    </div>
  </div>
);

// Helper Components
const ComplianceBar: React.FC<{ label: string; percentage: number }> = ({ label, percentage }) => (
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
  </div>
);

const ExpirationItem: React.FC<{ member: string; cert: string; daysLeft: number }> = ({ member, cert, daysLeft }) => (
  <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded">
    <div>
      <p className="text-white text-sm font-medium">{member}</p>
      <p className="text-slate-400 text-xs">{cert}</p>
    </div>
    <span className={`text-xs font-semibold px-2 py-1 rounded ${daysLeft <= 30 ? 'bg-red-600 text-white' : 'bg-yellow-600 text-white'}`}>
      {daysLeft} days
    </span>
  </div>
);

const CompletionItem: React.FC<{ member: string; course: string; date: string }> = ({ member, course, date }) => (
  <div className="flex items-center space-x-3 p-3 bg-slate-800/50 rounded">
    <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
    <div className="flex-1 min-w-0">
      <p className="text-white text-sm font-medium truncate">{member}</p>
      <p className="text-slate-400 text-xs">{course}</p>
    </div>
    <span className="text-slate-500 text-xs whitespace-nowrap">{date}</span>
  </div>
);

const SessionItem: React.FC<{ title: string; date: string; attendees: number }> = ({ title, date, attendees }) => (
  <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded">
    <div>
      <p className="text-white text-sm font-medium">{title}</p>
      <p className="text-slate-400 text-xs">{date}</p>
    </div>
    <div className="flex items-center space-x-1 text-slate-400">
      <Users className="w-4 h-4" />
      <span className="text-xs">{attendees}</span>
    </div>
  </div>
);

const RequirementStatus: React.FC<{ name: string; status: 'complete' | 'on-track' | 'needs-attention'; progress: number }> = ({
  name,
  status,
  progress,
}) => {
  const statusConfig = {
    complete: { color: 'bg-green-600', label: 'Complete' },
    'on-track': { color: 'bg-blue-600', label: 'On Track' },
    'needs-attention': { color: 'bg-yellow-600', label: 'Needs Attention' },
  };

  return (
    <div className="p-3 bg-slate-800/50 rounded">
      <div className="flex items-center justify-between mb-2">
        <span className="text-white text-sm font-medium">{name}</span>
        <span className={`text-xs font-semibold px-2 py-1 rounded ${statusConfig[status].color} text-white`}>
          {statusConfig[status].label}
        </span>
      </div>
      <div className="w-full bg-slate-700 rounded-full h-1.5">
        <div className={`h-1.5 rounded-full ${statusConfig[status].color}`} style={{ width: `${progress}%` }}></div>
      </div>
    </div>
  );
};

export default TrainingOfficerDashboard;
