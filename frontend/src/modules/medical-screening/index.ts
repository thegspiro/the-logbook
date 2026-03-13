/**
 * Medical Screening Module
 *
 * Manages medical screening requirements, records, and compliance
 * for both active members and prospective members.
 */

export { getMedicalScreeningRoutes } from './routes';
export { MedicalScreeningPage } from './pages/MedicalScreeningPage';
export { medicalScreeningService } from './services/api';
export { useMedicalScreeningStore } from './store/medicalScreeningStore';
export type {
  ScreeningRequirement,
  ScreeningRecord,
  ComplianceSummary,
  ExpiringScreening,
} from './types';
