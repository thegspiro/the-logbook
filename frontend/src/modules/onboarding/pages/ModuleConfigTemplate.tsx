import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';

/**
 * Generic Module Configuration Template
 *
 * This is a placeholder page that can be customized for each specific module.
 * In production, each module would have its own dedicated configuration page.
 */
const ModuleConfigTemplate: React.FC = () => {
  const navigate = useNavigate();
  const { moduleId } = useParams<{ moduleId: string }>();
  const [saving, setSaving] = useState(false);

  const moduleNames: Record<string, string> = {
    members: 'Member Management',
    events: 'Events & RSVP',
    documents: 'Documents & Files',
    training: 'Training & Certifications',
    inventory: 'Equipment & Inventory',
    scheduling: 'Scheduling & Shifts',
    elections: 'Elections & Voting',
    minutes: 'Meeting Minutes',
    reports: 'Reports & Analytics',
    notifications: 'Email Notifications',
    mobile: 'Mobile App Access',
    forms: 'Custom Forms',
    integrations: 'External Integrations',
  };

  const moduleName = moduleId ? moduleNames[moduleId] : 'Module';

  const handleSave = async () => {
    setSaving(true);

    // Simulate saving
    await new Promise(resolve => setTimeout(resolve, 1000));

    toast.success(`${moduleName} configured successfully!`);
    setSaving(false);

    // Return to module overview
    navigate('/onboarding/modules');
  };

  const handleSkip = () => {
    navigate('/onboarding/modules');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900 flex items-center justify-center p-4">
      <div className="max-w-3xl w-full">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={handleSkip}
            className="flex items-center text-slate-400 hover:text-white transition-colors mb-4"
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            Back to Modules
          </button>
          <h1 className="text-4xl font-bold text-white mb-2">
            Configure {moduleName}
          </h1>
          <p className="text-slate-300">
            Set up the basic configuration for this module. You can always change these settings later from your dashboard.
          </p>
        </div>

        {/* Configuration Card */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-8 border border-white/20 space-y-6">
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
            <div className="flex items-start">
              <CheckCircle className="w-5 h-5 text-blue-400 mt-0.5 mr-3 flex-shrink-0" />
              <div>
                <p className="text-blue-400 font-semibold mb-1">Quick Setup</p>
                <p className="text-slate-300 text-sm">
                  This is a simplified configuration page. In the production version, you'll have
                  detailed settings specific to {moduleName}. For now, you can enable this module
                  with default settings.
                </p>
              </div>
            </div>
          </div>

          {/* Placeholder Configuration Options */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-200 mb-2">
                Module Name
              </label>
              <input
                type="text"
                value={moduleName}
                disabled
                className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white cursor-not-allowed"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-200 mb-2">
                Status
              </label>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="enabled"
                  defaultChecked
                  className="w-4 h-4 rounded border-slate-600 bg-slate-900/50 text-red-600 focus:ring-red-500"
                />
                <label htmlFor="enabled" className="text-slate-300 text-sm">
                  Enable this module for all users
                </label>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-200 mb-2">
                Access Level
              </label>
              <select className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent">
                <option>All Members</option>
                <option>Officers Only</option>
                <option>Administrators Only</option>
                <option>Custom Roles</option>
              </select>
            </div>

            <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
              <h3 className="text-white font-semibold mb-2">What happens next?</h3>
              <ul className="text-slate-300 text-sm space-y-2 list-disc list-inside">
                <li>The module will be enabled with default settings</li>
                <li>You can access it from your dashboard sidebar</li>
                <li>Detailed configuration options are available in Settings</li>
                <li>You can disable the module anytime if not needed</li>
              </ul>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-white/10">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 px-6 py-3 bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white rounded-lg font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : 'Save & Enable Module'}
            </button>
            <button
              onClick={handleSkip}
              className="sm:w-auto px-6 py-3 bg-transparent border border-slate-500 hover:border-slate-400 text-slate-300 hover:text-white rounded-lg font-semibold transition-all"
            >
              Skip For Now
            </button>
          </div>
        </div>

        {/* Help Text */}
        <div className="mt-6 text-center">
          <p className="text-slate-400 text-sm">
            Need detailed configuration help?{' '}
            <a
              href={`/docs/modules/${moduleId}`}
              className="text-red-400 hover:text-red-300 underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              View {moduleName} Documentation
            </a>
          </p>
        </div>
      </div>
    </div>
  );
};

export default ModuleConfigTemplate;
