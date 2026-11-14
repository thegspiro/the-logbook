import type { EventModuleSettings, EventType, EmailTemplate } from '../../types/event';

/** Props shared by all settings section components. */
export interface SettingsSectionProps {
  settings: EventModuleSettings;
  saving: boolean;
}

/** Props for the Visibility section. */
export interface VisibilitySectionProps extends SettingsSectionProps {
  onToggleVisibility: (eventType: EventType) => void;
  onToggleCategoryVisibility: (categoryValue: string) => void;
}

/** Props for the Categories section. */
export interface CategoriesSectionProps extends SettingsSectionProps {
  onAddCategory: () => void;
  onRemoveCategory: (value: string) => void;
  newCategoryLabel: string;
  onNewCategoryLabelChange: (value: string) => void;
  newCategoryColor: string;
  onNewCategoryColorChange: (value: string) => void;
}

/** Props for the request Types & roles page. */
export interface OutreachSectionProps extends SettingsSectionProps {
  onAddType: () => void;
  onRemoveType: (value: string) => void;
  newTypeLabel: string;
  onNewTypeLabelChange: (value: string) => void;
  onAddRole: () => void;
  onRemoveRole: (value: string) => void;
  newRoleLabel: string;
  onNewRoleLabelChange: (value: string) => void;
}

export interface OrgMember {
  id: string;
  first_name: string;
  last_name: string;
  preferred_name?: string | null | undefined;
  display_name?: string | undefined;
  rank?: string;
}

/** Props for the request Handling page (the stored `request_pipeline`). */
export interface PipelineSectionProps extends SettingsSectionProps {
  members: OrgMember[];
  onUpdateDefaultAssignee: (userId: string | null) => void;
  onTogglePublicVisibility: () => void;
  onAddTask: () => void;
  onRemoveTask: (taskId: string) => void;
  onReorderTask: (index: number, direction: 'up' | 'down') => void;
  newTaskLabel: string;
  onNewTaskLabelChange: (value: string) => void;
  newTaskDesc: string;
  onNewTaskDescChange: (value: string) => void;
}

/** Bounds of `EmailTemplateCreate.trigger_days_before` in the backend schema. */
export const MIN_TEMPLATE_DAYS_BEFORE = 1;
export const MAX_TEMPLATE_DAYS_BEFORE = 90;

/** Props for the Email section. */
export interface EmailSectionProps extends SettingsSectionProps {
  emailTemplates: EmailTemplate[];
  showTemplateForm: boolean;
  onToggleTemplateForm: (show: boolean) => void;
  onToggleEmailTrigger: (triggerKey: string) => void;
  onCreateTemplate: () => void;
  onDeleteTemplate: (templateId: string) => void;
  newTemplateName: string;
  onNewTemplateNameChange: (value: string) => void;
  newTemplateSubject: string;
  onNewTemplateSubjectChange: (value: string) => void;
  newTemplateBody: string;
  onNewTemplateBodyChange: (value: string) => void;
  newTemplateTrigger: string;
  onNewTemplateTriggerChange: (value: string) => void;
  /** Raw text of the "days before" field; read only while the trigger is days_before_event. */
  newTemplateDaysBefore: string;
  onNewTemplateDaysBeforeChange: (value: string) => void;
}

/** Minimal form info shown in the events settings panel. */
export interface EventRequestFormSummary {
  id: string;
  name: string;
  status: string;
  is_public: boolean;
  public_slug?: string;
  submission_count?: number;
  published_at?: string;
}

/** Props for the Request form page. */
export interface FormSectionProps {
  generatingForm: boolean;
  onGenerateForm: () => void;
  onNavigateToForms: () => void;
  eventRequestForms: EventRequestFormSummary[];
  loadingForms: boolean;
}

/** The pages of the Public Requests settings section, in the order the flow runs. */
export type PublicRequestsPage = 'overview' | 'form' | 'types' | 'handling' | 'emails';

/** Props for the Public Requests overview page. */
export interface PublicRequestsOverviewProps extends SettingsSectionProps {
  members: OrgMember[];
  emailTemplates: EmailTemplate[];
  eventRequestForms: EventRequestFormSummary[];
  loadingForms: boolean;
  onToggleAcceptPublicRequests: () => void;
  onUpdateLeadTime: (days: number) => void;
  onGoToPage: (page: PublicRequestsPage) => void;
  onOpenRequests: () => void;
}
