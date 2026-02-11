import React from 'react';
import { Plug, Calendar, MessageSquare, Database } from 'lucide-react';

const IntegrationsPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900">
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-3">
            <div className="bg-indigo-600 rounded-lg p-2">
              <Plug className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-white text-2xl font-bold">External Integrations</h1>
              <p className="text-slate-400 text-sm">
                Connect with external tools like Google Calendar, Slack, and more
              </p>
            </div>
          </div>
        </div>

        {/* Feature Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20">
            <Calendar className="w-8 h-8 text-indigo-400 mb-4" />
            <h3 className="text-white font-semibold text-lg mb-2">Calendar Sync</h3>
            <p className="text-slate-300 text-sm">
              Sync events with Google Calendar, Outlook, and other calendar services.
            </p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20">
            <MessageSquare className="w-8 h-8 text-green-400 mb-4" />
            <h3 className="text-white font-semibold text-lg mb-2">Messaging</h3>
            <p className="text-slate-300 text-sm">
              Connect with Slack, Discord, or Teams for automated notifications.
            </p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20">
            <Database className="w-8 h-8 text-amber-400 mb-4" />
            <h3 className="text-white font-semibold text-lg mb-2">Data Import/Export</h3>
            <p className="text-slate-300 text-sm">
              Import data from external systems and export reports in multiple formats.
            </p>
          </div>
        </div>

        {/* Empty State */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-12 border border-white/20 text-center">
          <Plug className="w-16 h-16 text-slate-500 mx-auto mb-4" />
          <h3 className="text-white text-xl font-bold mb-2">No Integrations Configured</h3>
          <p className="text-slate-300 mb-6">
            Connect external services to extend your platform's capabilities.
          </p>
          <button
            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
            disabled
          >
            Add Integration (Coming Soon)
          </button>
        </div>
      </main>
    </div>
  );
};

export default IntegrationsPage;
