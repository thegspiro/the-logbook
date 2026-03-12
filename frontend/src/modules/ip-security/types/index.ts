/**
 * IP Security Module Types
 */

export interface IPException {
  id: string;
  ipAddress: string;
  exceptionType: string;
  reason: string;
  description?: string | null;
  userId: string;
  organizationId: string;
  requestedDurationDays: number;
  validFrom?: string | null;
  validUntil: string;
  approvalStatus: string;
  requestedBy: string;
  requestedAt?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  approvalNotes?: string | null;
  approvedDurationDays?: number | null;
  rejectedBy?: string | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
  revokedBy?: string | null;
  revokedAt?: string | null;
  revokeReason?: string | null;
  countryCode?: string | null;
  countryName?: string | null;
  useCase?: string | null;
  lastUsedAt?: string | null;
  useCount?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface IPExceptionListResponse {
  items: IPException[];
  total: number;
}

export interface IPExceptionRequestCreate {
  ipAddress: string;
  reason: string;
  requestedDurationDays: number;
  useCase: string;
  description?: string | undefined;
}

export interface IPExceptionApprove {
  approvedDurationDays?: number | undefined;
  approvalNotes?: string | undefined;
}

export interface IPExceptionReject {
  rejectionReason: string;
}

export interface IPExceptionRevoke {
  revokeReason: string;
}

export interface BlockedAccessAttempt {
  id: string;
  ipAddress: string;
  countryCode?: string | null;
  countryName?: string | null;
  userId?: string | null;
  blockReason: string;
  blockDetails?: string | null;
  requestPath?: string | null;
  requestMethod?: string | null;
  userAgent?: string | null;
  blockedAt?: string | null;
}

export interface BlockedAttemptsListResponse {
  items: BlockedAccessAttempt[];
  total: number;
}

export interface CountryBlockRule {
  id: string;
  countryCode: string;
  countryName?: string | null;
  isBlocked: boolean;
  reason: string;
  riskLevel?: string | null;
  createdBy: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  blockedAttemptsCount?: number | null;
  lastBlockedAt?: string | null;
}

export interface CountryBlockRuleCreate {
  countryCode: string;
  countryName?: string | undefined;
  reason: string;
  riskLevel: string;
}

export interface IPExceptionAuditLog {
  id: string;
  exceptionId: string;
  action: string;
  performedBy: string;
  performedAt?: string | null;
  details?: string | null;
  ipAddress?: string | null;
}
