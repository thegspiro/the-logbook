/**
 * Events Settings Tab
 *
 * Allows event administrators to configure event module settings,
 * including which event types are visible as primary filter tabs
 * versus grouped under "Other".
 *
 * Shown within the Events Admin Hub.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Settings, Eye, EyeOff, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { eventService } from '../services/api';
import type { EventModuleSettings, EventType } from '../types/event';
import { getEventTypeLabel, getEventTypeBadgeColor } from '../utils/eventHelpers';

const ALL_EVENT_TYPES: EventType[] = [
  'business_meeting',
  'public_education',
  'training',
  'social',
  'fundraiser',
  'ceremony',
  'other',
];

const EventsSettingsTab: React.FC = () => {
  const [settings, setSettings] = useState<EventModuleSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await eventService.getModuleSettings();
      setSettings(data);
    } catch {
      setError('Failed to load event settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  const toggleVisibility = async (eventType: EventType) => {
    if (!settings) return;

    const current = settings.visible_event_types;
    const isVisible = current.includes(eventType);

    // "other" must always remain visible (it's the catch-all)
    if (eventType === 'other' && isVisible) {
      toast.error('"Other" must always remain visible as the catch-all category.');
      return;
    }

    const updated = isVisible
      ? current.filter((t) => t !== eventType)
      : [...current, eventType];

    try {
      setSaving(true);
      const result = await eventService.updateModuleSettings({
        visible_event_types: updated,
      });
      setSettings(result);
      toast.success(
        isVisible
          ? `${getEventTypeLabel(eventType)} moved to "Other" category`
          : `${getEventTypeLabel(eventType)} is now a primary category`
      );
    } catch {
      toast.error('Failed to update setting.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-center items-center h-64">
          <Loader2 className="w-6 h-6 animate-spin text-theme-text-muted" />
        </div>
      </div>
    );
  }

  if (error || !settings) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4" role="alert">
          <p className="text-red-700 dark:text-red-300">{error || 'Failed to load settings.'}</p>
          <button
            onClick={() => void fetchSettings()}
            className="mt-2 text-sm text-red-700 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 underline"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const visibleTypes = ALL_EVENT_TYPES.filter((t) =>
    settings.visible_event_types.includes(t)
  );
  const hiddenTypes = ALL_EVENT_TYPES.filter(
    (t) => !settings.visible_event_types.includes(t)
  );

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="space-y-8">
        {/* Event Type Visibility */}
        <section>
          <div className="flex items-center gap-3 mb-2">
            <Settings className="w-5 h-5 text-red-700" />
            <h2 className="text-lg font-bold text-theme-text-primary">
              Event Type Visibility
            </h2>
          </div>
          <p className="text-sm text-theme-text-muted mb-6">
            Choose which event types appear as primary filter categories. Hidden types will be
            grouped under the &ldquo;Other&rdquo; tab so members can still use them.
          </p>

          {/* Visible event types */}
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-theme-text-secondary uppercase tracking-wider mb-3">
              Visible Categories
            </h3>
            <div className="space-y-2">
              {visibleTypes.map((eventType) => (
                <div
                  key={eventType}
                  className="flex items-center justify-between p-3 bg-theme-surface rounded-lg border border-theme-surface-border"
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
                      onClick={() => void toggleVisibility(eventType)}
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

          {/* Hidden event types (grouped under Other) */}
          {hiddenTypes.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-theme-text-secondary uppercase tracking-wider mb-3">
                Grouped Under &ldquo;Other&rdquo;
              </h3>
              <div className="space-y-2">
                {hiddenTypes.map((eventType) => (
                  <div
                    key={eventType}
                    className="flex items-center justify-between p-3 bg-theme-surface-secondary rounded-lg border border-theme-surface-border"
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
                      onClick={() => void toggleVisibility(eventType)}
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
        </section>
      </div>
    </div>
  );
};

export default EventsSettingsTab;
