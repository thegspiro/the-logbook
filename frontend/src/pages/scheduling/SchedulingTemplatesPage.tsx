/**
 * Scheduling Templates Page
 *
 * Standalone admin page for managing shift templates.
 * Wraps the existing ShiftTemplatesPage component with page chrome and back navigation.
 */

import React, { Suspense } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, ClipboardList, Loader2 } from 'lucide-react';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const ShiftTemplatesPage = lazyWithRetry(() => import('../ShiftTemplatesPage'));

const SchedulingTemplatesPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="bg-theme-bg min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="mb-6 flex items-center gap-3">
          <button
            onClick={() => void navigate('/scheduling')}
            className="hover:bg-theme-surface-hover text-theme-text-muted rounded-lg p-1.5"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-violet-500" />
            <h1 className="text-theme-text-primary text-xl font-bold">Shift Templates</h1>
          </div>
        </div>
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
              <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
            </div>
          }
        >
          <ShiftTemplatesPage />
        </Suspense>
      </div>
    </div>
  );
};

export default SchedulingTemplatesPage;
