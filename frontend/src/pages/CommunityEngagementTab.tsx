/**
 * Community Engagement Tab (PO3)
 *
 * Shows public outreach metrics for event coordinators.
 * Lazy-loaded as a tab in EventsAdminHub.
 */

import React, { useState, useEffect } from 'react';
import { Loader2, Users, Globe, Calendar, TrendingUp } from 'lucide-react';
import { dashboardService } from '../services/api';
import type { CommunityEngagement } from '../services/api';

const CommunityEngagementTab: React.FC = () => {
  const [data, setData] = useState<CommunityEngagement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const result = await dashboardService.getCommunityEngagement();
      setData(result);
    } catch {
      setError('Failed to load community engagement data');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 text-slate-400 animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400">
          {error || 'No data available'}
        </div>
      </div>
    );
  }

  const totalAttendees = data.total_member_attendees + data.total_external_attendees;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Globe className="h-5 w-5 text-blue-400" />
          Community Engagement
        </h2>
        <p className="text-sm text-slate-400 mt-1">
          Public outreach metrics for community-facing events
        </p>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-white/5 border border-white/10 rounded-lg p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Calendar className="h-5 w-5 text-blue-400" />
            </div>
            <span className="text-sm text-slate-400">Public Events</span>
          </div>
          <p className="text-3xl font-bold text-white">{data.total_public_events}</p>
          <p className="text-xs text-slate-500 mt-1">Total events held</p>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-lg p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-green-500/20 rounded-lg">
              <Users className="h-5 w-5 text-green-400" />
            </div>
            <span className="text-sm text-slate-400">Member Attendees</span>
          </div>
          <p className="text-3xl font-bold text-white">{data.total_member_attendees}</p>
          <p className="text-xs text-slate-500 mt-1">Members who checked in</p>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-lg p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-purple-500/20 rounded-lg">
              <Globe className="h-5 w-5 text-purple-400" />
            </div>
            <span className="text-sm text-slate-400">External Attendees</span>
          </div>
          <p className="text-3xl font-bold text-white">{data.total_external_attendees}</p>
          <p className="text-xs text-slate-500 mt-1">Community participants</p>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-lg p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-cyan-500/20 rounded-lg">
              <TrendingUp className="h-5 w-5 text-cyan-400" />
            </div>
            <span className="text-sm text-slate-400">Upcoming Public</span>
          </div>
          <p className="text-3xl font-bold text-white">{data.upcoming_public_events}</p>
          <p className="text-xs text-slate-500 mt-1">Events scheduled</p>
        </div>
      </div>

      {/* Summary section */}
      <div className="bg-white/5 border border-white/10 rounded-lg p-6">
        <h3 className="text-md font-medium text-white mb-4">Engagement Summary</h3>
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm text-slate-400">Total People Reached</span>
            <span className="text-lg font-semibold text-white">{totalAttendees}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-slate-400">Avg. Attendees per Event</span>
            <span className="text-lg font-semibold text-white">
              {data.total_public_events > 0
                ? Math.round(totalAttendees / data.total_public_events)
                : 0}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-slate-400">External to Member Ratio</span>
            <span className="text-lg font-semibold text-white">
              {data.total_member_attendees > 0
                ? (data.total_external_attendees / data.total_member_attendees).toFixed(1)
                : '—'}
              :1
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CommunityEngagementTab;
