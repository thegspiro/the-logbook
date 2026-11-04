/**
 * Historical Data Import — administrative hours.
 *
 * Administrative rows are not reviewed one by one: they become approved Admin
 * Hours entries in one commit, so what needs deciding is the rule set. Which
 * columns describe an entry; which category each row takes — by a yes/no flag
 * column first (the first set flag in the list wins), else by the hours column
 * it is in; and who each member is that nothing matched. The preview counts
 * what would be written before anything is.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { HistoricalRecordType } from '../../../constants/enums';
import { adminHoursCategoryService } from '../../../modules/admin-hours/services/api';
import { historicalImportService } from '../../../modules/integrations/services/historicalImportApi';
import type {
  AdminMemberMapping,
  AdminPreview,
  AdminSettings,
  HistoricalImportDetail,
} from '../../../modules/integrations/types/historicalImport';
import { formatNumber } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';

interface AdminHoursSectionProps {
  detail: HistoricalImportDetail;
}

const CREATE = '__create__';

const AdminHoursSection: React.FC<AdminHoursSectionProps> = ({ detail }) => {
  const { confirm } = useConfirm();
  const importId = detail.import.id;
  const [preview, setPreview] = useState<AdminPreview | null>(null);
  const [settings, setSettings] = useState<AdminSettings>({
    description_columns: [],
    flag_categories: [],
    default_categories: {},
  });
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(false);
  const [newCategory, setNewCategory] = useState('');

  const adminColumns = useMemo(
    () =>
      Object.entries(detail.hour_columns)
        .filter(([, type]) => type === HistoricalRecordType.ADMIN)
        .map(([header]) => header),
    [detail.hour_columns]
  );
  // Columns not already read as a field, hours or calls: the ones that can
  // describe an entry or flag its category.
  const freeColumns = useMemo(() => {
    const used = new Set([
      ...Object.values(detail.column_mapping),
      ...Object.keys(detail.hour_columns),
      ...Object.keys(detail.call_columns),
    ]);
    return detail.headers.filter((h) => !used.has(h));
  }, [detail]);

  const apply = useCallback((next: AdminPreview) => {
    setPreview(next);
    setSettings(next.settings);
  }, []);

  const run = async (action: () => Promise<void>, failure: string) => {
    setBusy(true);
    try {
      await action();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, failure));
    } finally {
      setBusy(false);
    }
  };

  const load = useCallback(async () => {
    setBusy(true);
    try {
      apply(await historicalImportService.getAdminPreview(importId));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not prepare the administrative hours'));
    } finally {
      setBusy(false);
    }
  }, [apply, importId]);

  useEffect(() => {
    if (opened) void load();
  }, [opened, load]);

  const saveSettings = () =>
    void run(async () => {
      apply(await historicalImportService.updateAdminSettings(importId, settings));
      toast.success('Saved');
    }, 'Could not save the administrative settings');

  const createCategory = () =>
    void run(async () => {
      await adminHoursCategoryService.create({ name: newCategory.trim() });
      setNewCategory('');
      apply(await historicalImportService.getAdminPreview(importId));
      toast.success('Category created');
    }, 'Could not create the category');

  const decideMembers = (members: Record<string, AdminMemberMapping | null>) =>
    void run(async () => {
      apply(await historicalImportService.updateMembers(importId, members));
    }, 'Could not save that decision');

  const commit = async () => {
    if (!preview) return;
    const creating = preview.members.filter((m) => m.status === 'create').length;
    const ok = await confirm({
      title: 'Import the administrative hours?',
      message: `This writes ${formatNumber(preview.pending_records)} approved Admin Hours entries${
        creating ? ` and creates ${creating} archived former-member records` : ''
      }. Rows already imported are skipped. There is no batch undo; entries are corrected one at a time.`,
      confirmLabel: 'Import entries',
      cancelLabel: 'Not yet',
    });
    if (!ok) return;
    await run(async () => {
      apply(await historicalImportService.commitAdmin(importId));
      toast.success('Administrative hours imported');
    }, 'Could not import the administrative hours');
  };

  const moveRule = (index: number, by: number) => {
    const rules = [...settings.flag_categories];
    const target = index + by;
    const moving = rules[index];
    const other = rules[target];
    if (!moving || !other) return;
    rules[index] = other;
    rules[target] = moving;
    setSettings({ ...settings, flag_categories: rules });
  };

  const dirty = preview !== null && JSON.stringify(settings) !== JSON.stringify(preview.settings);
  const unresolved = preview?.members.filter((m) => m.status !== 'create') ?? [];
  const categoryName = (id?: string | null) => preview?.categories.find((c) => c.id === id)?.name ?? 'No category';

  return (
    <section className="card space-y-4 p-4 sm:p-6" aria-labelledby="historical-admin-heading">
      <div className="split-row gap-3 sm:items-start">
        <div className="split-row-main">
          <h2 id="historical-admin-heading" className="text-theme-text-primary text-lg font-semibold">
            4. Administrative hours
          </h2>
          <p className="text-theme-text-secondary mt-1 text-sm">
            Imported as approved Admin Hours entries in one step. Choose each row's category and settle who each member
            is first.
          </p>
        </div>
        {!opened && (
          <button
            type="button"
            className="split-row-aside btn-secondary"
            disabled={adminColumns.length === 0}
            onClick={() => setOpened(true)}
          >
            Set up administrative hours
          </button>
        )}
      </div>

      {opened && !preview && <p className="text-theme-text-secondary text-sm">Reading the file…</p>}

      {preview && (
        <>
          {preview.result && (
            <p role="status" className="alert-success text-sm">
              Imported {formatNumber(preview.result.entries_created ?? 0)} entries
              {preview.result.members_created ? ` and ${preview.result.members_created} former members` : ''}.
            </p>
          )}

          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              saveSettings();
            }}
          >
            <fieldset disabled={busy} className="space-y-4">
              <div>
                <h3 className="text-theme-text-primary mb-2 font-semibold">Category by hours column</h3>
                <div className="field-grid gap-4">
                  {adminColumns.map((column) => {
                    const id = `admin-default-${column}`;
                    return (
                      <div key={column}>
                        <label htmlFor={id} className="form-label">
                          {column}
                        </label>
                        <select
                          id={id}
                          className="form-input"
                          value={settings.default_categories[column] ?? ''}
                          onChange={(e) => {
                            const next = { ...settings.default_categories };
                            if (e.target.value) next[column] = e.target.value;
                            else delete next[column];
                            setSettings({ ...settings, default_categories: next });
                          }}
                        >
                          <option value="">Choose…</option>
                          {preview.categories.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <h3 className="text-theme-text-primary mb-1 font-semibold">Category by flag</h3>
                <p className="text-theme-text-secondary mb-2 text-sm">
                  A row whose flag column is set takes that category instead. The first set flag in this list wins
                  {preview.flag_conflicts > 0
                    ? ` — ${formatNumber(preview.flag_conflicts)} rows have more than one set, so the order matters`
                    : ''}
                  .
                </p>
                <ul className="space-y-2">
                  {settings.flag_categories.map((rule, index) => (
                    <li key={`${rule.column}-${index}`} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <label className="sr-only" htmlFor={`admin-flag-column-${index}`}>
                        Flag column {index + 1}
                      </label>
                      <select
                        id={`admin-flag-column-${index}`}
                        className="form-input sm:flex-1"
                        value={rule.column}
                        onChange={(e) => {
                          const rules = [...settings.flag_categories];
                          rules[index] = { ...rule, column: e.target.value };
                          setSettings({ ...settings, flag_categories: rules });
                        }}
                      >
                        {freeColumns.map((column) => (
                          <option key={column} value={column}>
                            {column}
                          </option>
                        ))}
                      </select>
                      <label className="sr-only" htmlFor={`admin-flag-category-${index}`}>
                        Category for flag {index + 1}
                      </label>
                      <select
                        id={`admin-flag-category-${index}`}
                        className="form-input sm:flex-1"
                        value={rule.category_id}
                        onChange={(e) => {
                          const rules = [...settings.flag_categories];
                          rules[index] = { ...rule, category_id: e.target.value };
                          setSettings({ ...settings, flag_categories: rules });
                        }}
                      >
                        <option value="">Choose…</option>
                        {preview.categories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </select>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className="btn-icon text-theme-text-secondary"
                          aria-label={`Move ${rule.column} up`}
                          disabled={index === 0}
                          onClick={() => moveRule(index, -1)}
                        >
                          <ArrowUp className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="btn-icon text-theme-text-secondary"
                          aria-label={`Move ${rule.column} down`}
                          disabled={index === settings.flag_categories.length - 1}
                          onClick={() => moveRule(index, 1)}
                        >
                          <ArrowDown className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="btn-icon text-theme-text-secondary"
                          aria-label={`Remove the ${rule.column} rule`}
                          onClick={() =>
                            setSettings({
                              ...settings,
                              flag_categories: settings.flag_categories.filter((_, i) => i !== index),
                            })
                          }
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="btn-secondary mt-2 inline-flex items-center gap-2"
                  disabled={freeColumns.length === 0}
                  onClick={() =>
                    setSettings({
                      ...settings,
                      flag_categories: [...settings.flag_categories, { column: freeColumns[0] ?? '', category_id: '' }],
                    })
                  }
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add a flag rule
                </button>
              </div>

              <div>
                <h3 className="text-theme-text-primary mb-1 font-semibold">Description</h3>
                <p className="text-theme-text-secondary mb-2 text-sm">
                  The first of these columns with text in it becomes the entry's description.
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {freeColumns.map((column) => (
                    <label key={column} className="text-theme-text-primary flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="form-checkbox"
                        checked={settings.description_columns.includes(column)}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            description_columns: e.target.checked
                              ? [...settings.description_columns, column]
                              : settings.description_columns.filter((c) => c !== column),
                          })
                        }
                      />
                      {column}
                    </label>
                  ))}
                </div>
              </div>
            </fieldset>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div>
                  <label htmlFor="admin-new-category" className="form-label">
                    New Admin Hours category
                  </label>
                  <input
                    id="admin-new-category"
                    className="form-input"
                    maxLength={200}
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    placeholder="e.g. SantaMobile"
                  />
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy || !newCategory.trim()}
                  onClick={createCategory}
                >
                  Create category
                </button>
              </div>
              <button type="submit" className="btn-primary" disabled={busy || !dirty}>
                Save rules
              </button>
            </div>
          </form>

          <div>
            <h3 className="text-theme-text-primary mb-1 font-semibold">What would be imported</h3>
            <p className="text-theme-text-secondary mb-2 text-sm">
              {formatNumber(preview.pending_records)} entries to import
              {preview.already_imported ? `, ${formatNumber(preview.already_imported)} already imported` : ''}.
            </p>
            <ul className="text-theme-text-secondary space-y-1 text-sm">
              {preview.by_category.map((bucket) => (
                <li key={bucket.category_id ?? 'none'}>
                  <span className="text-theme-text-primary font-medium">{categoryName(bucket.category_id)}</span>:{' '}
                  {formatNumber(bucket.records)} entries, {formatNumber(bucket.hours)} hours
                </li>
              ))}
            </ul>
            {preview.problem_count > 0 && (
              <ul className="alert-warning mt-2 list-disc pl-5 text-sm">
                {preview.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            )}
          </div>

          {preview.members.length > 0 && (
            <div>
              <div className="split-row gap-3 sm:items-center">
                <h3 className="split-row-main text-theme-text-primary font-semibold">
                  Members ({unresolved.length} to decide)
                </h3>
                {unresolved.some((m) => m.status === 'unmatched') && (
                  <button
                    type="button"
                    className="split-row-aside btn-secondary"
                    disabled={busy}
                    onClick={() =>
                      decideMembers(
                        Object.fromEntries(
                          unresolved.filter((m) => m.status === 'unmatched').map((m) => [m.key, { action: 'create' }])
                        )
                      )
                    }
                  >
                    Create all unmatched as archived
                  </button>
                )}
              </div>
              <ul className="divide-theme-surface-border mt-2 divide-y">
                {preview.members.map((member) => {
                  const id = `admin-member-${member.key}`;
                  return (
                    <li key={member.key} className="split-row gap-3 py-2 sm:items-center">
                      <div className="split-row-main text-sm">
                        <span className="text-theme-text-primary font-medium">
                          {member.display_name || `#${member.membership_number}`}
                        </span>
                        <span className="text-theme-text-secondary">
                          {' '}
                          · {member.row_count} rows
                          {member.reason ? ` · ${member.reason}` : ''}
                          {member.status === 'create'
                            ? ` · will be created as ${
                                [member.new_first_name, member.new_last_name].filter(Boolean).join(' ') ||
                                `Former member ${member.membership_number}`
                              }`
                            : ''}
                        </span>
                      </div>
                      <div className="split-row-aside sm:w-80">
                        <label htmlFor={id} className="sr-only">
                          Who is {member.display_name || member.membership_number}?
                        </label>
                        <select
                          id={id}
                          className="form-input"
                          disabled={busy}
                          value={member.status === 'create' ? CREATE : ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            decideMembers({
                              [member.key]: !value
                                ? null
                                : value === CREATE
                                  ? { action: 'create' }
                                  : { action: 'map', user_id: value },
                            });
                          }}
                        >
                          <option value="">Choose…</option>
                          <option value={CREATE}>Create as an archived former member</option>
                          <optgroup label="Map to an existing member">
                            {preview.member_options.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.name}
                                {option.membership_number ? ` (#${option.membership_number})` : ''}
                              </option>
                            ))}
                          </optgroup>
                        </select>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              className="btn-primary"
              disabled={busy || dirty || !preview.can_commit}
              onClick={() => void commit()}
            >
              Import administrative hours
            </button>
          </div>
        </>
      )}
    </section>
  );
};

export default AdminHoursSection;
