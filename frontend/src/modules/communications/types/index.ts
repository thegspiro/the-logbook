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
  TemplateVariable,
  ScheduledEmail,
  ScheduledEmailCreate,
  ScheduledEmailUpdate,
} from '../../../services/api';
