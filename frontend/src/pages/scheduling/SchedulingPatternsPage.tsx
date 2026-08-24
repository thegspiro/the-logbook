/**
 * Scheduling Patterns Page
 *
 * Standalone admin page for managing shift patterns.
 * Wraps the existing PatternsTab component with page chrome and back navigation.
 */

import React, { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { lazyWithRetry } from '../../utils/lazyWithRetry';
import SchedulingHeader from './SchedulingHeader';

const PatternsTab = lazyWithRetry(() => import('./PatternsTab'));

const SchedulingPatternsPage: React.FC = () => {
  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <SchedulingHeader backTo="/scheduling" description="Patterns · Create recurring shifts in bulk" />
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
              <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
            </div>
          }
        >
          <PatternsTab />
        </Suspense>
      </div>
    </div>
  );
};

export default SchedulingPatternsPage;
