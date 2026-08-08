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
    void loadData();
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
      <div className="flex h-64 items-center justify-center" role="status" aria-live="polite">
        <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-red-700 dark:text-red-400">
          {error || 'No data available'}
        </div>
      </div>
    );
  }

  const totalAttendees = data.total_member_attendees + data.total_external_attendees;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h2 className="text-theme-text-primary flex items-center gap-2 text-lg font-semibold">
          <Globe className="h-5 w-5 text-blue-700 dark:text-blue-400" />
          Community Engagement
        </h2>
        <p className="text-theme-text-muted mt-1 text-sm">Public outreach metrics for community-facing events</p>
      </div>

      {/* Metric Cards */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card-secondary p-5">
          <div className="mb-2 flex items-center gap-3">
            <div className="rounded-lg bg-blue-500/20 p-2">
              <Calendar className="h-5 w-5 text-blue-700 dark:text-blue-400" />
            </div>
            <span className="text-theme-text-muted text-sm">Public Events</span>
          </div>
          <p className="text-theme-text-primary text-3xl font-bold">{data.total_public_events}</p>
          <p className="text-theme-text-muted mt-1 text-xs">Total events held</p>
        </div>

        <div className="card-secondary p-5">
          <div className="mb-2 flex items-center gap-3">
            <div className="rounded-lg bg-green-500/20 p-2">
              <Users className="h-5 w-5 text-green-700 dark:text-green-400" />
            </div>
            <span className="text-theme-text-muted text-sm">Member Attendees</span>
          </div>
          <p className="text-theme-text-primary text-3xl font-bold">{data.total_member_attendees}</p>
          <p className="text-theme-text-muted mt-1 text-xs">Members who checked in</p>
        </div>

        <div className="card-secondary p-5">
          <div className="mb-2 flex items-center gap-3">
            <div className="rounded-lg bg-purple-500/20 p-2">
              <Globe className="h-5 w-5 text-purple-700 dark:text-purple-400" />
            </div>
            <span className="text-theme-text-muted text-sm">External Attendees</span>
          </div>
          <p className="text-theme-text-primary text-3xl font-bold">{data.total_external_attendees}</p>
          <p className="text-theme-text-muted mt-1 text-xs">Community participants</p>
        </div>

        <div className="card-secondary p-5">
          <div className="mb-2 flex items-center gap-3">
            <div className="rounded-lg bg-cyan-500/20 p-2">
              <TrendingUp className="h-5 w-5 text-cyan-700 dark:text-cyan-400" />
            </div>
            <span className="text-theme-text-muted text-sm">Upcoming Public</span>
          </div>
          <p className="text-theme-text-primary text-3xl font-bold">{data.upcoming_public_events}</p>
          <p className="text-theme-text-muted mt-1 text-xs">Events scheduled</p>
        </div>
      </div>

      {/* Summary section */}
      <div className="card-secondary p-6">
        <h3 className="text-md text-theme-text-primary mb-4 font-medium">Engagement Summary</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-theme-text-muted text-sm">Total People Reached</span>
            <span className="text-theme-text-primary text-lg font-semibold">{totalAttendees}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-theme-text-muted text-sm">Avg. Attendees per Event</span>
            <span className="text-theme-text-primary text-lg font-semibold">
              {data.total_public_events > 0 ? Math.round(totalAttendees / data.total_public_events) : 0}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-theme-text-muted text-sm">External to Member Ratio</span>
            <span className="text-theme-text-primary text-lg font-semibold">
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
