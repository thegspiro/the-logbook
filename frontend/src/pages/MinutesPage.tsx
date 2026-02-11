import React from 'react';
import { ClipboardList, FileSearch, CheckSquare, Archive } from 'lucide-react';

const MinutesPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900">
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-3">
            <div className="bg-cyan-600 rounded-lg p-2">
              <ClipboardList className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-white text-2xl font-bold">Meeting Minutes</h1>
              <p className="text-slate-400 text-sm">
                Record meeting minutes, track action items, and maintain organizational history
              </p>
            </div>
          </div>
        </div>

        {/* Feature Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20">
            <ClipboardList className="w-8 h-8 text-cyan-400 mb-4" />
            <h3 className="text-white font-semibold text-lg mb-2">Record Minutes</h3>
            <p className="text-slate-300 text-sm">
              Structured templates for recording meeting minutes with attendees and motions.
            </p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20">
            <CheckSquare className="w-8 h-8 text-green-400 mb-4" />
            <h3 className="text-white font-semibold text-lg mb-2">Action Items</h3>
            <p className="text-slate-300 text-sm">
              Track action items from meetings with assignees, due dates, and status updates.
            </p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20">
            <Archive className="w-8 h-8 text-amber-400 mb-4" />
            <h3 className="text-white font-semibold text-lg mb-2">Archives</h3>
            <p className="text-slate-300 text-sm">
              Searchable archive of all past meeting minutes for compliance and reference.
            </p>
          </div>
        </div>

        {/* Empty State */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-12 border border-white/20 text-center">
          <FileSearch className="w-16 h-16 text-slate-500 mx-auto mb-4" />
          <h3 className="text-white text-xl font-bold mb-2">No Meeting Minutes</h3>
          <p className="text-slate-300 mb-6">
            Start recording meeting minutes to maintain your organization's history.
          </p>
          <button
            className="px-6 py-3 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg transition-colors"
            disabled
          >
            Record Minutes (Coming Soon)
          </button>
        </div>
      </main>
    </div>
  );
};

export default MinutesPage;
