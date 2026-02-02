import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Eye, Edit3, Shield, Users, CheckCircle, Info } from 'lucide-react';
import toast from 'react-hot-toast';

/**
 * Module Configuration Template with Two-Tier Permissions
 *
 * View Access: Who can see/use the module (typically all members)
 * Manage Access: Who can create/edit/delete content (specific roles)
 */
const ModuleConfigTemplate: React.FC = () => {
  const navigate = useNavigate();
  const { moduleId } = useParams<{ moduleId: string }>();
  const [saving, setSaving] = useState(false);

  // Module metadata with permission descriptions
  const moduleConfig: Record<string, {
    name: string;
    viewDescription: string;
    manageDescription: string;
    defaultManageRoles: string[];
    permissions: { view: string[]; manage: string[] };
  }> = {
    members: {
      name: 'Member Management',
      viewDescription: 'View member directory, contact information, and profiles',
      manageDescription: 'Add/edit members, assign roles, update member status',
      defaultManageRoles: ['admin', 'officers'],
      permissions: {
        view: ['View member directory', 'See contact information', 'View member profiles'],
        manage: ['Add new members', 'Edit member information', 'Assign roles', 'Manage member status'],
      },
    },
    events: {
      name: 'Events & RSVP',
      viewDescription: 'View upcoming events, RSVP, and check attendance',
      manageDescription: 'Create events, manage RSVPs, record attendance',
      defaultManageRoles: ['admin', 'officers', 'secretary'],
      permissions: {
        view: ['View all events', 'RSVP to events', 'See who\'s attending', 'Check in to events'],
        manage: ['Create new events', 'Edit/cancel events', 'Manage RSVPs', 'Override attendance'],
      },
    },
    documents: {
      name: 'Documents & Files',
      viewDescription: 'Browse and download department documents and files',
      manageDescription: 'Upload documents, manage folders, set visibility',
      defaultManageRoles: ['admin', 'officers'],
      permissions: {
        view: ['Browse documents', 'Download files', 'View document history'],
        manage: ['Upload documents', 'Create folders', 'Edit/delete files', 'Set document visibility'],
      },
    },
    training: {
      name: 'Training & Certifications',
      viewDescription: 'View training records, upcoming courses, and certifications',
      manageDescription: 'Create courses, record completions, manage requirements',
      defaultManageRoles: ['admin', 'training_officer'],
      permissions: {
        view: ['View personal training records', 'See available courses', 'Track certification status'],
        manage: ['Create training courses', 'Record completions', 'Set requirements', 'Approve certifications'],
      },
    },
    inventory: {
      name: 'Equipment & Inventory',
      viewDescription: 'View equipment, check availability, request items',
      manageDescription: 'Add equipment, track maintenance, manage assignments',
      defaultManageRoles: ['admin', 'quartermaster', 'officers'],
      permissions: {
        view: ['View equipment list', 'Check item status', 'Request equipment'],
        manage: ['Add/edit equipment', 'Assign items', 'Record maintenance', 'Manage inventory levels'],
      },
    },
    scheduling: {
      name: 'Scheduling & Shifts',
      viewDescription: 'View shift schedules, request swaps, see coverage',
      manageDescription: 'Create schedules, approve swaps, manage coverage',
      defaultManageRoles: ['admin', 'officers', 'scheduling_officer'],
      permissions: {
        view: ['View shift schedules', 'See personal assignments', 'Request shift swaps'],
        manage: ['Create schedules', 'Assign shifts', 'Approve swap requests', 'Override assignments'],
      },
    },
    elections: {
      name: 'Elections & Voting',
      viewDescription: 'View elections, cast votes, see results when published',
      manageDescription: 'Create elections, manage candidates, certify results',
      defaultManageRoles: ['admin', 'secretary', 'president'],
      permissions: {
        view: ['View active elections', 'Cast votes (if eligible)', 'See published results'],
        manage: ['Create elections', 'Manage candidates', 'Configure voting rules', 'Certify results'],
      },
    },
    minutes: {
      name: 'Meeting Minutes',
      viewDescription: 'Read meeting minutes and organizational history',
      manageDescription: 'Record minutes, publish drafts, manage archives',
      defaultManageRoles: ['admin', 'secretary'],
      permissions: {
        view: ['Read published minutes', 'Search meeting history', 'View action items'],
        manage: ['Record minutes', 'Edit drafts', 'Publish minutes', 'Manage archives'],
      },
    },
    reports: {
      name: 'Reports & Analytics',
      viewDescription: 'View dashboards and personal reports',
      manageDescription: 'Create custom reports, export data, configure analytics',
      defaultManageRoles: ['admin', 'officers'],
      permissions: {
        view: ['View dashboards', 'See personal statistics', 'Access standard reports'],
        manage: ['Create custom reports', 'Export data', 'Configure analytics', 'Share reports'],
      },
    },
    notifications: {
      name: 'Email Notifications',
      viewDescription: 'Receive notifications and manage personal preferences',
      manageDescription: 'Configure notification templates and triggers',
      defaultManageRoles: ['admin'],
      permissions: {
        view: ['Receive notifications', 'Set personal preferences', 'View notification history'],
        manage: ['Configure templates', 'Set notification triggers', 'Manage global settings'],
      },
    },
    mobile: {
      name: 'Mobile App Access',
      viewDescription: 'Access the platform from mobile devices',
      manageDescription: 'Configure mobile-specific features and settings',
      defaultManageRoles: ['admin'],
      permissions: {
        view: ['Use mobile app', 'Receive push notifications', 'Access mobile features'],
        manage: ['Configure mobile settings', 'Manage push notifications', 'Set mobile policies'],
      },
    },
    forms: {
      name: 'Custom Forms',
      viewDescription: 'Fill out and submit forms',
      manageDescription: 'Create forms, view submissions, export data',
      defaultManageRoles: ['admin', 'officers'],
      permissions: {
        view: ['View available forms', 'Submit forms', 'See personal submissions'],
        manage: ['Create form templates', 'View all submissions', 'Export responses', 'Manage form settings'],
      },
    },
    integrations: {
      name: 'External Integrations',
      viewDescription: 'Use integrated features (calendar sync, etc.)',
      manageDescription: 'Configure and manage external service connections',
      defaultManageRoles: ['admin'],
      permissions: {
        view: ['Use integrated features', 'Connect personal accounts'],
        manage: ['Configure integrations', 'Manage API connections', 'Set sync settings'],
      },
    },
  };

  const config = moduleId ? moduleConfig[moduleId] : null;
  const moduleName = config?.name || 'Module';

  // Available roles for selection
  const availableRoles = [
    { id: 'admin', name: 'Administrators', description: 'Full system access' },
    { id: 'officers', name: 'Officers', description: 'Department leadership' },
    { id: 'secretary', name: 'Secretary', description: 'Records and communications' },
    { id: 'treasurer', name: 'Treasurer', description: 'Financial oversight' },
    { id: 'training_officer', name: 'Training Officer', description: 'Training management' },
    { id: 'safety_officer', name: 'Safety Officer', description: 'Safety compliance' },
    { id: 'quartermaster', name: 'Quartermaster', description: 'Equipment management' },
    { id: 'scheduling_officer', name: 'Scheduling Officer', description: 'Shift management' },
    { id: 'president', name: 'President/Chief', description: 'Organization leader' },
  ];

  // State for selected manage roles
  const [manageRoles, setManageRoles] = useState<string[]>(
    config?.defaultManageRoles || ['admin', 'officers']
  );

  const toggleRole = (roleId: string) => {
    if (roleId === 'admin') return; // Admin always has manage access
    setManageRoles(prev =>
      prev.includes(roleId)
        ? prev.filter(r => r !== roleId)
        : [...prev, roleId]
    );
  };

  const handleSave = async () => {
    setSaving(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    toast.success(`${moduleName} permissions configured!`);
    setSaving(false);
    navigate('/onboarding/modules');
  };

  const handleSkip = () => {
    navigate('/onboarding/modules');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900 p-4 py-8">
      <div className="max-w-4xl w-full mx-auto">
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
            Set up who can view and who can manage this module
          </p>
        </div>

        {/* Two-Tier Permission Model Explanation */}
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-6">
          <div className="flex items-start">
            <Info className="w-5 h-5 text-blue-400 mt-0.5 mr-3 flex-shrink-0" />
            <div>
              <p className="text-blue-400 font-semibold mb-1">How Permissions Work</p>
              <p className="text-slate-300 text-sm">
                <strong>View Access</strong> allows members to see and use basic features.{' '}
                <strong>Manage Access</strong> allows creating, editing, and administrative actions.
                All members can view by default; you choose who can manage.
              </p>
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-6">
          {/* View Access Card */}
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-green-500/30">
            <div className="flex items-center mb-4">
              <div className="w-12 h-12 bg-green-600 rounded-lg flex items-center justify-center mr-4">
                <Eye className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-white font-bold text-lg">View Access</h2>
                <p className="text-green-400 text-sm">All Members</p>
              </div>
            </div>
            <p className="text-slate-300 text-sm mb-4">{config?.viewDescription}</p>
            <div className="bg-slate-900/50 rounded-lg p-4">
              <p className="text-slate-400 text-xs font-semibold mb-2 uppercase">What members can do:</p>
              <ul className="space-y-2">
                {config?.permissions.view.map((perm, idx) => (
                  <li key={idx} className="flex items-center text-slate-300 text-sm">
                    <CheckCircle className="w-4 h-4 text-green-400 mr-2 flex-shrink-0" />
                    {perm}
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-4 flex items-center text-slate-400 text-xs">
              <Users className="w-4 h-4 mr-2" />
              Applies to all active members automatically
            </div>
          </div>

          {/* Manage Access Card */}
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-orange-500/30">
            <div className="flex items-center mb-4">
              <div className="w-12 h-12 bg-orange-600 rounded-lg flex items-center justify-center mr-4">
                <Edit3 className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-white font-bold text-lg">Manage Access</h2>
                <p className="text-orange-400 text-sm">Selected Roles Only</p>
              </div>
            </div>
            <p className="text-slate-300 text-sm mb-4">{config?.manageDescription}</p>
            <div className="bg-slate-900/50 rounded-lg p-4">
              <p className="text-slate-400 text-xs font-semibold mb-2 uppercase">What managers can do:</p>
              <ul className="space-y-2">
                {config?.permissions.manage.map((perm, idx) => (
                  <li key={idx} className="flex items-center text-slate-300 text-sm">
                    <Shield className="w-4 h-4 text-orange-400 mr-2 flex-shrink-0" />
                    {perm}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Role Selection */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20 mb-6">
          <h3 className="text-white font-bold text-lg mb-2">Who Can Manage {moduleName}?</h3>
          <p className="text-slate-400 text-sm mb-4">
            Select which roles should have management permissions. Administrators always have full access.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {availableRoles.map(role => {
              const isSelected = manageRoles.includes(role.id);
              const isAdmin = role.id === 'admin';

              return (
                <button
                  key={role.id}
                  onClick={() => toggleRole(role.id)}
                  disabled={isAdmin}
                  className={`p-4 rounded-lg border-2 text-left transition-all ${
                    isSelected
                      ? 'border-orange-500 bg-orange-500/10'
                      : 'border-slate-600 bg-slate-800/50 hover:border-slate-500'
                  } ${isAdmin ? 'cursor-not-allowed opacity-75' : 'cursor-pointer'}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className={`font-semibold ${isSelected ? 'text-orange-400' : 'text-white'}`}>
                      {role.name}
                    </span>
                    {isSelected && (
                      <CheckCircle className="w-5 h-5 text-orange-400" />
                    )}
                  </div>
                  <p className="text-slate-400 text-xs">{role.description}</p>
                  {isAdmin && (
                    <p className="text-orange-400 text-xs mt-1 italic">Always has access</p>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-4 p-3 bg-slate-800/50 rounded-lg">
            <p className="text-slate-400 text-sm">
              <strong className="text-white">Selected roles:</strong>{' '}
              {manageRoles.map(r => availableRoles.find(ar => ar.id === r)?.name).join(', ')}
            </p>
          </div>
        </div>

        {/* Quick Tips */}
        <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700 mb-6">
          <h3 className="text-white font-semibold mb-2">Quick Tips</h3>
          <ul className="text-slate-300 text-sm space-y-2">
            <li className="flex items-start">
              <span className="text-green-400 mr-2">•</span>
              <span>You can change these permissions anytime in Settings → Permissions</span>
            </li>
            <li className="flex items-start">
              <span className="text-green-400 mr-2">•</span>
              <span>Individual users can be granted additional permissions beyond their role</span>
            </li>
            <li className="flex items-start">
              <span className="text-green-400 mr-2">•</span>
              <span>Some modules have sub-permissions you can configure in detail later</span>
            </li>
          </ul>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-6 py-3 bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white rounded-lg font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Save Permissions'}
          </button>
          <button
            onClick={handleSkip}
            className="sm:w-auto px-6 py-3 bg-transparent border border-slate-500 hover:border-slate-400 text-slate-300 hover:text-white rounded-lg font-semibold transition-all"
          >
            Use Defaults
          </button>
        </div>
      </div>
    </div>
  );
};

export default ModuleConfigTemplate;
