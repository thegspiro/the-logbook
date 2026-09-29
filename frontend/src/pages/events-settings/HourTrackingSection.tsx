import React, { useEffect, useState, useCallback } from 'react';
import { Plus, Trash2, Loader2, Clock, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { EventType } from '../../constants/enums';
import { getEventTypeLabel } from '../../utils/eventHelpers';
import { eventHourMappingService, adminHoursCategoryService } from '../../modules/admin-hours/services/api';
import type { EventHourMapping, AdminHoursCategory } from '../../modules/admin-hours/types';
import type { EventModuleSettings, EventCategoryConfig } from '../../types/event';
import { getErrorMessage } from '../../utils/errorHandling';

// Event types whose attendance never earns admin hours: a Training event's
// attendance is credited to members' training records when it is finalized,
// and crediting admin hours too counted the same hours twice. A copy of
// backend/app/models/admin_hours.py EVENT_TYPES_WITHOUT_ADMIN_HOURS, which is
// the authority (the backend refuses a new mapping for these types and reports
// a stored one as not in effect) — keep the two in step (CLAUDE.md pitfall #19).
const EVENT_TYPES_WITHOUT_ADMIN_HOURS: readonly EventType[] = [EventType.TRAINING];

const NOT_IN_EFFECT_FALLBACK_REASON = "training events credit members' training records instead";

interface HourTrackingSectionProps {
  settings: EventModuleSettings;
}

interface SourceGroup {
  sourceLabel: string;
  sourceKey: string;
  isEventType: boolean;
  mappings: EventHourMapping[];
  totalPercentage: number;
  /** False when the backend reports every mapping in the group as inert. */
  inEffect: boolean;
}

const HourTrackingSection: React.FC<HourTrackingSectionProps> = ({ settings }) => {
  const [mappings, setMappings] = useState<EventHourMapping[]>([]);
  const [categories, setCategories] = useState<AdminHoursCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // New mapping form
  const [newSourceType, setNewSourceType] = useState<'event_type' | 'custom'>('event_type');
  const [newSourceValue, setNewSourceValue] = useState('');
  const [newCategoryId, setNewCategoryId] = useState('');
  const [newPercentage, setNewPercentage] = useState(100);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [mappingList, categoryList] = await Promise.all([
        eventHourMappingService.list({ includeInactive: true }),
        adminHoursCategoryService.list(),
      ]);
      setMappings(mappingList);
      setCategories(categoryList);
    } catch {
      toast.error('Failed to load hour tracking mappings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Build source groups for display
  const allEventTypes = Object.values(EventType);
  const customCategories: EventCategoryConfig[] = settings.custom_event_categories ?? [];

  const sourceGroups: SourceGroup[] = [];

  // Whether a mapping is in effect is the backend's call (pitfall #29): an
  // absent flag, from a server that predates it, means it is.
  const anyInEffect = (group: EventHourMapping[]) => group.some((m) => m.inEffect !== false);

  // Every event type is grouped, including those that earn no admin hours, so
  // a mapping stored before that rule is still listed — labelled — and can be
  // removed.
  for (const et of allEventTypes) {
    const group = mappings.filter((m) => m.eventType === et);
    sourceGroups.push({
      sourceLabel: getEventTypeLabel(et),
      sourceKey: `et:${et}`,
      isEventType: true,
      mappings: group,
      totalPercentage: group.reduce((sum, m) => sum + m.percentage, 0),
      inEffect: anyInEffect(group),
    });
  }

  for (const cc of customCategories) {
    const group = mappings.filter((m) => m.customCategory === cc.value);
    sourceGroups.push({
      sourceLabel: cc.label,
      sourceKey: `cc:${cc.value}`,
      isEventType: false,
      mappings: group,
      totalPercentage: group.reduce((sum, m) => sum + m.percentage, 0),
      inEffect: anyInEffect(group),
    });
  }

  // Sources available for the "add" dropdown: the event types that can earn
  // admin hours, plus custom categories
  const allSources = [
    ...allEventTypes
      .filter((et) => !EVENT_TYPES_WITHOUT_ADMIN_HOURS.includes(et))
      .map((et) => ({ type: 'event_type' as const, value: et, label: getEventTypeLabel(et) })),
    ...customCategories.map((cc) => ({ type: 'custom' as const, value: cc.value, label: cc.label })),
  ];

  const handleAddMapping = async () => {
    if (!newSourceValue || !newCategoryId) {
      toast.error('Select both an event source and an admin hours category.');
      return;
    }
    try {
      setSaving(true);
      const created = await eventHourMappingService.create({
        event_type: newSourceType === 'event_type' ? newSourceValue : undefined,
        custom_category: newSourceType === 'custom' ? newSourceValue : undefined,
        admin_hours_category_id: newCategoryId,
        percentage: newPercentage,
      });
      setMappings((prev) => [...prev, created]);
      setNewSourceValue('');
      setNewCategoryId('');
      setNewPercentage(100);
      toast.success('Mapping created.');
    } catch (err: unknown) {
      // The backend's refusal (over-allocation, an event type that earns no
      // admin hours) is in the response detail; an axios error's own message
      // is only "Request failed with status code 400".
      toast.error(getErrorMessage(err, 'Failed to create mapping.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteMapping = async (mappingId: string) => {
    try {
      await eventHourMappingService.delete(mappingId);
      setMappings((prev) => prev.filter((m) => m.id !== mappingId));
      toast.success('Mapping removed.');
    } catch {
      toast.error('Failed to delete mapping.');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
        <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-theme-text-primary text-lg font-semibold">Event Hour Tracking</h3>
        <p className="text-theme-text-muted mt-1 text-sm">
          Map event types and custom categories to admin hours categories. When members attend events, their hours are
          automatically credited to the mapped admin hours categories. Training events are not mapped here: their
          attendance is credited to members&apos; training records instead of admin hours.
        </p>
      </div>

      {categories.length === 0 && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-500/30 dark:bg-yellow-500/10">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-yellow-600 dark:text-yellow-400" />
            <p className="text-sm text-yellow-800 dark:text-yellow-300">
              No admin hours categories exist yet. Create categories in the Admin Hours settings before configuring
              event hour mappings.
            </p>
          </div>
        </div>
      )}

      {/* Current mappings grouped by source */}
      <div className="space-y-4">
        {sourceGroups
          .filter((g) => g.mappings.length > 0)
          .map((group) => (
            <div
              key={group.sourceKey}
              role="group"
              aria-label={`${group.sourceLabel} mappings`}
              className="border-theme-surface-border rounded-lg border p-4"
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="text-theme-text-muted h-4 w-4" />
                  <span className="text-theme-text-primary font-medium">{group.sourceLabel}</span>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    !group.inEffect
                      ? 'border-theme-surface-border text-theme-text-secondary border'
                      : group.totalPercentage > 100
                        ? 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400'
                        : group.totalPercentage === 100
                          ? 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400'
                          : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400'
                  }`}
                >
                  {group.totalPercentage}% allocated
                </span>
              </div>
              <div className="space-y-2">
                {group.mappings.map((mapping) => (
                  <div
                    key={mapping.id}
                    className="bg-theme-surface-hover flex items-center justify-between rounded-md px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {mapping.adminHoursCategoryColor && (
                          <span
                            className="h-3 w-3 shrink-0 rounded-full"
                            style={{ backgroundColor: mapping.adminHoursCategoryColor }}
                          />
                        )}
                        <span className="text-theme-text-primary text-sm">
                          {mapping.adminHoursCategoryName ?? 'Unknown Category'}
                        </span>
                        <span className="text-theme-text-muted text-xs">({mapping.percentage}%)</span>
                      </div>
                      {mapping.inEffect === false && (
                        <p className="text-theme-text-secondary mt-1 text-xs">
                          Not in effect — {mapping.notInEffectReason || NOT_IN_EFFECT_FALLBACK_REASON}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDeleteMapping(mapping.id)}
                      className="btn-icon-sm shrink-0 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                      title="Remove mapping"
                      aria-label={`Remove ${group.sourceLabel} mapping to ${mapping.adminHoursCategoryName ?? 'Unknown Category'}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}

        {sourceGroups.every((g) => g.mappings.length === 0) && (
          <p className="text-theme-text-muted py-4 text-center text-sm italic">
            No event hour mappings configured yet.
          </p>
        )}
      </div>

      {/* Add new mapping */}
      {categories.length > 0 && (
        <div className="border-theme-surface-border border-t pt-4">
          <h4 className="text-theme-text-primary mb-3 text-sm font-medium">Add Mapping</h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {/* Source selector */}
            <select
              aria-label="Event source"
              value={newSourceValue ? `${newSourceType}:${newSourceValue}` : ''}
              onChange={(e) => {
                const val = e.target.value;
                if (!val) {
                  setNewSourceValue('');
                  return;
                }
                const [type, ...rest] = val.split(':');
                const source = rest.join(':');
                setNewSourceType(type === 'custom' ? 'custom' : 'event_type');
                setNewSourceValue(source);
              }}
              className="form-input focus:border-theme-accent-blue focus:ring-theme-accent-blue block px-3 text-sm"
            >
              <option value="">Select event source...</option>
              <optgroup label="Built-in Event Types">
                {allSources
                  .filter((s) => s.type === 'event_type')
                  .map((s) => (
                    <option key={s.value} value={`event_type:${s.value}`}>
                      {s.label}
                    </option>
                  ))}
              </optgroup>
              {allSources.some((s) => s.type === 'custom') && (
                <optgroup label="Custom Categories">
                  {allSources
                    .filter((s) => s.type === 'custom')
                    .map((s) => (
                      <option key={s.value} value={`custom:${s.value}`}>
                        {s.label}
                      </option>
                    ))}
                </optgroup>
              )}
            </select>

            {/* Target admin hours category */}
            <select
              aria-label="Admin hours category"
              value={newCategoryId}
              onChange={(e) => setNewCategoryId(e.target.value)}
              className="form-input focus:border-theme-accent-blue focus:ring-theme-accent-blue block px-3 text-sm focus:ring-1"
            >
              <option value="">Select admin hours category...</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>

            {/* Percentage */}
            <div className="flex items-center gap-2">
              <input
                type="number"
                aria-label="Percentage of event hours"
                min={1}
                max={100}
                value={newPercentage}
                onChange={(e) => setNewPercentage(Number(e.target.value))}
                className="form-input focus:border-theme-accent-blue focus:ring-theme-accent-blue block w-20 px-3 text-sm focus:ring-1"
              />
              <span className="text-theme-text-muted text-sm">%</span>
            </div>

            {/* Add button */}
            <button
              type="button"
              onClick={() => void handleAddMapping()}
              disabled={saving || !newSourceValue || !newCategoryId}
              className="bg-theme-accent-blue hover:bg-theme-accent-blue/90 inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-950"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add
            </button>
          </div>
          <p className="text-theme-text-muted mt-2 text-xs">
            Total percentage per event source can be up to 100%. Unmapped percentage means those hours are not tracked.
          </p>
        </div>
      )}
    </div>
  );
};

export default HourTrackingSection;
