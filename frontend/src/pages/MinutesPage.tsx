import React, { useState } from 'react';
import {
  ClipboardList,
  FileSearch,
  CheckSquare,
  Archive,
  Plus,
  Search,
  Filter,
  X,
  AlertCircle,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';

type MeetingType = 'business' | 'special' | 'committee' | 'board' | 'other';

const MEETING_TYPES: { value: MeetingType; label: string; color: string }[] = [
  { value: 'business', label: 'Business Meeting', color: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30' },
  { value: 'special', label: 'Special Meeting', color: 'bg-purple-500/10 text-purple-400 border-purple-500/30' },
  { value: 'committee', label: 'Committee Meeting', color: 'bg-blue-500/10 text-blue-400 border-blue-500/30' },
  { value: 'board', label: 'Board Meeting', color: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
  { value: 'other', label: 'Other', color: 'bg-slate-500/10 text-slate-400 border-slate-500/30' },
];

const MinutesPage: React.FC = () => {
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('minutes.manage');

  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const [minutesForm, setMinutesForm] = useState({
    title: '',
    meetingType: 'business' as MeetingType,
    meetingDate: '',
    meetingTime: '',
    location: '',
    calledBy: '',
    notes: '',
  });

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
          {canManage && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center space-x-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Record Minutes</span>
            </button>
          )}
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20">
            <p className="text-slate-400 text-xs font-medium uppercase">Total Minutes</p>
            <p className="text-white text-2xl font-bold mt-1">0</p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20">
            <p className="text-slate-400 text-xs font-medium uppercase">This Month</p>
            <p className="text-cyan-400 text-2xl font-bold mt-1">0</p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20">
            <p className="text-slate-400 text-xs font-medium uppercase">Open Action Items</p>
            <p className="text-yellow-400 text-2xl font-bold mt-1">0</p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20">
            <p className="text-slate-400 text-xs font-medium uppercase">Pending Approval</p>
            <p className="text-orange-400 text-2xl font-bold mt-1">0</p>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20 mb-6">
          <div className="flex flex-col md:flex-row items-center gap-4">
            <div className="relative flex-1 w-full md:max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type="text"
                placeholder="Search minutes by title, content, or action item..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Filter className="w-5 h-5 text-slate-400" />
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="px-4 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
              >
                <option value="all">All Meeting Types</option>
                {MEETING_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Feature Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20">
            <ClipboardList className="w-8 h-8 text-cyan-400 mb-4" />
            <h3 className="text-white font-semibold text-lg mb-2">Record Minutes</h3>
            <p className="text-slate-300 text-sm mb-3">
              Structured templates for recording meeting minutes with attendees, motions, and votes.
            </p>
            <div className="flex flex-wrap gap-1.5">
              <span className="px-2 py-0.5 text-xs bg-cyan-500/10 text-cyan-400 rounded">Roll Call</span>
              <span className="px-2 py-0.5 text-xs bg-cyan-500/10 text-cyan-400 rounded">Motions</span>
              <span className="px-2 py-0.5 text-xs bg-cyan-500/10 text-cyan-400 rounded">Votes</span>
            </div>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20">
            <CheckSquare className="w-8 h-8 text-green-400 mb-4" />
            <h3 className="text-white font-semibold text-lg mb-2">Action Items</h3>
            <p className="text-slate-300 text-sm mb-3">
              Track action items from meetings with assignees, due dates, and completion status.
            </p>
            <div className="flex flex-wrap gap-1.5">
              <span className="px-2 py-0.5 text-xs bg-green-500/10 text-green-400 rounded">Assignees</span>
              <span className="px-2 py-0.5 text-xs bg-green-500/10 text-green-400 rounded">Due Dates</span>
              <span className="px-2 py-0.5 text-xs bg-green-500/10 text-green-400 rounded">Follow-up</span>
            </div>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20">
            <Archive className="w-8 h-8 text-amber-400 mb-4" />
            <h3 className="text-white font-semibold text-lg mb-2">Archives & Search</h3>
            <p className="text-slate-300 text-sm mb-3">
              Full-text search across all meeting minutes for compliance and quick reference.
            </p>
            <div className="flex flex-wrap gap-1.5">
              <span className="px-2 py-0.5 text-xs bg-amber-500/10 text-amber-400 rounded">Full-text Search</span>
              <span className="px-2 py-0.5 text-xs bg-amber-500/10 text-amber-400 rounded">PDF Export</span>
            </div>
          </div>
        </div>

        {/* Empty State */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-12 border border-white/20 text-center">
          <FileSearch className="w-16 h-16 text-slate-500 mx-auto mb-4" />
          <h3 className="text-white text-xl font-bold mb-2">No Meeting Minutes</h3>
          <p className="text-slate-300 mb-6">
            Start recording meeting minutes to maintain your organization's history.
          </p>
          {canManage && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-6 py-3 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg transition-colors inline-flex items-center space-x-2"
            >
              <Plus className="w-5 h-5" />
              <span>Record First Minutes</span>
            </button>
          )}
        </div>

        {/* Create Minutes Modal */}
        {showCreateModal && (
          <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="flex items-center justify-center min-h-screen px-4">
              <div className="fixed inset-0 bg-black/60" onClick={() => setShowCreateModal(false)} />
              <div className="relative bg-slate-800 rounded-lg shadow-xl max-w-2xl w-full border border-white/20">
                <div className="px-6 pt-5 pb-4">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-medium text-white">Record Meeting Minutes</h3>
                    <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-white">
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">Meeting Title *</label>
                      <input
                        type="text" value={minutesForm.title}
                        onChange={(e) => setMinutesForm({ ...minutesForm, title: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                        placeholder="e.g., Regular Business Meeting - February 2026"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-1">Meeting Type</label>
                        <select
                          value={minutesForm.meetingType}
                          onChange={(e) => setMinutesForm({ ...minutesForm, meetingType: e.target.value as MeetingType })}
                          className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                        >
                          {MEETING_TYPES.map(t => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-1">Called By</label>
                        <input
                          type="text" value={minutesForm.calledBy}
                          onChange={(e) => setMinutesForm({ ...minutesForm, calledBy: e.target.value })}
                          className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                          placeholder="e.g., Chief Johnson"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-1">Date</label>
                        <input
                          type="date" value={minutesForm.meetingDate}
                          onChange={(e) => setMinutesForm({ ...minutesForm, meetingDate: e.target.value })}
                          className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-1">Time</label>
                        <input
                          type="time" value={minutesForm.meetingTime}
                          onChange={(e) => setMinutesForm({ ...minutesForm, meetingTime: e.target.value })}
                          className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">Location</label>
                      <input
                        type="text" value={minutesForm.location}
                        onChange={(e) => setMinutesForm({ ...minutesForm, location: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                        placeholder="e.g., Station 1 Meeting Room"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">Initial Notes</label>
                      <textarea
                        rows={4} value={minutesForm.notes}
                        onChange={(e) => setMinutesForm({ ...minutesForm, notes: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                        placeholder="Meeting opened at... Roll call taken... Old business..."
                      />
                    </div>

                    <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-3">
                      <div className="flex items-start space-x-2">
                        <AlertCircle className="w-4 h-4 text-cyan-400 mt-0.5 flex-shrink-0" />
                        <p className="text-cyan-300 text-sm">
                          The meeting minutes backend is being developed. Full minutes recording with attendees, motions, and action items will be available soon.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="bg-slate-900/50 px-6 py-3 flex justify-end space-x-3 rounded-b-lg">
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2 border border-slate-600 rounded-lg text-slate-300 hover:bg-slate-700 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    disabled
                    className="px-4 py-2 bg-cyan-600/50 text-white/50 rounded-lg cursor-not-allowed"
                  >
                    Start Recording
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default MinutesPage;
