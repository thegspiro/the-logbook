/**
 * Medical Screening Module Routes
 */

import { Route } from 'react-router';
import { MedicalScreeningPage } from './pages/MedicalScreeningPage';

export function getMedicalScreeningRoutes() {
  return (
    <>
      <Route path="/medical-screening" element={<MedicalScreeningPage />} />
    </>
  );
}
