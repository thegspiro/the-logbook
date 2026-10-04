/**
 * Documents Module Routes
 *
 * Documents is an essential module: it is always on and carries no module
 * gate. Who sees which folder is decided per folder on the server
 * (`DocumentsService._folder_admits_user`), not by this route.
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router';
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
