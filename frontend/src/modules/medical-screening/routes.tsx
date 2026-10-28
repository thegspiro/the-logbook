/**
 * Medical Screening Module Routes
 */

import { Route } from 'react-router';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const MedicalScreeningPage = lazyWithRetry(() =>
  import('./pages/MedicalScreeningPage').then((m) => ({ default: m.MedicalScreeningPage }))
);

export function getMedicalScreeningRoutes() {
  return (
    <>
      <Route
        path="/medical-screening"
        element={
          <ProtectedRoute
            requiredPermission="medical_screening.view"
            requiredModule="medical_screening"
            moduleLabel="Medical Screening"
          >
            <MedicalScreeningPage />
          </ProtectedRoute>
        }
      />
    </>
  );
}
