import React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { getEventTypeLabel, getEventTypeBadgeColor } from '../../utils/eventHelpers';
import { EventType as EventTypeEnum } from '../../constants/enums';
import type { EventType } from '../../types/event';
import type { VisibilitySectionProps } from './types';

const ALL_EVENT_TYPES: EventType[] = [
  EventTypeEnum.BUSINESS_MEETING,
  EventTypeEnum.PUBLIC_EDUCATION,
  EventTypeEnum.TRAINING,
  EventTypeEnum.SOCIAL,
  EventTypeEnum.FUNDRAISER,
  EventTypeEnum.CEREMONY,
  EventTypeEnum.OTHER,
];

const VisibilitySection: React.FC<VisibilitySectionProps> = ({
  settings,
  saving,
  onToggleVisibility,
  onToggleCategoryVisibility,
}) => {
  const visibleTypes = ALL_EVENT_TYPES.filter((t) => settings.visible_event_types.includes(t));
  const hiddenTypes = ALL_EVENT_TYPES.filter((t) => !settings.visible_event_types.includes(t));
  const customCategories = settings.custom_event_categories || [];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-theme-text-primary text-lg font-semibold">Event Type Visibility</h3>
        <p className="text-theme-text-muted mt-1 text-sm">
          Choose which event types appear as primary filter categories.
        </p>
      </div>

      <div>
        <h4 className="text-theme-text-muted mb-2 text-xs font-semibold tracking-wider uppercase">
          Visible Categories
        </h4>
        <div className="space-y-2">
          {visibleTypes.map((eventType) => (
            <div
              key={eventType}
              className="border-theme-surface-border flex items-center justify-between rounded-lg border p-3"
            >
              <div className="flex items-center gap-3">
                <Eye className="h-4 w-4 text-green-600 dark:text-green-400" />
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getEventTypeBadgeColor(eventType)}`}
                >
                  {getEventTypeLabel(eventType)}
                </span>
              </div>
              {eventType !== 'other' && (
                <button
                  type="button"
                  onClick={() => onToggleVisibility(eventType)}
                  disabled={saving}
                  className="text-theme-text-muted hover:text-theme-text-primary text-sm transition-colors disabled:opacity-50"
                  title={`Move "${getEventTypeLabel(eventType)}" to Other`}
                >
                  <EyeOff className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {hiddenTypes.length > 0 && (
        <div>
          <h4 className="text-theme-text-muted mb-2 text-xs font-semibold tracking-wider uppercase">
            Grouped Under &ldquo;Other&rdquo;
          </h4>
          <div className="space-y-2">
            {hiddenTypes.map((eventType) => (
              <div
                key={eventType}
                className="border-theme-surface-border bg-theme-surface-secondary/30 flex items-center justify-between rounded-lg border p-3"
              >
                <div className="flex items-center gap-3">
                  <EyeOff className="text-theme-text-muted h-4 w-4" />
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getEventTypeBadgeColor(eventType)} opacity-60`}
                  >
                    {getEventTypeLabel(eventType)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onToggleVisibility(eventType)}
                  disabled={saving}
                  className="text-theme-text-muted text-sm transition-colors hover:text-green-600 disabled:opacity-50 dark:hover:text-green-400"
                  title={`Show "${getEventTypeLabel(eventType)}" as primary category`}
                >
                  <Eye className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Custom Categories visibility */}
      {customCategories.length > 0 && (
        <div className="border-theme-surface-border border-t pt-4">
          <h4 className="text-theme-text-muted mb-2 text-xs font-semibold tracking-wider uppercase">
            Custom Categories
          </h4>
          <p className="text-theme-text-muted mb-3 text-xs">
            Toggle visibility of organization-defined categories as primary filter tabs.
          </p>
          <div className="space-y-2">
            {customCategories.map((cat) => {
              const isVisible = (settings.visible_custom_categories || []).includes(cat.value);
              return (
                <div
                  key={cat.value}
                  className={`flex items-center justify-between rounded-lg border p-3 ${
                    isVisible
                      ? 'border-theme-surface-border'
                      : 'border-theme-surface-border bg-theme-surface-secondary/30'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {isVisible ? (
                      <Eye className="h-4 w-4 text-green-600 dark:text-green-400" />
                    ) : (
                      <EyeOff className="text-theme-text-muted h-4 w-4" />
                    )}
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cat.color} ${
                        isVisible ? '' : 'opacity-60'
                      }`}
                    >
                      {cat.label}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onToggleCategoryVisibility(cat.value)}
                    disabled={saving}
                    className={`text-sm transition-colors disabled:opacity-50 ${
                      isVisible
                        ? 'text-theme-text-muted hover:text-theme-text-primary'
                        : 'text-theme-text-muted hover:text-green-600 dark:hover:text-green-400'
                    }`}
                    title={isVisible ? `Hide "${cat.label}"` : `Show "${cat.label}" as primary filter`}
                  >
                    {isVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default VisibilitySection;
