/**
 * Scheduling Patterns Page
 *
 * Standalone admin page for managing shift patterns.
 * Wraps the existing PatternsTab component with page chrome and back navigation.
 */

import React, { Suspense } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, Repeat, Loader2 } from 'lucide-react';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const PatternsTab = lazyWithRetry(() => import('./PatternsTab'));

const SchedulingPatternsPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="bg-theme-bg min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="mb-6 flex items-center gap-3">
          <button
            onClick={() => void navigate('/scheduling')}
            className="hover:bg-theme-surface-hover text-theme-text-muted rounded-lg p-1.5"
            aria-label="Back to Scheduling"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="flex items-start gap-2">
            <Repeat className="mt-0.5 h-5 w-5 shrink-0 text-violet-500" />
            <div>
              <h1 className="text-theme-text-primary text-xl font-bold">Shift Patterns</h1>
              <p className="text-theme-text-muted text-sm">Create recurring patterns and generate shifts in bulk.</p>
            </div>
          </div>
        </div>
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
