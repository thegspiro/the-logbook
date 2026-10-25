/**
 * Return Requests Page
 *
 * Wrapper page for the ReturnRequestsPanel component.
 */

import React, { Suspense } from 'react';
import { CornerDownLeft, Loader2 } from 'lucide-react';

const ReturnRequestsPanel = React.lazy(() => import('../../../components/ReturnRequestsPanel'));

const ReturnRequestsPage: React.FC = () => (
  <div className="min-h-screen">
    <div className="max-w-5xl py-6 sm:py-8">
      <div className="mb-6 flex items-center gap-3">
        <div className="rounded-lg bg-indigo-600 p-2">
          <CornerDownLeft className="h-5 w-5 text-white" />
        </div>
        <div>
          <h2 className="text-theme-text-primary text-xl font-bold">Return Requests</h2>
          <p className="text-theme-text-muted text-sm">Review and process member return requests</p>
        </div>
      </div>

      <Suspense
        fallback={
          <div className="flex justify-center py-12" role="status" aria-live="polite">
            <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
          </div>
        }
      >
        <ReturnRequestsPanel />
      </Suspense>
    </div>
  </div>
);

export default ReturnRequestsPage;
