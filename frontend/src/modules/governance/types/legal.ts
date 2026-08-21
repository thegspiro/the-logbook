/**
 * Governance — Legal Document Types
 *
 * Mirrors app/schemas/legal.py. Response fields are camelCase because the
 * backend serializes with `alias_generator=to_camel`.
 */

export const LegalDocumentType = {
  PRIVACY_POLICY: 'privacy_policy',
  TERMS_OF_SERVICE: 'terms_of_service',
} as const;
export type LegalDocumentType = (typeof LegalDocumentType)[keyof typeof LegalDocumentType];

export const LegalRevisionStatus = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
} as const;
export type LegalRevisionStatus = (typeof LegalRevisionStatus)[keyof typeof LegalRevisionStatus];

export interface LegalRevision {
  id: string;
  documentType: LegalDocumentType;
  status: LegalRevisionStatus;
  body: string;
  changeNote: string;
  effectiveDate?: string | null;
  createdBy?: string | null;
  createdByName?: string | null;
  publishedBy?: string | null;
  publishedByName?: string | null;
  publishedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface LegalDocumentState {
  documentType: LegalDocumentType;
  publicPath: string;
  /** No custom text is published, so the page renders the built-in default. */
  usingPlatformDefault: boolean;
  publishedBody?: string | null;
  publishedEffectiveDate?: string | null;
  publishedAt?: string | null;
  publishedByName?: string | null;
  drafts: LegalRevision[];
  history: LegalRevision[];
}

export interface LegalDocumentsOverview {
  organizationName?: string | null;
  canPublish: boolean;
  documents: LegalDocumentState[];
}

export interface LegalRevisionCreate {
  documentType: LegalDocumentType;
  body: string;
  changeNote: string;
  effectiveDate?: string | undefined;
}

export interface LegalRevisionUpdate {
  body?: string | undefined;
  changeNote?: string | undefined;
  /**
   * `null` clears the date. Update payloads are read with `exclude_unset` on
   * the backend, so omitting the key means "leave it alone" — a cleared field
   * has to travel as an explicit null or the old value survives the save.
   */
  effectiveDate?: string | null | undefined;
}

export const LEGAL_DOCUMENT_LABEL: Record<LegalDocumentType, string> = {
  privacy_policy: 'Privacy Policy',
  terms_of_service: 'Terms of Service',
};
