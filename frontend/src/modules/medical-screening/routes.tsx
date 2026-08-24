/**
 * Medical Screening Module Routes
 */

import { Route } from 'react-router';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { MedicalScreeningPage } from './pages/MedicalScreeningPage';

export function getMedicalScreeningRoutes() {
  return (
    <>
      <Route
        path="/medical-screening"
        element={
          <ProtectedRoute requiredPermission="medical_screening.view">
            <MedicalScreeningPage />
          </ProtectedRoute>
        }
      />
    </>
  );
}
