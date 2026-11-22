/**
 * Events Settings → CRR Catalogue: the community risk reduction activities a
 * department records, the counts each one keeps, and the risk and priority
 * population tags (owner decisions, 2026-11-21/22).
 *
 * Loads and saves on its own, like Hour Tracking: every change is written as
 * it is made, so there is no Save footer to forget. A built-in type is retired
 * rather than deleted; a type the department added can be deleted.
 *
 * CRR Activities (and an outreach event's CRR card) offer what is here. Each
 * type credits the Admin Hours category chosen for it, or the department's
 * Public Education mapping when none is chosen; the retention setting is read
 * by the daily task that clears resident details.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Archive, ArchiveRestore, Hourglass, Pencil, Plus, Trash2 } from 'lucide-react';
import { crrService } from '../../services/crrServices';
import type { CrrActivityType, CrrCatalogue, CrrTag, CrrTagKind } from '../../types/crr';
import { CrrTagKind as TAG_KIND } from '../../types/crr';
import { PromptDialog } from '../../components/ux/PromptDialog';
import { useConfirm } from '../../contexts/ConfirmContext';
import { getErrorMessage } from '../../utils/errorHandling';
import { asArray } from '../../utils/asArray';

const TAG_GROUPS: { kind: CrrTagKind; title: string; hint: string }[] = [
  { kind: TAG_KIND.RISK, title: 'Risks', hint: 'What an activity reduces' },
  { kind: TAG_KIND.POPULATION, title: 'Priority populations', hint: 'Who an activity is aimed at' },
];

const smallButton =
  'btn-secondary touch:min-h-11 inline-flex items-center gap-1.5 px-2.5 py-1 text-sm disabled:opacity-50';

interface PromptState {
  title: string;
  label: string;
  defaultValue: string;
  multiline?: boolean;
  required?: boolean;
  onSubmit: (value: string) => Promise<void>;
}

const Badge: React.FC<{ tone: 'neutral' | 'muted'; children: React.ReactNode }> = ({ tone, children }) => (
  <span
    className={`badge ${
      tone === 'neutral'
        ? 'bg-theme-surface-secondary text-theme-text-secondary'
        : 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200'
    }`}
  >
    {children}
  </span>
);

const CrrCatalogueSection: React.FC = () => {
  const { confirm } = useConfirm();
  const [catalogue, setCatalogue] = useState<CrrCatalogue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [newTypeName, setNewTypeName] = useState('');
  const [newTypeCounts, setNewTypeCounts] = useState('');
  const [newTag, setNewTag] = useState<Record<CrrTagKind, string>>({ risk: '', population: '' });
  const [retention, setRetention] = useState('24');

  const load = useCallback(async () => {
    try {
      const data = await crrService.getCatalogue();
      // A malformed body reads as an empty catalogue, not a crashed page.
      setCatalogue({
        activity_types: asArray(data?.activity_types),
        tags: asArray(data?.tags),
        admin_hours_categories: asArray(data?.admin_hours_categories),
        resident_details_retention_months:
          typeof data?.resident_details_retention_months === 'number' ? data.resident_details_retention_months : 24,
      });
      setRetention(String(data?.resident_details_retention_months ?? 24));
      setError(null);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'The CRR catalogue could not be loaded.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const replaceType = (updated: CrrActivityType) =>
    setCatalogue((current) =>
      current
        ? { ...current, activity_types: current.activity_types.map((t) => (t.id === updated.id ? updated : t)) }
        : current
    );

  const replaceTag = (updated: CrrTag) =>
    setCatalogue((current) =>
      current ? { ...current, tags: current.tags.map((t) => (t.id === updated.id ? updated : t)) } : current
    );

  /** Run one write, report its outcome, and keep the screen in step. */
  const run = async (action: () => Promise<void>, success: string, failure: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(success);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, failure));
    } finally {
      setBusy(false);
    }
  };

  const addType = async () => {
    const name = newTypeName.trim();
    if (!name) return;
    const measures = newTypeCounts
      .split(',')
      .map((label) => label.trim())
      .filter(Boolean);
    await run(
      async () => {
        await crrService.createType({ name, measures });
        setNewTypeName('');
        setNewTypeCounts('');
        await load();
      },
      `Added ${name}.`,
      'The activity type could not be added.'
    );
  };

  const deleteType = async (activityType: CrrActivityType) => {
    const ok = await confirm({
      title: `Delete ${activityType.name}?`,
      message: 'It and its counts are removed from the catalogue. This cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (!ok) return;
    await run(
      async () => {
        await crrService.deleteType(activityType.id);
        await load();
      },
      `Deleted ${activityType.name}.`,
      'The activity type could not be deleted.'
    );
  };

  const toggleTypeTag = async (activityType: CrrActivityType, tagId: string, on: boolean) => {
    const tagIds = on ? [...activityType.tag_ids, tagId] : activityType.tag_ids.filter((id) => id !== tagId);
    await run(
      async () => replaceType(await crrService.setTypeTags(activityType.id, tagIds)),
      `Updated ${activityType.name}'s tags.`,
      'The tags could not be saved.'
    );
  };

  const addTag = async (kind: CrrTagKind) => {
    const label = newTag[kind].trim();
    if (!label) return;
    await run(
      async () => {
        await crrService.createTag(kind, label);
        setNewTag((current) => ({ ...current, [kind]: '' }));
        await load();
      },
      `Added ${label}.`,
      'The tag could not be added.'
    );
  };

  if (error) {
    return (
      <div className="alert-danger text-sm" role="alert">
        {error}
      </div>
    );
  }
  if (!catalogue) {
    return (
      <div className="text-theme-text-muted py-8 text-sm" role="status" aria-live="polite">
        Loading the CRR catalogue…
      </div>
    );
  }

  const activeTags = (kind: CrrTagKind) => catalogue.tags.filter((t) => t.kind === kind && t.is_active);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-theme-text-primary text-lg font-semibold">CRR Catalogue</h2>
        <p className="text-theme-text-muted mt-1 text-sm">
          The community risk reduction activities your department records, what each one counts, and the risks and
          priority populations they are tagged with. Changes save as you make them.
        </p>
      </div>

      <section aria-labelledby="crr-types-heading" className="space-y-3">
        <h3 id="crr-types-heading" className="text-theme-text-primary font-semibold">
          Activity types
        </h3>
        <ul className="space-y-3">
          {catalogue.activity_types.map((activityType) => (
            <li key={activityType.id} className="card-secondary p-4" aria-labelledby={`crr-type-${activityType.id}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      id={`crr-type-${activityType.id}`}
                      className="text-theme-text-primary font-semibold break-words"
                    >
                      {activityType.name}
                    </span>
                    {activityType.is_system && <Badge tone="neutral">Built-in</Badge>}
                    {!activityType.is_active && <Badge tone="muted">Retired</Badge>}
                  </div>
                  {activityType.description && (
                    <p className="text-theme-text-secondary mt-1 text-sm break-words">{activityType.description}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={smallButton}
                    disabled={busy}
                    aria-label={`Rename ${activityType.name}`}
                    onClick={() =>
                      setPrompt({
                        title: `Rename ${activityType.name}`,
                        label: 'Name',
                        defaultValue: activityType.name,
                        onSubmit: async (name) =>
                          run(
                            async () => replaceType(await crrService.updateType(activityType.id, { name })),
                            'Renamed.',
                            'The activity type could not be renamed.'
                          ),
                      })
                    }
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    Rename
                  </button>
                  <button
                    type="button"
                    className={smallButton}
                    disabled={busy}
                    aria-label={`Describe ${activityType.name}`}
                    onClick={() =>
                      setPrompt({
                        title: `Describe ${activityType.name}`,
                        label: 'Description',
                        defaultValue: activityType.description ?? '',
                        multiline: true,
                        required: false,
                        onSubmit: async (description) =>
                          run(
                            async () =>
                              replaceType(
                                await crrService.updateType(activityType.id, { description: description || null })
                              ),
                            'Description saved.',
                            'The description could not be saved.'
                          ),
                      })
                    }
                  >
                    Describe
                  </button>
                  <button
                    type="button"
                    className={smallButton}
                    disabled={busy}
                    aria-label={`${activityType.is_active ? 'Retire' : 'Restore'} ${activityType.name}`}
                    onClick={() =>
                      void run(
                        async () =>
                          replaceType(
                            await crrService.updateType(activityType.id, { is_active: !activityType.is_active })
                          ),
                        activityType.is_active ? `Retired ${activityType.name}.` : `Restored ${activityType.name}.`,
                        'The activity type could not be changed.'
                      )
                    }
                  >
                    {activityType.is_active ? (
                      <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <ArchiveRestore className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {activityType.is_active ? 'Retire' : 'Restore'}
                  </button>
                  {!activityType.is_system && (
                    <button
                      type="button"
                      className={smallButton}
                      disabled={busy}
                      aria-label={`Delete ${activityType.name}`}
                      onClick={() => void deleteType(activityType)}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Delete
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-3">
                <h4 className="text-theme-text-muted text-xs font-semibold tracking-wider uppercase">Counts</h4>
                <ul className="mt-1.5 space-y-1.5">
                  {activityType.measures.map((measure) => (
                    <li key={measure.id} className="flex flex-wrap items-center gap-2">
                      <span
                        className={`text-sm ${measure.is_active ? 'text-theme-text-primary' : 'text-theme-text-muted line-through'}`}
                      >
                        {measure.label}
                      </span>
                      {!measure.is_active && <Badge tone="muted">Retired</Badge>}
                      <button
                        type="button"
                        className={smallButton}
                        disabled={busy}
                        aria-label={`Rename the count ${measure.label}`}
                        onClick={() =>
                          setPrompt({
                            title: `Rename "${measure.label}"`,
                            label: 'Count',
                            defaultValue: measure.label,
                            onSubmit: async (label) =>
                              run(
                                async () => replaceType(await crrService.updateMeasure(measure.id, { label })),
                                'Renamed.',
                                'The count could not be renamed.'
                              ),
                          })
                        }
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className={smallButton}
                        disabled={busy}
                        aria-label={`${measure.is_active ? 'Retire' : 'Restore'} the count ${measure.label}`}
                        onClick={() =>
                          void run(
                            async () =>
                              replaceType(
                                await crrService.updateMeasure(measure.id, { is_active: !measure.is_active })
                              ),
                            measure.is_active ? `Retired ${measure.label}.` : `Restored ${measure.label}.`,
                            'The count could not be changed.'
                          )
                        }
                      >
                        {measure.is_active ? 'Retire' : 'Restore'}
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className={`${smallButton} mt-2`}
                  disabled={busy}
                  aria-label={`Add a count to ${activityType.name}`}
                  onClick={() =>
                    setPrompt({
                      title: `Add a count to ${activityType.name}`,
                      label: 'Count',
                      defaultValue: '',
                      onSubmit: async (label) =>
                        run(
                          async () => replaceType(await crrService.addMeasure(activityType.id, label)),
                          `Added ${label}.`,
                          'The count could not be added.'
                        ),
                    })
                  }
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Add a count
                </button>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {TAG_GROUPS.map((group) => (
                  <fieldset key={group.kind}>
                    <legend className="text-theme-text-muted text-xs font-semibold tracking-wider uppercase">
                      {group.title}
                    </legend>
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                      {activeTags(group.kind).map((tag) => (
                        <label
                          key={tag.id}
                          className="text-theme-text-secondary touch:min-h-11 inline-flex items-center gap-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            className="form-checkbox"
                            checked={activityType.tag_ids.includes(tag.id)}
                            disabled={busy}
                            onChange={(e) => void toggleTypeTag(activityType, tag.id, e.target.checked)}
                          />
                          {tag.label}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>

              <div className="mt-3 max-w-sm">
                <label htmlFor={`crr-hours-${activityType.id}`} className="form-label">
                  Admin Hours category
                </label>
                <select
                  id={`crr-hours-${activityType.id}`}
                  className="form-input"
                  value={activityType.admin_hours_category_id ?? ''}
                  disabled={busy}
                  onChange={(e) =>
                    void run(
                      async () =>
                        replaceType(
                          await crrService.updateType(activityType.id, {
                            admin_hours_category_id: e.target.value || null,
                          })
                        ),
                      `Updated ${activityType.name}.`,
                      'The Admin Hours category could not be saved.'
                    )
                  }
                >
                  <option value="">The Public Education mapping</option>
                  {catalogue.admin_hours_categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>
            </li>
          ))}
          <li className="card-secondary border-dashed p-4 opacity-80" aria-labelledby="crr-type-firesetter">
            <div className="flex flex-wrap items-center gap-2">
              <Hourglass className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
              <span id="crr-type-firesetter" className="text-theme-text-primary font-semibold">
                Juvenile firesetter intervention
              </span>
              <Badge tone="neutral">Coming soon</Badge>
            </div>
            <p className="text-theme-text-secondary mt-1 text-sm">
              A separate option your department will be able to turn on. Its records concern minors, so it will come
              with its own access rules.
            </p>
          </li>
        </ul>

        <div className="card-secondary space-y-3 p-4">
          <h4 className="text-theme-text-primary text-sm font-semibold">Add an activity type</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="form-label">Name</span>
              <input
                className="form-input"
                value={newTypeName}
                maxLength={120}
                onChange={(e) => setNewTypeName(e.target.value)}
                placeholder="e.g. Water safety talk"
              />
            </label>
            <div>
              <label htmlFor="crr-new-type-counts" className="form-label">
                Counts (optional)
              </label>
              <input
                id="crr-new-type-counts"
                className="form-input"
                value={newTypeCounts}
                onChange={(e) => setNewTypeCounts(e.target.value)}
                placeholder="e.g. People reached, Sessions"
                aria-describedby="crr-new-type-counts-hint"
              />
              <p id="crr-new-type-counts-hint" className="text-theme-text-muted mt-1 text-xs">
                Separate counts with commas. You can add more later.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn-primary inline-flex items-center gap-2"
            disabled={busy || !newTypeName.trim()}
            onClick={() => void addType()}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add activity type
          </button>
        </div>
      </section>

      <section aria-labelledby="crr-retention-heading" className="card-secondary space-y-3 p-4">
        <h3 id="crr-retention-heading" className="text-theme-text-primary font-semibold">
          Resident details
        </h3>
        <p className="text-theme-text-muted text-sm">
          A resident&apos;s address, name, phone, email and the notes are cleared automatically this many months after
          the activity. The ZIP code, city, state and counts are kept.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="crr-retention" className="form-label">
              Keep for (months)
            </label>
            <input
              id="crr-retention"
              type="number"
              min={1}
              max={120}
              inputMode="numeric"
              className="form-input w-28"
              value={retention}
              onChange={(e) => setRetention(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn-secondary touch:min-h-11"
            disabled={
              busy ||
              !/^\d+$/.test(retention) ||
              Number(retention) < 1 ||
              Number(retention) > 120 ||
              Number(retention) === catalogue.resident_details_retention_months
            }
            onClick={() =>
              void run(
                async () => {
                  const months = await crrService.updateSettings(Number(retention));
                  setCatalogue((current) =>
                    current ? { ...current, resident_details_retention_months: months } : current
                  );
                },
                'Saved.',
                'The setting could not be saved.'
              )
            }
          >
            Save
          </button>
        </div>
      </section>

      <section aria-labelledby="crr-tags-heading" className="space-y-3">
        <h3 id="crr-tags-heading" className="text-theme-text-primary font-semibold">
          Tags
        </h3>
        <div className="grid gap-4 lg:grid-cols-2">
          {TAG_GROUPS.map((group) => (
            <div key={group.kind} className="card-secondary p-4">
              <h4 className="text-theme-text-primary text-sm font-semibold">{group.title}</h4>
              <p className="text-theme-text-muted text-sm">{group.hint}</p>
              <ul className="mt-2 space-y-1.5">
                {catalogue.tags
                  .filter((tag) => tag.kind === group.kind)
                  .map((tag) => (
                    <li key={tag.id} className="flex flex-wrap items-center gap-2">
                      <span
                        className={`text-sm ${tag.is_active ? 'text-theme-text-primary' : 'text-theme-text-muted line-through'}`}
                      >
                        {tag.label}
                      </span>
                      {!tag.is_active && <Badge tone="muted">Retired</Badge>}
                      <button
                        type="button"
                        className={smallButton}
                        disabled={busy}
                        aria-label={`Rename the tag ${tag.label}`}
                        onClick={() =>
                          setPrompt({
                            title: `Rename "${tag.label}"`,
                            label: 'Tag',
                            defaultValue: tag.label,
                            onSubmit: async (label) =>
                              run(
                                async () => replaceTag(await crrService.updateTag(tag.id, { label })),
                                'Renamed.',
                                'The tag could not be renamed.'
                              ),
                          })
                        }
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className={smallButton}
                        disabled={busy}
                        aria-label={`${tag.is_active ? 'Retire' : 'Restore'} the tag ${tag.label}`}
                        onClick={() =>
                          void run(
                            async () => replaceTag(await crrService.updateTag(tag.id, { is_active: !tag.is_active })),
                            tag.is_active ? `Retired ${tag.label}.` : `Restored ${tag.label}.`,
                            'The tag could not be changed.'
                          )
                        }
                      >
                        {tag.is_active ? 'Retire' : 'Restore'}
                      </button>
                    </li>
                  ))}
              </ul>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="min-w-0 flex-1">
                  <span className="form-label">New {group.kind === TAG_KIND.RISK ? 'risk' : 'population'}</span>
                  <input
                    className="form-input"
                    value={newTag[group.kind]}
                    maxLength={120}
                    onChange={(e) => setNewTag((current) => ({ ...current, [group.kind]: e.target.value }))}
                  />
                </label>
                <button
                  type="button"
                  className="btn-secondary touch:min-h-11 inline-flex items-center gap-1.5"
                  disabled={busy || !newTag[group.kind].trim()}
                  onClick={() => void addTag(group.kind)}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <PromptDialog
        isOpen={prompt !== null}
        onClose={() => setPrompt(null)}
        title={prompt?.title ?? ''}
        label={prompt?.label ?? ''}
        defaultValue={prompt?.defaultValue ?? ''}
        multiline={prompt?.multiline ?? false}
        required={prompt?.required ?? true}
        confirmLabel="Save"
        loading={busy}
        onSubmit={(value) => {
          const current = prompt;
          setPrompt(null);
          if (current) void current.onSubmit(value);
        }}
      />
    </div>
  );
};

export default CrrCatalogueSection;
