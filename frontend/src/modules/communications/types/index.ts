/**
 * Communications Module Types
 *
 * Re-exports email template types from the global service layer.
 */

export type {
  EmailTemplate,
  EmailAttachment,
  EmailTemplateUpdate,
  EmailTemplatePreview,
  TemplatePreviewOverrides,
  EmailFooter,
  EmailFooterLibrary,
  TemplateVariable,
  ScheduledEmail,
  ScheduledEmailCreate,
  ScheduledEmailUpdate,
  MessageHistoryRecord,
  MessageHistoryListResponse,
  SendTestEmailRequest,
  DepartmentOfficer,
  OfficerCandidate,
  OfficerDirectory,
  OfficerUpdate,
  OfficerVariable,
} from '../../../services/api';
