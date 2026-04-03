import React, { useCallback, useRef, useMemo } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus, Trash2, GripVertical, Eye } from 'lucide-react';
import type {
  AutomatedEmailStageConfig,
  AutomatedEmailSection,
  StageConfig,
} from '../../types';
import { EMAIL_BUILTIN_SECTION_IDS, DEFAULT_EMAIL_SECTION_ORDER } from '../../types';
import type { EventListItem } from '@/types/event';

interface SortableEmailSectionProps {
  id: string;
  children: React.ReactNode;
}

const SortableEmailSection: React.FC<SortableEmailSectionProps> = ({ id, children }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className="group/section relative">
      <button
        type="button"
        className="text-theme-text-muted absolute top-4 -left-1 shrink-0 cursor-grab opacity-0 transition-opacity group-hover/section:opacity-100 active:cursor-grabbing touch-none"
        aria-label="Drag to reorder section"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="pl-5">
        {children}
      </div>
    </div>
  );
};

interface EmailPreviewProps {
  config: AutomatedEmailStageConfig;
  sectionOrder: string[];
}

const EmailPreview: React.FC<EmailPreviewProps> = ({ config, sectionOrder }) => {
  const enabledSections = sectionOrder.filter((sid) => {
    if (sid === EMAIL_BUILTIN_SECTION_IDS.WELCOME) return config.include_welcome;
    if (sid === EMAIL_BUILTIN_SECTION_IDS.FAQ_LINK) return config.include_faq_link;
    if (sid === EMAIL_BUILTIN_SECTION_IDS.NEXT_MEETING) return config.include_next_meeting;
    if (sid === EMAIL_BUILTIN_SECTION_IDS.STATUS_TRACKER) return config.include_status_tracker;
    const custom = (config.custom_sections ?? []).find((s) => s.id === sid);
    return custom?.enabled && (custom.title || custom.content);
  });

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white text-left text-sm shadow-sm" style={{ maxWidth: 480 }}>
      <div className="bg-red-600 px-5 py-4 text-center">
        <span className="text-lg font-bold text-white">Organization Name</span>
      </div>
      <div className="space-y-4 bg-gray-50 p-5 text-gray-700" style={{ lineHeight: 1.6 }}>
        <p className="m-0">Hi Prospect,</p>
        {enabledSections.length === 0 && (
          <p className="m-0 italic text-gray-400">Your membership application has been updated.</p>
        )}
        {enabledSections.map((sid) => {
          if (sid === EMAIL_BUILTIN_SECTION_IDS.WELCOME) {
            return (
              <p key={sid} className="m-0">
                {config.welcome_message || <span className="italic text-gray-400">Welcome message...</span>}
              </p>
            );
          }
          if (sid === EMAIL_BUILTIN_SECTION_IDS.FAQ_LINK) {
            return (
              <span
                key={sid}
                className="my-3 inline-block rounded-md bg-blue-600 px-5 py-2.5 text-sm text-white no-underline"
              >
                View Membership FAQ
              </span>
            );
          }
          if (sid === EMAIL_BUILTIN_SECTION_IDS.NEXT_MEETING) {
            return (
              <div key={sid} className="rounded-md border border-gray-200 bg-white p-4">
                <strong>Next Meeting</strong>
                <br />
                {config.next_meeting_event_type ? (
                  <span className="text-gray-500">Event details will be fetched automatically</span>
                ) : config.next_meeting_details ? (
                  <span>{config.next_meeting_details}</span>
                ) : (
                  <span className="italic text-gray-400">Meeting details...</span>
                )}
              </div>
            );
          }
          if (sid === EMAIL_BUILTIN_SECTION_IDS.STATUS_TRACKER) {
            return (
              <span
                key={sid}
                className="my-3 inline-block rounded-md bg-blue-600 px-5 py-2.5 text-sm text-white no-underline"
              >
                Track Your Application
              </span>
            );
          }
          const custom = (config.custom_sections ?? []).find((s) => s.id === sid);
          if (!custom) return null;
          return (
            <div key={sid} className="rounded-md border border-gray-200 bg-white p-4">
              {custom.title && (
                <>
                  <strong>{custom.title}</strong>
                  <br />
                </>
              )}
              {custom.content || <span className="italic text-gray-400">Section content...</span>}
            </div>
          );
        })}
      </div>
      <div className="px-5 py-3 text-center text-xs text-gray-400">
        This email was sent by Organization Name.
      </div>
    </div>
  );
};

interface AutomatedEmailConfigProps {
  config: StageConfig;
  setConfig: React.Dispatch<React.SetStateAction<StageConfig>>;
  errors: Record<string, string>;
  showEmailPreview: boolean;
  setShowEmailPreview: React.Dispatch<React.SetStateAction<boolean>>;
  getNextEventForType: (eventType: string, category?: string) => EventListItem | undefined;
  renderEventPreview: (eventType: string | undefined, category?: string) => React.ReactNode;
}

const EVENT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'business_meeting', label: 'Business Meeting' },
  { value: 'training', label: 'Training' },
  { value: 'public_education', label: 'Public Education' },
  { value: 'social', label: 'Social' },
  { value: 'fundraiser', label: 'Fundraiser' },
  { value: 'ceremony', label: 'Ceremony' },
  { value: 'other', label: 'Other' },
];

const AutomatedEmailConfig: React.FC<AutomatedEmailConfigProps> = ({
  config,
  setConfig,
  errors,
  showEmailPreview,
  setShowEmailPreview,
  getNextEventForType,
  renderEventPreview,
}) => {
  const emailConfig = config as AutomatedEmailStageConfig;
  const customSectionsEndRef = useRef<HTMLDivElement>(null);

  const generateSectionId = useCallback(
    () =>
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `cs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
    [],
  );

  const handleAddCustomSection = useCallback(() => {
    const newSection: AutomatedEmailSection = {
      id: generateSectionId(),
      title: '',
      content: '',
      enabled: true,
    };
    setConfig((prev) => {
      const email = prev as AutomatedEmailStageConfig;
      return {
        ...email,
        custom_sections: [...(email.custom_sections ?? []), newSection],
        section_order: [...(email.section_order ?? DEFAULT_EMAIL_SECTION_ORDER), newSection.id],
      };
    });
    requestAnimationFrame(() => {
      customSectionsEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }, [generateSectionId, setConfig]);

  const handleRemoveCustomSection = useCallback((removeIdx: number) => {
    setConfig((prev) => {
      const email = prev as AutomatedEmailStageConfig;
      const sections = email.custom_sections ?? [];
      const removedSection = sections[removeIdx];
      const removedId = removedSection?.id;
      return {
        ...email,
        custom_sections: sections.filter((_, i) => i !== removeIdx),
        section_order: removedId
          ? (email.section_order ?? DEFAULT_EMAIL_SECTION_ORDER).filter((id) => id !== removedId)
          : email.section_order,
      };
    });
  }, [setConfig]);

  const handleUpdateCustomSection = useCallback(
    (idx: number, field: keyof AutomatedEmailSection, value: string | boolean) => {
      setConfig((prev) => {
        const email = prev as AutomatedEmailStageConfig;
        const sections = [...(email.custom_sections ?? [])];
        const item = sections[idx];
        if (item) {
          sections[idx] = { ...item, [field]: value };
        }
        return { ...email, custom_sections: sections };
      });
    },
    [setConfig],
  );

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const sectionOrderStored = emailConfig.section_order;
  const customSectionIds = emailConfig.custom_sections;
  const effectiveSectionOrder = useMemo(() => {
    const stored = sectionOrderStored ?? [];
    const customIds = (customSectionIds ?? []).map((s) => s.id);
    const allIds = [...DEFAULT_EMAIL_SECTION_ORDER, ...customIds];
    const order = [...stored];
    const orderSet = new Set(stored);
    for (const id of allIds) {
      if (!orderSet.has(id)) {
        order.push(id);
        orderSet.add(id);
      }
    }
    const validIds = new Set(allIds);
    return order.filter((id) => validIds.has(id));
  }, [sectionOrderStored, customSectionIds]);

  const handleEmailSectionDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = effectiveSectionOrder.indexOf(String(active.id));
      const newIndex = effectiveSectionOrder.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1) return;
      const reordered = arrayMove(effectiveSectionOrder, oldIndex, newIndex);
      setConfig((prev) => ({
        ...(prev as AutomatedEmailStageConfig),
        section_order: reordered,
      }));
    },
    [effectiveSectionOrder, setConfig],
  );

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="stage-email-subject" className="text-theme-text-muted mb-2 block text-sm">
          Email Subject
        </label>
        <input
          id="stage-email-subject"
          type="text"
          value={emailConfig.email_subject}
          onChange={(e) => setConfig({ ...emailConfig, email_subject: e.target.value })}
          placeholder="e.g., Welcome to the Membership Process"
          className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring w-full rounded-lg border px-4 py-2.5 focus:ring-2 focus:outline-hidden"
        />
        {errors.email_subject && (
          <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.email_subject}</p>
        )}
      </div>

      <p className="text-theme-text-muted text-xs">
        Configure the sections to include in the email. Drag sections to reorder them. The prospect's name
        will be used as the greeting automatically.
      </p>

      <DndContext
        sensors={dndSensors}
        collisionDetection={closestCenter}
        onDragEnd={handleEmailSectionDragEnd}
      >
        <SortableContext items={effectiveSectionOrder} strategy={verticalListSortingStrategy}>
          {effectiveSectionOrder.map((sectionId) => {
            if (sectionId === EMAIL_BUILTIN_SECTION_IDS.WELCOME) {
              return (
                <SortableEmailSection key={sectionId} id={sectionId}>
                  <div className="border-theme-surface-border space-y-3 rounded-lg border p-4">
                    <label className="text-theme-text-secondary flex items-center gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={emailConfig.include_welcome}
                        onChange={(e) => setConfig({ ...emailConfig, include_welcome: e.target.checked })}
                        className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
                      />
                      Welcome Message
                    </label>
                    {emailConfig.include_welcome && (
                      <>
                        <textarea
                          value={emailConfig.welcome_message ?? ''}
                          onChange={(e) => setConfig({ ...emailConfig, welcome_message: e.target.value })}
                          placeholder="Thank you for your interest in joining our department! We look forward to getting to know you through this process."
                          rows={3}
                          aria-label="Welcome message content"
                          className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring w-full resize-none rounded-lg border px-4 py-2.5 text-sm focus:ring-2 focus:outline-hidden"
                        />
                        {errors.welcome_message && (
                          <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.welcome_message}</p>
                        )}
                      </>
                    )}
                  </div>
                </SortableEmailSection>
              );
            }

            if (sectionId === EMAIL_BUILTIN_SECTION_IDS.FAQ_LINK) {
              return (
                <SortableEmailSection key={sectionId} id={sectionId}>
                  <div className="border-theme-surface-border space-y-3 rounded-lg border p-4">
                    <label className="text-theme-text-secondary flex items-center gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={emailConfig.include_faq_link}
                        onChange={(e) => setConfig({ ...emailConfig, include_faq_link: e.target.checked })}
                        className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
                      />
                      Membership FAQ Link
                    </label>
                    {emailConfig.include_faq_link && (
                      <input
                        type="url"
                        value={emailConfig.faq_url ?? ''}
                        onChange={(e) => setConfig({ ...emailConfig, faq_url: e.target.value })}
                        placeholder="https://your-department.com/membership-faq"
                        aria-label="FAQ URL"
                        className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring w-full rounded-lg border px-4 py-2.5 text-sm focus:ring-2 focus:outline-hidden"
                      />
                    )}
                  </div>
                </SortableEmailSection>
              );
            }

            if (sectionId === EMAIL_BUILTIN_SECTION_IDS.NEXT_MEETING) {
              return (
                <SortableEmailSection key={sectionId} id={sectionId}>
                  <div className="border-theme-surface-border space-y-3 rounded-lg border p-4">
                    <label className="text-theme-text-secondary flex items-center gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={emailConfig.include_next_meeting}
                        onChange={(e) => setConfig({ ...emailConfig, include_next_meeting: e.target.checked })}
                        className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
                      />
                      Next Meeting Details
                    </label>
                    {emailConfig.include_next_meeting && (
                      <div className="space-y-3">
                        <div>
                          <label
                            htmlFor="email-meeting-event-type"
                            className="text-theme-text-muted mb-1.5 block text-xs"
                          >
                            Pull from upcoming event
                          </label>
                          <select
                            id="email-meeting-event-type"
                            value={emailConfig.next_meeting_event_type ?? ''}
                            onChange={(e) => {
                              const eventType = e.target.value || undefined;
                              const nextEvent = eventType ? getNextEventForType(eventType) : undefined;
                              setConfig({
                                ...emailConfig,
                                next_meeting_event_type: eventType,
                                next_meeting_event_id: nextEvent?.id,
                              });
                            }}
                            className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring w-full rounded-lg border px-4 py-2 text-sm focus:ring-2 focus:outline-hidden"
                          >
                            <option value="">None — enter details manually</option>
                            {EVENT_TYPE_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                Next {opt.label}
                              </option>
                            ))}
                          </select>
                          {renderEventPreview(emailConfig.next_meeting_event_type)}
                        </div>
                        <div>
                          <label htmlFor="email-meeting-details" className="text-theme-text-muted mb-1.5 block text-xs">
                            {emailConfig.next_meeting_event_type ? 'Additional details (optional)' : 'Meeting details'}
                          </label>
                          <textarea
                            id="email-meeting-details"
                            value={emailConfig.next_meeting_details ?? ''}
                            onChange={(e) => setConfig({ ...emailConfig, next_meeting_details: e.target.value })}
                            placeholder={
                              emailConfig.next_meeting_event_type
                                ? 'Any extra info to include alongside the event details...'
                                : 'Our next informational meeting is on the first Monday of the month at 7 PM at Station 1. All prospective members are encouraged to attend.'
                            }
                            rows={2}
                            aria-label="Next meeting details"
                            className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring w-full resize-none rounded-lg border px-4 py-2.5 text-sm focus:ring-2 focus:outline-hidden"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </SortableEmailSection>
              );
            }

            if (sectionId === EMAIL_BUILTIN_SECTION_IDS.STATUS_TRACKER) {
              return (
                <SortableEmailSection key={sectionId} id={sectionId}>
                  <div className="border-theme-surface-border space-y-2 rounded-lg border p-4">
                    <label className="text-theme-text-secondary flex items-center gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={emailConfig.include_status_tracker}
                        onChange={(e) => setConfig({ ...emailConfig, include_status_tracker: e.target.checked })}
                        className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
                      />
                      Application Tracker Link
                    </label>
                    <p className="text-theme-text-muted ml-6 text-xs">
                      Includes a link to the prospect's public status page so they can track their application progress.
                      Requires the public status page to be enabled.
                    </p>
                  </div>
                </SortableEmailSection>
              );
            }

            const customSections = emailConfig.custom_sections ?? [];
            const customIdx = customSections.findIndex((s) => s.id === sectionId);
            const section = customSections[customIdx];
            if (!section) return null;

            return (
              <SortableEmailSection key={sectionId} id={sectionId}>
                <div className="border-theme-surface-border space-y-3 rounded-lg border p-4">
                  <div className="flex items-center justify-between">
                    <label className="text-theme-text-secondary flex items-center gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={section.enabled}
                        onChange={(e) => handleUpdateCustomSection(customIdx, 'enabled', e.target.checked)}
                        className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
                      />
                      Custom Section
                    </label>
                    <button
                      type="button"
                      onClick={() => handleRemoveCustomSection(customIdx)}
                      className="text-theme-text-muted transition-colors hover:text-red-700 dark:hover:text-red-400"
                      aria-label={`Remove custom section ${customIdx + 1}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                  <input
                    type="text"
                    value={section.title}
                    onChange={(e) => handleUpdateCustomSection(customIdx, 'title', e.target.value)}
                    placeholder="Section title"
                    aria-label={`Custom section ${customIdx + 1} title`}
                    className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring w-full rounded-lg border px-4 py-2 text-sm focus:ring-2 focus:outline-hidden"
                  />
                  <textarea
                    value={section.content}
                    onChange={(e) => handleUpdateCustomSection(customIdx, 'content', e.target.value)}
                    placeholder="Section content..."
                    rows={2}
                    aria-label={`Custom section ${customIdx + 1} content`}
                    className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring w-full resize-none rounded-lg border px-4 py-2.5 text-sm focus:ring-2 focus:outline-hidden"
                  />
                </div>
              </SortableEmailSection>
            );
          })}
        </SortableContext>
      </DndContext>

      <div ref={customSectionsEndRef} />
      <button
        type="button"
        onClick={handleAddCustomSection}
        className="flex items-center gap-1 text-sm text-red-700 transition-colors hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
      >
        <Plus className="h-3 w-3" aria-hidden="true" /> Add custom section
      </button>

      <div className="border-theme-surface-border mt-2 border-t pt-4">
        <button
          type="button"
          onClick={() => setShowEmailPreview((v) => !v)}
          className="text-theme-text-secondary flex items-center gap-1.5 text-sm font-medium"
          aria-expanded={showEmailPreview}
        >
          <Eye className="h-4 w-4" aria-hidden="true" />
          {showEmailPreview ? 'Hide Preview' : 'Show Preview'}
        </button>
        {showEmailPreview && (
          <div className="mt-3 flex justify-center" data-testid="email-preview">
            <EmailPreview config={emailConfig} sectionOrder={effectiveSectionOrder} />
          </div>
        )}
      </div>
    </div>
  );
};

export default AutomatedEmailConfig;
