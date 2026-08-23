/**
 * Governance Module — Barrel Export
 */

export { getGovernanceRoutes, LEGAL_DOCUMENTS_PERMISSIONS } from './routes';
export { legalDocumentsService } from './services/api';
export { useLegalDocumentsStore } from './store/legalDocumentsStore';
export type { LegalDocumentState, LegalDocumentsOverview, LegalRevision } from './types/legal';
