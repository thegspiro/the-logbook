import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users,
  Calendar,
  FileText,
  GraduationCap,
  Package,
  Clock,
  Vote,
  ClipboardList,
  BarChart3,
  Bell,
  Smartphone,
  FormInput,
  Plug,
  CheckCircle,
  XCircle,
  Clock4,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { apiClient } from '../services/api-client';

interface Module {
  id: string;
  name: string;
  description: string;
  icon: React.ElementType;
  priority: 'essential' | 'recommended' | 'optional';
  category: string;
  status?: 'enabled' | 'skipped' | 'ignored';
  configRoute?: string;
}

const ModuleOverview: React.FC = () => {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);

  const modules: Module[] = [
    // Essential Modules
    {
      id: 'members',
      name: 'Member Management',
      description: 'Manage your department roster, roles, contact information, and member profiles. Core functionality for any organization.',
      icon: Users,
      priority: 'essential',
      category: 'Core',
      configRoute: '/onboarding/modules/members/config',
    },
    {
      id: 'events',
      name: 'Events & RSVP',
      description: 'Create events, track RSVPs, manage attendance, and send event notifications. Perfect for meetings, trainings, and social gatherings.',
      icon: Calendar,
      priority: 'essential',
      category: 'Core',
      configRoute: '/onboarding/modules/events/config',
    },
    {
      id: 'documents',
      name: 'Documents & Files',
      description: 'Centralized document storage for SOPs, policies, forms, and department files. Keep everything organized and accessible.',
      icon: FileText,
      priority: 'essential',
      category: 'Core',
      configRoute: '/onboarding/modules/documents/config',
    },

    // Operations Modules
    {
      id: 'training',
      name: 'Training & Certifications',
      description: 'Track required certifications, training completions, and expiration dates. Ensure compliance and readiness.',
      icon: GraduationCap,
      priority: 'recommended',
      category: 'Operations',
      configRoute: '/onboarding/modules/training/config',
    },
    {
      id: 'inventory',
      name: 'Equipment & Inventory',
      description: 'Manage equipment, track maintenance schedules, and monitor inventory levels. Keep your gear mission-ready.',
      icon: Package,
      priority: 'recommended',
      category: 'Operations',
      configRoute: '/onboarding/modules/inventory/config',
    },
    {
      id: 'scheduling',
      name: 'Scheduling & Shifts',
      description: 'Create shift schedules, manage duty rosters, and handle shift trades. Simplify workforce planning.',
      icon: Clock,
      priority: 'recommended',
      category: 'Operations',
      configRoute: '/onboarding/modules/scheduling/config',
    },

    // Governance Modules
    {
      id: 'elections',
      name: 'Elections & Voting',
      description: 'Run officer elections with secure voting, multiple voting methods, and automatic result tabulation.',
      icon: Vote,
      priority: 'recommended',
      category: 'Governance',
      configRoute: '/onboarding/modules/elections/config',
    },
    {
      id: 'minutes',
      name: 'Meeting Minutes',
      description: 'Record meeting minutes, track action items, and maintain organizational history. Stay compliant and organized.',
      icon: ClipboardList,
      priority: 'optional',
      category: 'Governance',
      configRoute: '/onboarding/modules/minutes/config',
    },
    {
      id: 'reports',
      name: 'Reports & Analytics',
      description: 'Generate custom reports, view analytics dashboards, and export data. Make data-driven decisions.',
      icon: BarChart3,
      priority: 'optional',
      category: 'Governance',
      configRoute: '/onboarding/modules/reports/config',
    },

    // Optional/Advanced Modules
    {
      id: 'notifications',
      name: 'Email Notifications',
      description: 'Automated email notifications for events, reminders, and important updates. Keep everyone informed.',
      icon: Bell,
      priority: 'optional',
      category: 'Communication',
      configRoute: '/onboarding/modules/notifications/config',
    },
    {
      id: 'mobile',
      name: 'Mobile App Access',
      description: 'Progressive web app for mobile access. Members can check in, view schedules, and stay connected on-the-go.',
      icon: Smartphone,
      priority: 'optional',
      category: 'Communication',
      configRoute: '/onboarding/modules/mobile/config',
    },
    {
      id: 'forms',
      name: 'Custom Forms',
      description: 'Create custom forms for incident reports, surveys, feedback, and more. Collect structured data easily.',
      icon: FormInput,
      priority: 'optional',
      category: 'Advanced',
      configRoute: '/onboarding/modules/forms/config',
    },
    {
      id: 'integrations',
      name: 'External Integrations',
      description: 'Connect with external tools like Google Calendar, Slack, and more. Extend platform capabilities.',
      icon: Plug,
      priority: 'optional',
      category: 'Advanced',
      configRoute: '/onboarding/modules/integrations/config',
    },
  ];

  const [moduleStatuses, setModuleStatuses] = useState<Record<string, 'enabled' | 'skipped' | 'ignored'>>(
    // Essential modules enabled by default
    modules
      .filter(m => m.priority === 'essential')
      .reduce((acc, m) => ({ ...acc, [m.id]: 'enabled' }), {})
  );

  const handleModuleAction = async (moduleId: string, action: 'start' | 'skip' | 'ignore') => {
    const module = modules.find(m => m.id === moduleId);

    if (action === 'start' && module?.configRoute) {
      // Save current state and navigate to module config
      setModuleStatuses(prev => ({ ...prev, [moduleId]: 'enabled' }));
      navigate(module.configRoute);
    } else if (action === 'skip') {
      setModuleStatuses(prev => ({ ...prev, [moduleId]: 'skipped' }));
      toast.success(`${module?.name} marked as "Configure Later"`);
    } else if (action === 'ignore') {
      setModuleStatuses(prev => ({ ...prev, [moduleId]: 'ignored' }));
      toast.success(`${module?.name} disabled`);
    }
  };

  const handleContinue = async () => {
    setSaving(true);

    try {
      // Save module configuration to server
      const response = await apiClient.saveModuleConfig({
        modules: Object.entries(moduleStatuses)
          .filter(([_, status]) => status === 'enabled')
          .map(([id]) => id),
      });

      if (response.error) {
        toast.error(response.error);
        setSaving(false);
        return;
      }

      toast.success('Module configuration saved!');

      // Navigate to admin user creation
      navigate('/onboarding/admin-user');
    } catch (err: any) {
      toast.error(err.message || 'Failed to save module configuration');
      setSaving(false);
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'essential': return 'text-red-400 bg-red-500/10 border-red-500/30';
      case 'recommended': return 'text-blue-400 bg-blue-500/10 border-blue-500/30';
      case 'optional': return 'text-slate-400 bg-slate-500/10 border-slate-500/30';
      default: return 'text-slate-400 bg-slate-500/10 border-slate-500/30';
    }
  };

  const getStatusIcon = (status?: string) => {
    switch (status) {
      case 'enabled': return <CheckCircle className="w-4 h-4 text-green-400" />;
      case 'skipped': return <Clock4 className="w-4 h-4 text-yellow-400" />;
      case 'ignored': return <XCircle className="w-4 h-4 text-slate-500" />;
      default: return null;
    }
  };

  const groupedModules = {
    essential: modules.filter(m => m.priority === 'essential'),
    recommended: modules.filter(m => m.priority === 'recommended'),
    optional: modules.filter(m => m.priority === 'optional'),
  };

  const enabledCount = Object.values(moduleStatuses).filter(s => s === 'enabled').length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900 flex items-center justify-center p-4">
      <div className="max-w-6xl w-full py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-red-600 rounded-full mb-4">
            <Package className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-3">
            Choose Your Modules
          </h1>
          <p className="text-xl text-slate-300 mb-2">
            Select which features you want to use
          </p>
          <p className="text-sm text-slate-400 max-w-2xl mx-auto">
            Don't worry - you can enable, disable, or reconfigure any module at any time from your dashboard.
            The platform is designed to be flexible and adapt to your needs as they evolve.
          </p>
        </div>

        {/* Stats Banner */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20 mb-6 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="text-white">
              <span className="text-2xl font-bold">{enabledCount}</span>
              <span className="text-slate-400 ml-2">modules enabled</span>
            </div>
          </div>
          <button
            onClick={handleContinue}
            disabled={saving || enabledCount === 0}
            className={`px-6 py-2 rounded-lg font-semibold transition-all ${
              enabledCount > 0 && !saving
                ? 'bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white'
                : 'bg-slate-700 text-slate-400 cursor-not-allowed'
            }`}
          >
            {saving ? 'Saving...' : 'Continue to Dashboard'}
          </button>
        </div>

        {/* Essential Modules */}
        <div className="mb-8">
          <div className="flex items-center mb-4">
            <div className="flex-1 h-px bg-red-500/30"></div>
            <h2 className="px-4 text-lg font-bold text-red-400">ESSENTIAL MODULES</h2>
            <div className="flex-1 h-px bg-red-500/30"></div>
          </div>
          <p className="text-center text-slate-400 text-sm mb-6">
            These core modules are recommended for all departments and are enabled by default
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {groupedModules.essential.map(module => {
              const Icon = module.icon;
              const status = moduleStatuses[module.id];
              return (
                <div
                  key={module.id}
                  className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border-2 border-red-500/30 hover:border-red-500/50 transition-all"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center space-x-3">
                      <div className="w-12 h-12 bg-red-600 rounded-lg flex items-center justify-center">
                        <Icon className="w-6 h-6 text-white" />
                      </div>
                      {status && getStatusIcon(status)}
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full border font-semibold ${getPriorityColor(module.priority)}`}>
                      ESSENTIAL
                    </span>
                  </div>
                  <h3 className="text-white font-bold text-lg mb-2">{module.name}</h3>
                  <p className="text-slate-300 text-sm mb-4 leading-relaxed">{module.description}</p>
                  <div className="flex flex-col space-y-2">
                    <button
                      onClick={() => handleModuleAction(module.id, 'start')}
                      className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
                    >
                      Configure Now
                    </button>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => handleModuleAction(module.id, 'skip')}
                        className="flex-1 px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-300 rounded-lg text-sm transition-colors"
                      >
                        Later
                      </button>
                      <button
                        onClick={() => handleModuleAction(module.id, 'ignore')}
                        className="flex-1 px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-400 rounded-lg text-sm transition-colors"
                      >
                        Disable
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recommended Modules */}
        <div className="mb-8">
          <div className="flex items-center mb-4">
            <div className="flex-1 h-px bg-blue-500/30"></div>
            <h2 className="px-4 text-lg font-bold text-blue-400">RECOMMENDED MODULES</h2>
            <div className="flex-1 h-px bg-blue-500/30"></div>
          </div>
          <p className="text-center text-slate-400 text-sm mb-6">
            Popular modules that enhance operations - configure what fits your workflow
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {groupedModules.recommended.map(module => {
              const Icon = module.icon;
              const status = moduleStatuses[module.id];
              return (
                <div
                  key={module.id}
                  className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20 hover:border-blue-500/50 transition-all"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center space-x-3">
                      <div className="w-12 h-12 bg-blue-600 rounded-lg flex items-center justify-center">
                        <Icon className="w-6 h-6 text-white" />
                      </div>
                      {status && getStatusIcon(status)}
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full border font-semibold ${getPriorityColor(module.priority)}`}>
                      RECOMMENDED
                    </span>
                  </div>
                  <h3 className="text-white font-bold text-lg mb-2">{module.name}</h3>
                  <p className="text-slate-300 text-sm mb-4 leading-relaxed">{module.description}</p>
                  <div className="flex flex-col space-y-2">
                    <button
                      onClick={() => handleModuleAction(module.id, 'start')}
                      className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
                    >
                      Start Working
                    </button>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => handleModuleAction(module.id, 'skip')}
                        className="flex-1 px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-300 rounded-lg text-sm transition-colors"
                      >
                        Skip For Now
                      </button>
                      <button
                        onClick={() => handleModuleAction(module.id, 'ignore')}
                        className="flex-1 px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-400 rounded-lg text-sm transition-colors"
                      >
                        Ignore
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Optional Modules */}
        <div className="mb-8">
          <div className="flex items-center mb-4">
            <div className="flex-1 h-px bg-slate-500/30"></div>
            <h2 className="px-4 text-lg font-bold text-slate-400">OPTIONAL MODULES</h2>
            <div className="flex-1 h-px bg-slate-500/30"></div>
          </div>
          <p className="text-center text-slate-400 text-sm mb-6">
            Advanced features you can enable when needed - completely optional
          </p>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {groupedModules.optional.map(module => {
              const Icon = module.icon;
              const status = moduleStatuses[module.id];
              return (
                <div
                  key={module.id}
                  className="bg-white/5 backdrop-blur-sm rounded-lg p-5 border border-white/10 hover:border-slate-400/50 transition-all"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center space-x-2">
                      <div className="w-10 h-10 bg-slate-700 rounded-lg flex items-center justify-center">
                        <Icon className="w-5 h-5 text-slate-300" />
                      </div>
                      {status && getStatusIcon(status)}
                    </div>
                  </div>
                  <h3 className="text-white font-bold text-base mb-2">{module.name}</h3>
                  <p className="text-slate-400 text-xs mb-4 leading-relaxed">{module.description}</p>
                  <div className="flex flex-col space-y-2">
                    <button
                      onClick={() => handleModuleAction(module.id, 'start')}
                      className="w-full px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      Enable
                    </button>
                    <button
                      onClick={() => handleModuleAction(module.id, 'ignore')}
                      className="w-full px-3 py-2 bg-white/5 hover:bg-white/10 text-slate-400 rounded-lg text-xs transition-colors"
                    >
                      Skip
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Progress Indicator */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20">
          <div className="flex items-center justify-between text-sm text-slate-400 mb-2">
            <span>Setup Progress</span>
            <span>Step 8 of 9</span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-2">
            <div
              className="bg-gradient-to-r from-red-600 to-orange-600 h-2 rounded-full transition-all duration-500"
              style={{ width: '89%' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModuleOverview;
