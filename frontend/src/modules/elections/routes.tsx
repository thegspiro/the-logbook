/**
 * Elections Module — Route Definitions
 *
 * Protected routes (require auth + AppLayout):
 *   /elections            — Elections list
 *   /elections/:electionId — Election detail
 *
 * Public routes (no auth):
 *   /ballot               — Ballot voting (token-based)
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router-dom';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const ElectionsPage = lazyWithRetry(() => import('../../pages/ElectionsPage'));
const ElectionDetailPage = lazyWithRetry(
  () => import('../../pages/ElectionDetailPage'),
);
const BallotVotingPage = lazyWithRetry(
  () => import('../../pages/BallotVotingPage'),
);

/** Protected election routes (rendered inside AppLayout). */
export const getElectionsRoutes = () => (
  <React.Fragment>
    <Route
      path="/elections"
      element={
        <Suspense fallback={null}>
          <ElectionsPage />
        </Suspense>
      }
    />
    <Route
      path="/elections/:electionId"
      element={
        <Suspense fallback={null}>
          <ElectionDetailPage />
        </Suspense>
      }
    />
  </React.Fragment>
);

/** Public ballot voting route (token-based, no auth required). */
export const getElectionsPublicRoutes = () => (
  <React.Fragment>
    <Route
      path="/ballot"
      element={
        <Suspense fallback={null}>
          <BallotVotingPage />
        </Suspense>
      }
    />
  </React.Fragment>
);
