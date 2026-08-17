/**
 * The Equipment Checks tab body.
 *
 * Two audiences, one tab. Someone who can see other people's checks
 * (`equipment_check.view` — officers, the inventory manager) opens onto the
 * fleet board, because their question is about the trucks. Everyone else opens
 * onto their own checklists, because theirs is about their own work — and
 * because the fleet endpoint would 403 them.
 *
 * The officer's own checklists are one tap away rather than gone: the board's
 * "you have N checks waiting" strip swaps this body for the checklist view in
 * place, so doing your own check never means navigating away from the board.
 */

import React, { Suspense, useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { lazyWithRetry } from '../../utils/lazyWithRetry';
import MyChecklistsPage from './MyChecklistsPage';

const FleetBoardPage = lazyWithRetry(() => import('./FleetBoardPage'));

export const EquipmentChecksTab: React.FC = () => {
  const { checkPermission } = useAuthStore();
  const canViewFleet = checkPermission('equipment_check.view') || checkPermission('scheduling.manage');
  const [showingMine, setShowingMine] = useState(false);

  if (!canViewFleet) {
    return <MyChecklistsPage />;
  }

  if (showingMine) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setShowingMine(false)}
          className="text-theme-text-muted hover:text-theme-text-primary inline-flex items-center gap-1.5 text-sm font-medium transition-colors"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to the fleet board
        </button>
        <MyChecklistsPage />
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" aria-hidden="true" />
        </div>
      }
    >
      <FleetBoardPage onOpenMyChecks={() => setShowingMine(true)} />
    </Suspense>
  );
};

export default EquipmentChecksTab;
