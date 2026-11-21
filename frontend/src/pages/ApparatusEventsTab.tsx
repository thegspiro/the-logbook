/**
 * Apparatus Events — the Community Outreach page for outreach that rolls an
 * apparatus with a named crew but is not a shift (a Santamobile run, a
 * parade, a touch-a-truck). Templates, and the nights scheduled from them.
 * Lazy-loaded as a tab in EventsAdminHub.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Archive, CalendarPlus, Copy, Pencil, Plus, Truck } from 'lucide-react';
import { apparatusEventService } from '../services/api';
import type { ApparatusEventTemplate, EditorOptions, NightScope } from '../types/apparatusEvent';
import { EmptyState, SkeletonCardGrid } from '../components/ux';
import { useConfirm } from '../contexts/ConfirmContext';
import { useAuthStore } from '../stores/authStore';
import { useTimezone } from '../hooks/useTimezone';
import { formatDate } from '../utils/dateFormatting';
import { getEventTypeLabel } from '../utils/eventHelpers';
import { getErrorMessage } from '../utils/errorHandling';
import TemplateEditor from './apparatus-events/TemplateEditor';
import DuplicateTemplateDialog from './apparatus-events/DuplicateTemplateDialog';
import ScheduleNightsForm from './apparatus-events/ScheduleNightsForm';
import NightList from './apparatus-events/NightList';
import { blankDraft, draftFromTemplate } from './apparatus-events/templateForm';
import { EVOC_MODE_LABEL, EVOC_MODE_TONE, TONE, formatDuration } from './apparatus-events/tones';

type View =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'edit'; template: ApparatusEventTemplate }
  | { kind: 'schedule'; template: ApparatusEventTemplate };

type Section = 'templates' | NightScope;

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'templates', label: 'Templates' },
  { id: 'upcoming', label: 'Upcoming nights' },
  { id: 'needs_confirmation', label: 'Needs confirmation' },
  { id: 'past', label: 'Past' },
];

const TemplateCard: React.FC<{
  template: ApparatusEventTemplate;
  timezone: string;
  onSchedule: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
}> = ({ template, timezone, onSchedule, onEdit, onDuplicate, onArchive }) => (
  <article className="card flex flex-col gap-3 p-5">
    <div className="flex items-start justify-between gap-2">
      <h3 className="text-theme-text-primary font-semibold">{template.name}</h3>
      <span className={`badge shrink-0 ${TONE.blue}`}>{getEventTypeLabel(template.event_type)}</span>
    </div>
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {template.units.map((unit) => (
        <span
          key={unit.id}
          className="rounded-md bg-red-800 px-2 py-0.5 font-mono text-xs font-bold text-white"
          title={unit.apparatus_name ?? unit.unit_number}
        >
          {unit.unit_number}
        </span>
      ))}
      <span className="text-theme-text-secondary">
        {template.total_seats} seat{template.total_seats === 1 ? '' : 's'}
      </span>
    </div>
    <p className="text-theme-text-muted text-sm">
      {template.units
        .flatMap((unit) => unit.seats.map((seat) => (seat.count > 1 ? `${seat.name} ×${seat.count}` : seat.name)))
        .join(' · ')}
    </p>
    <div className="flex flex-wrap gap-1.5">
      <span className={`badge ${EVOC_MODE_TONE[template.evoc_mode]}`}>{EVOC_MODE_LABEL[template.evoc_mode]}</span>
      <span className={`badge ${TONE.slate}`}>{formatDuration(template.duration_minutes)}</span>
      <span className={`badge ${TONE.slate}`}>
        {template.admin_hours_category_name ? `Hours: ${template.admin_hours_category_name}` : 'Hours: by event type'}
      </span>
    </div>
    <div className="mt-auto flex flex-wrap gap-2 pt-1">
      <button type="button" className="btn-primary btn-sm" onClick={onSchedule}>
        <CalendarPlus className="h-4 w-4" aria-hidden="true" />
        Schedule nights
      </button>
      <button type="button" className="btn-secondary btn-sm" onClick={onEdit}>
        <Pencil className="h-4 w-4" aria-hidden="true" />
        Edit
      </button>
      <button type="button" className="btn-secondary btn-sm" onClick={onDuplicate}>
        <Copy className="h-4 w-4" aria-hidden="true" />
        Duplicate
      </button>
      <button
        type="button"
        className="btn-secondary btn-sm"
        onClick={onArchive}
        aria-label={`Archive ${template.name}`}
      >
        <Archive className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
    <p className="text-theme-text-muted text-xs">
      {template.nights_scheduled > 0
        ? `Used ${template.nights_scheduled} night${template.nights_scheduled === 1 ? '' : 's'}${
            template.last_scheduled_at ? ` · latest ${formatDate(template.last_scheduled_at, timezone)}` : ''
          }`
        : 'Not scheduled yet'}
      {template.duplicated_from_name ? ` · copied from “${template.duplicated_from_name}”` : ''}
    </p>
  </article>
);

const ApparatusEventsTab: React.FC = () => {
  const tz = useTimezone();
  const { confirm } = useConfirm();
  const canManage = useAuthStore((s) => s.checkPermission('apparatus_events.manage'));
  const [section, setSection] = useState<Section>('templates');
  const [view, setView] = useState<View>({ kind: 'list' });
  const [templates, setTemplates] = useState<ApparatusEventTemplate[] | null>(null);
  const [options, setOptions] = useState<EditorOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState<ApparatusEventTemplate | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [list, opts] = await Promise.all([
        apparatusEventService.listTemplates(),
        apparatusEventService.getEditorOptions(),
      ]);
      setTemplates(list);
      setOptions(opts);
    } catch (err) {
      setError(getErrorMessage(err, 'Could not load apparatus events.'));
      setTemplates([]);
    }
  }, []);

  useEffect(() => {
    if (canManage) void load();
  }, [canManage, load]);

  const archive = async (template: ApparatusEventTemplate) => {
    const ok = await confirm({
      title: 'Archive this template?',
      message: `“${template.name}” leaves the template list. Nights already scheduled from it stay on the calendar with their crews.`,
      confirmLabel: 'Archive template',
      cancelLabel: 'Keep it',
      variant: 'warning',
    });
    if (!ok) return;
    try {
      await apparatusEventService.archiveTemplate(template.id);
      toast.success('Template archived');
      void load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not archive the template.'));
    }
  };

  if (!canManage) {
    return (
      <div className="mx-auto max-w-6xl py-8">
        <EmptyState
          icon={Truck}
          title="Apparatus events are managed by coordinators"
          description="Ask a department leader for the Apparatus Events manage permission to create templates and schedule nights."
          compact
        />
      </div>
    );
  }

  if (options && (view.kind === 'create' || view.kind === 'edit')) {
    return (
      <div className="mx-auto max-w-6xl py-8">
        <TemplateEditor
          initial={view.kind === 'edit' ? draftFromTemplate(view.template) : blankDraft(options.apparatus[0]?.id ?? '')}
          templateId={view.kind === 'edit' ? view.template.id : undefined}
          options={options}
          onSaved={() => {
            setView({ kind: 'list' });
            void load();
          }}
          onCancel={() => setView({ kind: 'list' })}
        />
      </div>
    );
  }

  if (view.kind === 'schedule') {
    return (
      <div className="mx-auto max-w-6xl py-8">
        <ScheduleNightsForm
          template={view.template}
          onScheduled={() => {
            setView({ kind: 'list' });
            setSection('upcoming');
            void load();
          }}
          onCancel={() => setView({ kind: 'list' })}
        />
      </div>
    );
  }

  const noApparatus = options !== null && options.apparatus.length === 0;

  return (
    <div className="mx-auto max-w-6xl space-y-5 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-theme-text-primary flex items-center gap-2 text-lg font-bold">
            <Truck className="h-5 w-5 text-red-700 dark:text-red-400" aria-hidden="true" />
            Apparatus Events
          </h2>
          <p className="text-theme-text-muted mt-1 max-w-3xl text-sm">
            Outreach that rolls an apparatus and needs a crew, like a Santamobile run, a parade or a truck visit. These
            are not shifts: they never count toward shift hours or coverage, and the crew’s hours go to Admin Hours.
          </p>
        </div>
        {section === 'templates' && !noApparatus && (
          <button
            type="button"
            className="btn-primary inline-flex items-center gap-2"
            onClick={() => setView({ kind: 'create' })}
            disabled={!options}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            New template
          </button>
        )}
      </div>

      <div
        className="segmented-group hscroll flex gap-1"
        role="tablist"
        aria-label="Apparatus events"
        data-mobile-scroll-region="true"
      >
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={section === s.id}
            onClick={() => setSection(s.id)}
            className={`touch:min-h-[44px] shrink-0 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${
              section === s.id
                ? 'bg-red-800 text-white shadow-sm'
                : 'text-theme-text-secondary hover:text-theme-text-primary'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {section !== 'templates' ? (
        <NightList scope={section} />
      ) : error ? (
        <div className="alert-danger text-sm" role="alert">
          {error}
        </div>
      ) : templates === null ? (
        <SkeletonCardGrid count={3} />
      ) : noApparatus ? (
        <EmptyState
          icon={Truck}
          title="Add an apparatus first"
          description="Apparatus events use the department’s apparatus records, so the Driver seat can follow each unit’s EVOC level. Add your apparatus in the Apparatus module, then come back to build a template."
          compact
        />
      ) : templates.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="No templates yet"
          description="A template says which apparatus goes out, which seats it needs — Driver, Navigator, Santa, Elves — and how many. Build one, then schedule it on one night or many."
          actions={[{ label: 'New template', onClick: () => setView({ kind: 'create' }), icon: Plus }]}
          compact
        />
      ) : (
        <div className="card-grid gap-4">
          {templates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              timezone={tz}
              onSchedule={() => setView({ kind: 'schedule', template })}
              onEdit={() => setView({ kind: 'edit', template })}
              onDuplicate={() => setDuplicating(template)}
              onArchive={() => void archive(template)}
            />
          ))}
        </div>
      )}

      {options && (
        <DuplicateTemplateDialog
          template={duplicating}
          options={options}
          onClose={() => setDuplicating(null)}
          onCreated={() => {
            setDuplicating(null);
            void load();
          }}
        />
      )}
    </div>
  );
};

export default ApparatusEventsTab;
