/**
 * Governance Module — Barrel Export
 */

export { getGovernanceRoutes, LEGAL_DOCUMENTS_PERMISSIONS } from './routes';
export { legalDocumentsService, orgChartService } from './services/api';
export { useLegalDocumentsStore } from './store/legalDocumentsStore';
export { useOrgChartStore } from './store/orgChartStore';
export type { LegalDocumentState, LegalDocumentsOverview, LegalRevision } from './types/legal';
export { OrgChartHolderSource } from './types/orgChart';
export type {
  OrgChart,
  OrgChartHolder,
  OrgChartMemberOption,
  OrgChartNode,
  OrgChartPositionOption,
  OrgChartRankOption,
} from './types/orgChart';
