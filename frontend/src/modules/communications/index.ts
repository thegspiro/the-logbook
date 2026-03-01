/**
 * Communications Module — Barrel Export
 *
 * Central entry point for the communications feature module.
 */

// Routes
export { getCommunicationsRoutes } from './routes';

// Store
export { useEmailTemplatesStore } from './store/emailTemplatesStore';
export { useScheduledEmailsStore } from './store/scheduledEmailsStore';

// Components
export {
  TemplateList,
  TemplateEditor,
  TemplatePreview,
  ScheduleEmailForm,
  ScheduledEmailList,
} from './components';

// Types
export type {
  EmailTemplate,
  EmailAttachment,
  EmailTemplateUpdate,
  EmailTemplatePreview,
  TemplateVariable,
  ScheduledEmail,
  ScheduledEmailCreate,
  ScheduledEmailUpdate,
} from './types';
