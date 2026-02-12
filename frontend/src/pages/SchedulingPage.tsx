import React from 'react';
import { Clock, CalendarDays, ArrowLeftRight, Users } from 'lucide-react';

const SchedulingPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900">
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-3">
            <div className="bg-violet-600 rounded-lg p-2">
              <Clock className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-white text-2xl font-bold">Scheduling & Shifts</h1>
              <p className="text-slate-400 text-sm">
                Create shift schedules, manage duty rosters, and handle shift trades
              </p>
            </div>
          </div>
        </div>

        {/* Feature Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20">
            <CalendarDays className="w-8 h-8 text-violet-400 mb-4" />
            <h3 className="text-white font-semibold text-lg mb-2">Shift Scheduling</h3>
            <p className="text-slate-300 text-sm">
              Create and manage shift schedules with drag-and-drop calendar interface.
            </p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20">
            <ArrowLeftRight className="w-8 h-8 text-blue-400 mb-4" />
            <h3 className="text-white font-semibold text-lg mb-2">Shift Trades</h3>
            <p className="text-slate-300 text-sm">
              Allow members to request and approve shift swaps with built-in approval workflow.
            </p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20">
            <Users className="w-8 h-8 text-green-400 mb-4" />
            <h3 className="text-white font-semibold text-lg mb-2">Coverage Management</h3>
            <p className="text-slate-300 text-sm">
              Ensure adequate coverage with minimum staffing requirements and availability tracking.
            </p>
          </div>
        </div>

        {/* Empty State */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-12 border border-white/20 text-center">
          <Clock className="w-16 h-16 text-slate-500 mx-auto mb-4" />
          <h3 className="text-white text-xl font-bold mb-2">No Schedules Created</h3>
          <p className="text-slate-300 mb-6">
            Start building shift schedules and duty rosters for your department.
          </p>
          <button
            className="px-6 py-3 bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors"
            disabled
          >
            Create Schedule (Coming Soon)
          </button>
        </div>
      </main>
    </div>
  );
};

export default SchedulingPage;
