import React, { useEffect, useState, useCallback } from 'react';
import { Plus, Trash2, Loader2, Clock, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { EventType } from '../../constants/enums';
import { getEventTypeLabel } from '../../utils/eventHelpers';
import { eventHourMappingService, adminHoursCategoryService } from '../../modules/admin-hours/services/api';
import type { EventHourMapping, AdminHoursCategory } from '../../modules/admin-hours/types';
import type { EventModuleSettings, EventCategoryConfig } from '../../types/event';

interface HourTrackingSectionProps {
  settings: EventModuleSettings;
}

interface SourceGroup {
  sourceLabel: string;
  sourceKey: string;
  isEventType: boolean;
  mappings: EventHourMapping[];
  totalPercentage: number;
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

  for (const et of allEventTypes) {
    const group = mappings.filter((m) => m.eventType === et);
    sourceGroups.push({
      sourceLabel: getEventTypeLabel(et),
      sourceKey: `et:${et}`,
      isEventType: true,
      mappings: group,
      totalPercentage: group.reduce((sum, m) => sum + m.percentage, 0),
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
    });
  }

  // Sources available for the "add" dropdown (all event types + custom categories)
  const allSources = [
    ...allEventTypes.map((et) => ({ type: 'event_type' as const, value: et, label: getEventTypeLabel(et) })),
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
      const msg = err instanceof Error ? err.message : 'Failed to create mapping.';
      toast.error(msg);
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
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-theme-text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-theme-text-primary">
          Event Hour Tracking
        </h3>
        <p className="text-sm text-theme-text-muted mt-1">
          Map event types and custom categories to admin hours categories.
          When members attend events, their hours are automatically credited
          to the mapped admin hours categories.
        </p>
      </div>

      {categories.length === 0 && (
        <div className="bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-200 dark:border-yellow-500/30 rounded-lg p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" />
            <p className="text-sm text-yellow-800 dark:text-yellow-300">
              No admin hours categories exist yet. Create categories in the
              Admin Hours settings before configuring event hour mappings.
            </p>
          </div>
        </div>
      )}

      {/* Current mappings grouped by source */}
      <div className="space-y-4">
        {sourceGroups.filter((g) => g.mappings.length > 0).map((group) => (
          <div
            key={group.sourceKey}
            className="border border-theme-surface-border rounded-lg p-4"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-theme-text-muted" />
                <span className="font-medium text-theme-text-primary">
                  {group.sourceLabel}
                </span>
              </div>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                group.totalPercentage > 100
                  ? 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400'
                  : group.totalPercentage === 100
                    ? 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400'
                    : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400'
              }`}>
                {group.totalPercentage}% allocated
              </span>
            </div>
            <div className="space-y-2">
              {group.mappings.map((mapping) => (
                <div
                  key={mapping.id}
                  className="flex items-center justify-between bg-theme-surface-hover rounded-md px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    {mapping.adminHoursCategoryColor && (
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: mapping.adminHoursCategoryColor }}
                      />
                    )}
                    <span className="text-sm text-theme-text-primary">
                      {mapping.adminHoursCategoryName ?? 'Unknown Category'}
                    </span>
                    <span className="text-xs text-theme-text-muted">
                      ({mapping.percentage}%)
                    </span>
                  </div>
                  <button
                    onClick={() => void handleDeleteMapping(mapping.id)}
                    className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 p-1"
                    title="Remove mapping"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}

        {sourceGroups.every((g) => g.mappings.length === 0) && (
          <p className="text-sm text-theme-text-muted italic text-center py-4">
            No event hour mappings configured yet.
          </p>
        )}
      </div>

      {/* Add new mapping */}
      {categories.length > 0 && (
        <div className="border-t border-theme-surface-border pt-4">
          <h4 className="text-sm font-medium text-theme-text-primary mb-3">
            Add Mapping
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Source selector */}
            <select
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
              className="block w-full rounded-md border border-theme-surface-border bg-theme-surface px-3 py-2 text-sm text-theme-text-primary focus:border-theme-accent-blue focus:outline-none focus:ring-1 focus:ring-theme-accent-blue"
            >
              <option value="">Select event source...</option>
              <optgroup label="Built-in Event Types">
                {allSources.filter((s) => s.type === 'event_type').map((s) => (
                  <option key={s.value} value={`event_type:${s.value}`}>
                    {s.label}
                  </option>
                ))}
              </optgroup>
              {allSources.some((s) => s.type === 'custom') && (
                <optgroup label="Custom Categories">
                  {allSources.filter((s) => s.type === 'custom').map((s) => (
                    <option key={s.value} value={`custom:${s.value}`}>
                      {s.label}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>

            {/* Target admin hours category */}
            <select
              value={newCategoryId}
              onChange={(e) => setNewCategoryId(e.target.value)}
              className="block w-full rounded-md border border-theme-surface-border bg-theme-surface px-3 py-2 text-sm text-theme-text-primary focus:border-theme-accent-blue focus:outline-none focus:ring-1 focus:ring-theme-accent-blue"
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
                min={1}
                max={100}
                value={newPercentage}
                onChange={(e) => setNewPercentage(Number(e.target.value))}
                className="block w-20 rounded-md border border-theme-surface-border bg-theme-surface px-3 py-2 text-sm text-theme-text-primary focus:border-theme-accent-blue focus:outline-none focus:ring-1 focus:ring-theme-accent-blue"
              />
              <span className="text-sm text-theme-text-muted">%</span>
            </div>

            {/* Add button */}
            <button
              onClick={() => void handleAddMapping()}
              disabled={saving || !newSourceValue || !newCategoryId}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-theme-accent-blue px-4 py-2 text-sm font-medium text-white hover:bg-theme-accent-blue/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              Add
            </button>
          </div>
          <p className="text-xs text-theme-text-muted mt-2">
            Total percentage per event source can be up to 100%.
            Unmapped percentage means those hours are not tracked.
          </p>
        </div>
      )}
    </div>
  );
};

export default HourTrackingSection;
