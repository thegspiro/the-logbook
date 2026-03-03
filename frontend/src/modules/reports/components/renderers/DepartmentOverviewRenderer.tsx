/**
 * Department Overview Report Renderer
 */

import React from 'react';
import { Users, BookOpen, Calendar, ClipboardList } from 'lucide-react';
import type { DepartmentOverviewReport } from '../../types';
import { StatCard } from '../StatCard';

interface Props {
  data: DepartmentOverviewReport;
}

export const DepartmentOverviewRenderer: React.FC<Props> = ({ data }) => {
  const { members, training, events, action_items } = data;
  const totalOpen = action_items.open_from_meetings + action_items.open_from_minutes;

  return (
    <div className="space-y-6">
      {/* Members Section */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <Users className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
          <h4 className="text-theme-text-primary text-sm font-semibold">Membership</h4>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Total Members" value={members.total} />
          <StatCard label="Active" value={members.active} />
          <StatCard label="Inactive" value={members.inactive} />
        </div>
      </div>

      {/* Training Section */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <BookOpen className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
          <h4 className="text-theme-text-primary text-sm font-semibold">Training</h4>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatCard label="Records" value={training.total_records} />
          <StatCard label="Completed" value={training.completed} />
          <StatCard label="Completion Rate" value={`${training.completion_rate}%`} />
          <StatCard label="Total Hours" value={Math.round(training.total_hours)} />
          <StatCard label="Avg Hrs/Member" value={training.avg_hours_per_member} />
        </div>
      </div>

      {/* Events Section */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <Calendar className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
          <h4 className="text-theme-text-primary text-sm font-semibold">Events</h4>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Total Events" value={events.total_events} />
          <StatCard label="Total Check-ins" value={events.total_checkins} />
        </div>
      </div>

      {/* Action Items Section */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <ClipboardList className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
          <h4 className="text-theme-text-primary text-sm font-semibold">Open Action Items</h4>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Total Open" value={totalOpen} />
          <StatCard label="From Meetings" value={action_items.open_from_meetings} />
          <StatCard label="From Minutes" value={action_items.open_from_minutes} />
        </div>
      </div>
    </div>
  );
};

export function getDepartmentOverviewExportData(data: DepartmentOverviewReport) {
  const rows = [
    { metric: 'Total Members', value: data.members.total },
    { metric: 'Active Members', value: data.members.active },
    { metric: 'Inactive Members', value: data.members.inactive },
    { metric: 'Training Records', value: data.training.total_records },
    { metric: 'Training Completed', value: data.training.completed },
    { metric: 'Training Completion Rate', value: `${data.training.completion_rate}%` },
    { metric: 'Total Training Hours', value: data.training.total_hours },
    { metric: 'Avg Hours/Member', value: data.training.avg_hours_per_member },
    { metric: 'Total Events', value: data.events.total_events },
    { metric: 'Total Check-ins', value: data.events.total_checkins },
    { metric: 'Open Action Items (Meetings)', value: data.action_items.open_from_meetings },
    { metric: 'Open Action Items (Minutes)', value: data.action_items.open_from_minutes },
  ];
  const columns = [
    { key: 'metric', header: 'Metric' },
    { key: 'value', header: 'Value' },
  ];
  return { rows: rows as unknown as Array<Record<string, unknown>>, columns };
}
