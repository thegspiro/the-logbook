/**
 * Scheduling Admin Reports Page
 *
 * Standalone admin page for scheduling reports (member hours, coverage, etc.).
 * Wraps the existing SchedulingReportsPage component; the page chrome is the
 * Scheduling Administration header the route draws it inside.
 */

import React, { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const SchedulingReportsPage = lazyWithRetry(() => import('../SchedulingReportsPage'));

const SchedulingAdminReportsPage: React.FC = () => {
  return (
    <div className="min-h-screen">
      <div className="py-6">
        <h2 className="sr-only">Scheduling Reports</h2>
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
              <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
            </div>
          }
        >
          <SchedulingReportsPage />
        </Suspense>
      </div>
    </div>
  );
};

export default SchedulingAdminReportsPage;
