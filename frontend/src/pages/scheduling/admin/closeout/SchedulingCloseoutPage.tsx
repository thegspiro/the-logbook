/**
 * Shift Close-Out
 *
 * A shift nobody closed out leaves no trace on the board, which draws the
 * future — so the only sign of one was the hub's "To close out" number, which
 * says how many there are and not which. Finding them meant paging back through
 * the calendar a day at a time.
 *
 * One screen: the shifts waiting, oldest first, with the department's own
 * close-out opened on the row, and the settings that govern what close-out asks
 * for shown beneath it.
 *
 * Department-wide. The shift officer's route to closing their own shift is
 * unchanged and does not pass through here: `ShiftDetailPanel` grants the named
 * officer authority over their shift's crew, attendance, calls and close-out
 * without a department-wide grant, mirroring the backend. This page is the
 * officer-of-the-department view, so it stands on `scheduling.manage` like
 * every other page in Scheduling Administration.
 */

import React from 'react';
import SchedulingHeader from '../../SchedulingHeader';
import CloseoutQueueSection from './CloseoutQueueSection';
import CloseoutSettingsSummary from './CloseoutSettingsSummary';

const SchedulingCloseoutPage: React.FC = () => (
  <div className="min-h-screen">
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <SchedulingHeader
        backTo="/scheduling/admin"
        backLabel="Back to scheduling administration"
        description="Close-out · Shifts that have ended and were never closed"
      />

      <div className="space-y-6">
        <CloseoutQueueSection />
        <CloseoutSettingsSummary />
      </div>
    </div>
  </div>
);

export default SchedulingCloseoutPage;
