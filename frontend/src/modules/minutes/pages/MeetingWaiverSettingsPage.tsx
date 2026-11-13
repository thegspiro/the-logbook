/**
 * Business-meeting waiver requests — the department's policy.
 *
 * The same settings panel the training workflow uses, bound to the meeting
 * API (`PUT /meetings/waiver-requests/policy`, meetings.manage). It sits
 * under the attendance dashboard because both are the Secretary's: the
 * dashboard shows what an approved request does to a member's attendance,
 * and this decides who may ask and who decides. The route needs
 * meetings.manage, the permission the API saves the policy under, rather than
 * minutes.manage, which the minutes settings page needs.
 */

import React from 'react';
import { Link } from 'react-router';
import { CalendarX } from 'lucide-react';
import { GovernancePageHeader } from '../../../components/governance/GovernancePageHeader';
import { SessionWaiverSettingsPanel } from '../../../pages/training/SessionWaiverSettingsPanel';
import { MEETING_WAIVER_WORKFLOW } from '../../../utils/attendanceWaiverWorkflows';

export const MeetingWaiverSettingsPage: React.FC = () => (
  <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
    <GovernancePageHeader
      icon={CalendarX}
      title="Meeting Waiver Requests"
      breadcrumbLabel="Waiver settings"
      parentCrumbs={[{ label: 'Attendance', path: '/minutes/attendance' }]}
      subtitle="Whether members may ask to be excused from a business meeting, and who decides"
      actions={
        <Link to={MEETING_WAIVER_WORKFLOW.queuePath} className="btn-secondary text-sm font-medium">
          Waiver requests
        </Link>
      }
    />
    <SessionWaiverSettingsPanel workflow={MEETING_WAIVER_WORKFLOW} />
  </div>
);

export default MeetingWaiverSettingsPage;
