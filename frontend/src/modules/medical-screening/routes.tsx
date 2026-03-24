/**
 * Medical Screening Module Routes
 */

import { Route } from 'react-router-dom';
import { MedicalScreeningPage } from './pages/MedicalScreeningPage';

export function getMedicalScreeningRoutes() {
  return (
    <>
      <Route path="/medical-screening" element={<MedicalScreeningPage />} />
    </>
  );
}
