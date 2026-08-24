/**
 * Scheduling Admin Reports Page
 *
 * Standalone admin page for scheduling reports (member hours, coverage, etc.).
 * Wraps the existing SchedulingReportsPage component with page chrome and back navigation.
 */

import React, { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { lazyWithRetry } from '../../utils/lazyWithRetry';
import SchedulingHeader from './SchedulingHeader';

const SchedulingReportsPage = lazyWithRetry(() => import('../SchedulingReportsPage'));

const SchedulingAdminReportsPage: React.FC = () => {
  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <SchedulingHeader backTo="/scheduling" description="Reports · Review staffing, coverage, and member hours" />
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
