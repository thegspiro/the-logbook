import type {
  EventModuleSettings,
  EventType,
  EmailTemplate,
} from '../../types/event';

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

/** Props for the Outreach section. */
export interface OutreachSectionProps extends SettingsSectionProps {
  onAddType: () => void;
  onRemoveType: (value: string) => void;
  newTypeLabel: string;
  onNewTypeLabelChange: (value: string) => void;
}

export interface OrgMember {
  id: string;
  first_name: string;
  last_name: string;
  rank?: string;
}

/** Props for the Pipeline section. */
export interface PipelineSectionProps extends SettingsSectionProps {
  members: OrgMember[];
  onUpdateLeadTime: (days: number) => void;
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

/** Props for the Public Form section. */
export interface FormSectionProps {
  generatingForm: boolean;
  onGenerateForm: () => void;
  onNavigateToForms: () => void;
  eventRequestForms: EventRequestFormSummary[];
  loadingForms: boolean;
}
