/**
 * Action Items Module Routes
 *
 * Unified cross-module action items page.
 *
 * To disable the action items module, simply remove or comment out
 * the call to getActionItemsRoutes() in App.tsx.
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router-dom';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const ActionItemsPage = lazyWithRetry(() => import('../../pages/ActionItemsPage'));

export const getActionItemsRoutes = () => {
  return (
    <React.Fragment>
      <Route
        path="/action-items"
        element={
          <Suspense fallback={null}>
            <ActionItemsPage />
          </Suspense>
        }
      />
    </React.Fragment>
  );
};
