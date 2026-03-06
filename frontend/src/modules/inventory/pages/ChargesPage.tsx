/**
 * Charges Page
 *
 * Wrapper page for the ChargeManagementPanel component.
 * Provides page-level layout and header.
 */

import React, { Suspense } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, DollarSign, Loader2 } from 'lucide-react';

const ChargeManagementPanel = React.lazy(() => import('../../../components/ChargeManagementPanel'));

const ChargesPage: React.FC = () => (
  <div className="min-h-screen">
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <Link
        to="/inventory/admin"
        className="text-sm text-theme-text-muted hover:text-theme-text-secondary flex items-center gap-1 mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Admin
      </Link>

      <div className="flex items-center gap-3 mb-6">
        <div className="bg-amber-600 rounded-lg p-2">
          <DollarSign className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-theme-text-primary">Charge Management</h1>
          <p className="text-sm text-theme-text-muted">Cost recovery for lost or damaged items</p>
        </div>
      </div>

      <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-theme-text-muted" /></div>}>
        <ChargeManagementPanel />
      </Suspense>
    </div>
  </div>
);

export default ChargesPage;
