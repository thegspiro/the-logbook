/**
 * Communications Module — Barrel Export
 *
 * Central entry point for the communications feature module.
 */

// Routes
export { getCommunicationsRoutes } from './routes';

// Store
export { useEmailTemplatesStore } from './store/emailTemplatesStore';

// Components
export { TemplateList, TemplateEditor, TemplatePreview } from './components';

// Types
export type {
  EmailTemplate,
  EmailAttachment,
  EmailTemplateUpdate,
  EmailTemplatePreview,
  TemplateVariable,
} from './types';
