/**
 * Charges Page
 *
 * Wrapper page for the ChargeManagementPanel component.
 * Provides page-level layout and header.
 */

import React, { Suspense } from 'react';
import { DollarSign, Loader2 } from 'lucide-react';

const ChargeManagementPanel = React.lazy(() => import('../../../components/ChargeManagementPanel'));

const ChargesPage: React.FC = () => (
  <div className="min-h-screen">
    <div className="max-w-5xl py-6 sm:py-8">
      <div className="mb-6 flex items-center gap-3">
        <div className="rounded-lg bg-amber-600 p-2">
          <DollarSign className="h-5 w-5 text-white" />
        </div>
        <div>
          <h2 className="text-theme-text-primary text-xl font-bold">Charge Management</h2>
          <p className="text-theme-text-muted text-sm">Cost recovery for lost or damaged items</p>
        </div>
      </div>

      <Suspense
        fallback={
          <div className="flex justify-center py-12" role="status" aria-live="polite">
            <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
          </div>
        }
      >
        <ChargeManagementPanel />
      </Suspense>
    </div>
  </div>
);

export default ChargesPage;
