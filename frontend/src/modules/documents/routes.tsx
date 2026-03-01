/**
 * Documents Module Routes
 *
 * To disable the documents module, simply remove or comment out
 * the call to getDocumentsRoutes() in App.tsx.
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router-dom';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const DocumentsPage = lazyWithRetry(() => import('../../pages/DocumentsPage'));

export const getDocumentsRoutes = () => {
  return (
    <React.Fragment>
      <Route
        path="/documents"
        element={
          <Suspense fallback={null}>
            <DocumentsPage />
          </Suspense>
        }
      />
    </React.Fragment>
  );
};
