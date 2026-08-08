/**
 * Charges Page
 *
 * Wrapper page for the ChargeManagementPanel component.
 * Provides page-level layout and header.
 */

import React, { Suspense } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, DollarSign, Loader2 } from 'lucide-react';

const ChargeManagementPanel = React.lazy(() => import('../../../components/ChargeManagementPanel'));

const ChargesPage: React.FC = () => (
  <div className="min-h-screen">
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <Link
        to="/inventory/admin"
        className="text-theme-text-muted hover:text-theme-text-secondary mb-6 flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Admin
      </Link>

      <div className="mb-6 flex items-center gap-3">
        <div className="rounded-lg bg-amber-600 p-2">
          <DollarSign className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-theme-text-primary text-xl font-bold">Charge Management</h1>
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
