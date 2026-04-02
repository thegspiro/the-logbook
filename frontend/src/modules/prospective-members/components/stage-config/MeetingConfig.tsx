import React from 'react';
import type {
  MeetingStageConfig,
  MeetingType,
  StageConfig,
} from '../../types';
import type { EventListItem } from '@/types/event';

interface MeetingConfigProps {
  config: StageConfig;
  setConfig: React.Dispatch<React.SetStateAction<StageConfig>>;
  customCategories: string[];
  getNextEventForType: (eventType: string, category?: string) => EventListItem | undefined;
  renderEventPreview: (eventType: string | undefined, category?: string) => React.ReactNode;
}

const MEETING_TYPE_OPTIONS: { value: MeetingType; label: string; description: string }[] = [
  {
    value: 'chief_meeting',
    label: 'Meeting with Chief',
    description: 'One-on-one or small group meeting with the chief.',
  },
  {
    value: 'president_meeting',
    label: 'Meeting with President',
    description: 'One-on-one meeting with the department president.',
  },
  { value: 'informational', label: 'Informational Meeting', description: 'General info session about the department.' },
  { value: 'business_meeting', label: 'Business Meeting', description: 'Attend a regular business meeting.' },
  { value: 'other', label: 'Other', description: 'Custom meeting type.' },
];

const EVENT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'business_meeting', label: 'Business Meeting' },
  { value: 'training', label: 'Training' },
  { value: 'public_education', label: 'Public Education' },
  { value: 'social', label: 'Social' },
  { value: 'fundraiser', label: 'Fundraiser' },
  { value: 'ceremony', label: 'Ceremony' },
  { value: 'other', label: 'Other' },
];

const MeetingConfig: React.FC<MeetingConfigProps> = ({
  config,
  setConfig,
  customCategories,
  getNextEventForType,
  renderEventPreview,
}) => {
  const meetingConfig = config as MeetingStageConfig;

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="stage-meeting-type" className="text-theme-text-muted mb-2 block text-sm">
          Meeting Type
        </label>
        <select
          id="stage-meeting-type"
          value={meetingConfig.meeting_type}
          onChange={(e) => setConfig({ ...meetingConfig, meeting_type: e.target.value as MeetingType })}
          className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring w-full rounded-lg border px-4 py-2.5 focus:ring-2 focus:outline-hidden"
        >
          {MEETING_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <p className="text-theme-text-muted mt-1 text-xs">
          {MEETING_TYPE_OPTIONS.find((o) => o.value === meetingConfig.meeting_type)?.description}
        </p>
      </div>
      <div>
        <label htmlFor="stage-meeting-event-type" className="text-theme-text-muted mb-2 block text-sm">
          Auto-Link Event Type
        </label>
        <select
          id="stage-meeting-event-type"
          value={meetingConfig.linked_event_type ?? ''}
          onChange={(e) => {
            const eventType = e.target.value || undefined;
            const nextEvent = eventType ? getNextEventForType(eventType, meetingConfig.linked_event_category) : undefined;
            setConfig({
              ...meetingConfig,
              linked_event_type: eventType,
              linked_event_category: eventType ? meetingConfig.linked_event_category : undefined,
              linked_event_id: nextEvent?.id,
            });
          }}
          className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring w-full rounded-lg border px-4 py-2.5 focus:ring-2 focus:outline-hidden"
        >
          <option value="">None — enter details manually</option>
          {EVENT_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              Next {opt.label}
            </option>
          ))}
        </select>
        <p className="text-theme-text-muted mt-1 text-xs">
          When this stage activates, the next upcoming event of this type will be auto-linked.
        </p>
      </div>
      {meetingConfig.linked_event_type && customCategories.length > 0 && (
        <div>
          <label htmlFor="stage-meeting-event-category" className="text-theme-text-muted mb-2 block text-sm">
            Event Category (optional)
          </label>
          <select
            id="stage-meeting-event-category"
            value={meetingConfig.linked_event_category ?? ''}
            onChange={(e) => {
              const category = e.target.value || undefined;
              const nextEvent = getNextEventForType(meetingConfig.linked_event_type ?? '', category);
              setConfig({
                ...meetingConfig,
                linked_event_category: category,
                linked_event_id: nextEvent?.id,
              });
            }}
            className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring w-full rounded-lg border px-4 py-2.5 focus:ring-2 focus:outline-hidden"
          >
            <option value="">Any category</option>
            {customCategories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
          <p className="text-theme-text-muted mt-1 text-xs">
            Narrow auto-linking to events with this specific category (e.g., &quot;Information Session&quot;).
          </p>
        </div>
      )}
      {meetingConfig.linked_event_type && (
        <div>
          {renderEventPreview(meetingConfig.linked_event_type, meetingConfig.linked_event_category)}
        </div>
      )}
      <div>
        <label htmlFor="stage-meeting-description" className="text-theme-text-muted mb-2 block text-sm">
          Meeting Details (optional)
        </label>
        <textarea
          id="stage-meeting-description"
          value={meetingConfig.meeting_description ?? ''}
          onChange={(e) => setConfig({ ...meetingConfig, meeting_description: e.target.value })}
          placeholder="e.g., Meet with Chief Smith to discuss expectations and department culture..."
          rows={2}
          className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring w-full resize-none rounded-lg border px-4 py-2.5 focus:ring-2 focus:outline-hidden"
        />
      </div>
      <label className="text-theme-text-secondary flex items-center gap-2 text-sm mt-4">
        <input
          type="checkbox"
          checked={meetingConfig.auto_advance ?? false}
          onChange={(e) => setConfig({ ...meetingConfig, auto_advance: e.target.checked })}
          className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
        />
        Auto-advance when attendance is recorded
      </label>
      <p className="text-theme-text-muted text-xs ml-6">
        Automatically complete this step and advance the prospect when their attendance is recorded at the linked event.
      </p>
    </div>
  );
};

export default MeetingConfig;
