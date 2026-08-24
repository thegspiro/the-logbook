/**
 * Governance Module — Barrel Export
 */

export { getGovernanceRoutes, LEGAL_DOCUMENTS_PERMISSIONS } from './routes';
export { legalDocumentsService, orgChartService } from './services/api';
export { useLegalDocumentsStore } from './store/legalDocumentsStore';
export { useOrgChartStore } from './store/orgChartStore';
export type { LegalDocumentState, LegalDocumentsOverview, LegalRevision } from './types/legal';
export type { OrgChart, OrgChartMemberOption, OrgChartNode } from './types/orgChart';
