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
        <h3 className="text-lg font-semibold text-theme-text-primary">Event Type Visibility</h3>
        <p className="text-sm text-theme-text-muted mt-1">
          Choose which event types appear as primary filter categories.
        </p>
      </div>

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-theme-text-muted mb-2">
          Visible Categories
        </h4>
        <div className="space-y-2">
          {visibleTypes.map((eventType) => (
            <div
              key={eventType}
              className="flex items-center justify-between p-3 rounded-lg border border-theme-surface-border"
            >
              <div className="flex items-center gap-3">
                <Eye className="w-4 h-4 text-green-600 dark:text-green-400" />
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getEventTypeBadgeColor(eventType)}`}
                >
                  {getEventTypeLabel(eventType)}
                </span>
              </div>
              {eventType !== 'other' && (
                <button
                  type="button"
                  onClick={() => onToggleVisibility(eventType)}
                  disabled={saving}
                  className="text-sm text-theme-text-muted hover:text-theme-text-primary disabled:opacity-50 transition-colors"
                  title={`Move "${getEventTypeLabel(eventType)}" to Other`}
                >
                  <EyeOff className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {hiddenTypes.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-theme-text-muted mb-2">
            Grouped Under &ldquo;Other&rdquo;
          </h4>
          <div className="space-y-2">
            {hiddenTypes.map((eventType) => (
              <div
                key={eventType}
                className="flex items-center justify-between p-3 rounded-lg border border-theme-surface-border bg-theme-surface-secondary/30"
              >
                <div className="flex items-center gap-3">
                  <EyeOff className="w-4 h-4 text-theme-text-muted" />
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getEventTypeBadgeColor(eventType)} opacity-60`}
                  >
                    {getEventTypeLabel(eventType)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onToggleVisibility(eventType)}
                  disabled={saving}
                  className="text-sm text-theme-text-muted hover:text-green-600 dark:hover:text-green-400 disabled:opacity-50 transition-colors"
                  title={`Show "${getEventTypeLabel(eventType)}" as primary category`}
                >
                  <Eye className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Custom Categories visibility */}
      {customCategories.length > 0 && (
        <div className="border-t border-theme-surface-border pt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-theme-text-muted mb-2">
            Custom Categories
          </h4>
          <p className="text-xs text-theme-text-muted mb-3">
            Toggle visibility of organization-defined categories as primary filter tabs.
          </p>
          <div className="space-y-2">
            {customCategories.map((cat) => {
              const isVisible = (settings.visible_custom_categories || []).includes(cat.value);
              return (
                <div
                  key={cat.value}
                  className={`flex items-center justify-between p-3 rounded-lg border ${
                    isVisible
                      ? 'border-theme-surface-border'
                      : 'border-theme-surface-border bg-theme-surface-secondary/30'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {isVisible ? (
                      <Eye className="w-4 h-4 text-green-600 dark:text-green-400" />
                    ) : (
                      <EyeOff className="w-4 h-4 text-theme-text-muted" />
                    )}
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cat.color} ${
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
                    className={`text-sm disabled:opacity-50 transition-colors ${
                      isVisible
                        ? 'text-theme-text-muted hover:text-theme-text-primary'
                        : 'text-theme-text-muted hover:text-green-600 dark:hover:text-green-400'
                    }`}
                    title={isVisible ? `Hide "${cat.label}"` : `Show "${cat.label}" as primary filter`}
                  >
                    {isVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
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
