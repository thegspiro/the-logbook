/**
 * Historical Data Import — training.
 *
 * Training rows become completed training records in one commit. What needs
 * deciding is how they are read:
 * - which columns give the subject, the instructor, and whether the member
 *   taught the class
 * - which subjects map to a library course. A mapped subject takes the
 *   course's name, type and category, exactly as a provider record mapped to
 *   that course would; every other subject is imported as written.
 * - what to do with rows whose instructor names a training provider the
 *   department already syncs. A row a synced record covers is left out
 *   automatically; one no synced record matches waits for a decision, so it is
 *   neither dropped nor doubled silently.
 * - who each member is that nothing matched.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Pagination } from '../../../components/ux';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { historicalImportService } from '../../../modules/integrations/services/historicalImportApi';
import type {
  AdminMemberMapping,
  HistoricalImportDetail,
  TrainingPreview,
  TrainingSettingsUpdate,
} from '../../../modules/integrations/types/historicalImport';
import { formatNumber } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import MembersToDecide from './MembersToDecide';

interface TrainingSectionProps {
  detail: HistoricalImportDetail;
}

const PAGE_SIZE = 25;
const AS_WRITTEN = '';

const TrainingSection: React.FC<TrainingSectionProps> = ({ detail }) => {
  const { confirm } = useConfirm();
  const importId = detail.import.id;
  const [opened, setOpened] = useState(false);
  const [preview, setPreview] = useState<TrainingPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [page, setPage] = useState(1);

  const hasTrainingColumn = Object.values(detail.hour_columns).includes('training');

  const load = useCallback(
    async (searchText: string, pageNumber: number) => {
      setBusy(true);
      try {
        setPreview(
          await historicalImportService.getTrainingPreview(importId, {
            search: searchText,
            offset: (pageNumber - 1) * PAGE_SIZE,
            limit: PAGE_SIZE,
          })
        );
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Could not prepare the training rows'));
      } finally {
        setBusy(false);
      }
    },
    [importId]
  );

  useEffect(() => {
    if (opened) void load(appliedSearch, page);
  }, [opened, load, appliedSearch, page]);

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

  // Every settings change answers with a fresh preview, but always of the
  // first page, so it is re-read here for the page being viewed.
  const save = (payload: TrainingSettingsUpdate) =>
    void run(async () => {
      await historicalImportService.updateTrainingSettings(importId, payload);
      setPreview(
        await historicalImportService.getTrainingPreview(importId, {
          search: appliedSearch,
          offset: (page - 1) * PAGE_SIZE,
          limit: PAGE_SIZE,
        })
      );
    }, 'Could not save that change');

  const acceptSuggestions = () =>
    void run(async () => {
      const mapped = await historicalImportService.acceptSuggestedCourses(importId);
      toast.success(`${formatNumber(mapped)} ${mapped === 1 ? 'subject' : 'subjects'} mapped to suggested courses`);
      await load(appliedSearch, page);
    }, 'Could not accept the suggestions');

  const decideMembers = (members: Record<string, AdminMemberMapping | null>) =>
    void run(async () => {
      await historicalImportService.updateMembers(importId, members);
      await load(appliedSearch, page);
    }, 'Could not save that decision');

  const commit = async () => {
    if (!preview) return;
    const creating = preview.members.filter((m) => m.status === 'create').length;
    const ok = await confirm({
      title: 'Import the training records?',
      message: `This writes ${formatNumber(preview.pending_records)} completed training records${
        creating ? ` and creates ${creating} archived former-member records` : ''
      }. ${formatNumber(preview.provider_matched)} rows a provider sync already recorded are left out. There is no batch undo; records are corrected one at a time.`,
      confirmLabel: 'Import records',
      cancelLabel: 'Not yet',
    });
    if (!ok) return;
    await run(async () => {
      setPreview(await historicalImportService.commitTraining(importId));
      toast.success('Training records imported');
    }, 'Could not import the training records');
  };

  const courseName = useMemo(() => {
    const names = new Map((preview?.courses ?? []).map((c) => [c.id, c.name]));
    return (id?: string | null) => (id ? (names.get(id) ?? '') : '');
  }, [preview?.courses]);

  const columnSelect = (key: 'subject_column' | 'instructor_column' | 'taught_column', label: string, hint: string) => {
    const id = `training-${key}`;
    return (
      <div>
        <label htmlFor={id} className="form-label">
          {label}
        </label>
        <select
          id={id}
          className="form-input"
          value={preview?.settings[key] ?? ''}
          disabled={busy}
          onChange={(e) => save({ [key]: e.target.value })}
        >
          <option value="">Not in this file</option>
          {(preview?.headers ?? []).map((header) => (
            <option key={header} value={header}>
              {header}
            </option>
          ))}
        </select>
        <p className="text-theme-text-secondary mt-1 text-xs">{hint}</p>
      </div>
    );
  };

  return (
    <section className="card space-y-4 p-4 sm:p-6" aria-labelledby="historical-training-heading">
      <div className="split-row gap-3 sm:items-start">
        <div className="split-row-main">
          <h2 id="historical-training-heading" className="text-theme-text-primary text-lg font-semibold">
            5. Training
          </h2>
          <p className="text-theme-text-secondary mt-1 text-sm">
            Imported as completed training records in one step. Map the subjects you want counted against a course; the
            rest come in as written, as continuing education.
          </p>
        </div>
        {!opened && (
          <button
            type="button"
            className="split-row-aside btn-secondary"
            disabled={!hasTrainingColumn}
            onClick={() => setOpened(true)}
          >
            Set up training
          </button>
        )}
      </div>

      {opened && !preview && <p className="text-theme-text-secondary text-sm">Reading the file…</p>}

      {preview && (
        <>
          {preview.result && (
            <p role="status" className="alert-success text-sm">
              Imported {formatNumber(preview.result.records_created ?? 0)} training records
              {preview.result.members_created ? ` and ${preview.result.members_created} former members` : ''}.
            </p>
          )}

          <div className="field-grid gap-4">
            {columnSelect('subject_column', 'Subject', 'What the class was; becomes the course name unless mapped.')}
            {columnSelect('instructor_column', 'Instructor', 'Who taught it, as the file names them.')}
            {columnSelect(
              'taught_column',
              'Taught the class',
              'A yes/no column. Where it is set and the instructor says “me”, the record names the member.'
            )}
          </div>

          {preview.provider_rows > 0 && (
            <fieldset className="space-y-2" disabled={busy}>
              <legend className="text-theme-text-primary font-semibold">Training provider rows</legend>
              <p className="text-theme-text-secondary text-sm">
                {formatNumber(preview.provider_rows)} rows name a training provider (
                {preview.settings.provider_patterns.join(', ')}). {formatNumber(preview.provider_matched)} match a
                record the provider sync already brought in, within a day, and are left out.{' '}
                {formatNumber(preview.provider_unmatched)} match nothing synced.
              </p>
              {preview.provider_unmatched > 0 && (
                <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
                  <label className="text-theme-text-primary flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="unmatched-provider"
                      checked={preview.settings.unmatched_provider_action === 'import'}
                      onChange={() => save({ unmatched_provider_action: 'import' })}
                    />
                    Import them as ordinary training records
                  </label>
                  <label className="text-theme-text-primary flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="unmatched-provider"
                      checked={preview.settings.unmatched_provider_action === 'skip'}
                      onChange={() => save({ unmatched_provider_action: 'skip' })}
                    />
                    Leave them out — the sync is the record
                  </label>
                </div>
              )}
            </fieldset>
          )}

          <div>
            <div className="split-row gap-3 sm:items-end">
              <div className="split-row-main">
                <h3 className="text-theme-text-primary font-semibold">Subjects</h3>
                <p className="text-theme-text-secondary text-sm">
                  {formatNumber(preview.subject_count)} subjects; {formatNumber(preview.subjects_mapped)} mapped,
                  covering {formatNumber(preview.records_mapped)} records.
                </p>
              </div>
              <div className="split-row-aside flex flex-wrap items-end gap-2">
                <form
                  className="flex items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setPage(1);
                    setAppliedSearch(search.trim());
                  }}
                >
                  <div>
                    <label htmlFor="training-subject-search" className="form-label">
                      Find a subject
                    </label>
                    <input
                      id="training-subject-search"
                      className="form-input"
                      value={search}
                      maxLength={200}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <button type="submit" className="btn-secondary" disabled={busy}>
                    Search
                  </button>
                </form>
                <button type="button" className="btn-secondary" disabled={busy} onClick={acceptSuggestions}>
                  Accept all suggestions
                </button>
              </div>
            </div>
            <ul className="divide-theme-surface-border mt-2 divide-y">
              {preview.subjects.map((subject) => {
                const id = `training-subject-${subject.key}`;
                return (
                  <li key={subject.key} className="split-row gap-3 py-2 sm:items-center">
                    <div className="split-row-main text-sm">
                      <span className="text-theme-text-primary font-medium break-words">{subject.subject || '—'}</span>
                      <span className="text-theme-text-secondary">
                        {' '}
                        · {formatNumber(subject.records)} records · {formatNumber(subject.hours)} hrs
                      </span>
                      {subject.suggested_course_id && !subject.course_id && (
                        <button
                          type="button"
                          className="text-theme-text-primary ml-2 text-sm font-medium underline"
                          disabled={busy}
                          onClick={() =>
                            save({ subject_courses: { [subject.key]: subject.suggested_course_id ?? null } })
                          }
                        >
                          Use {courseName(subject.suggested_course_id)}
                        </button>
                      )}
                    </div>
                    <div className="split-row-aside sm:w-80">
                      <label htmlFor={id} className="sr-only">
                        Course for {subject.subject}
                      </label>
                      <select
                        id={id}
                        className="form-input"
                        disabled={busy}
                        value={subject.course_id ?? AS_WRITTEN}
                        onChange={(e) => save({ subject_courses: { [subject.key]: e.target.value || null } })}
                      >
                        <option value={AS_WRITTEN}>Import as written</option>
                        {preview.courses.map((course) => (
                          <option key={course.id} value={course.id}>
                            {course.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </li>
                );
              })}
            </ul>
            {preview.subject_total > PAGE_SIZE && (
              <Pagination
                currentPage={page}
                totalItems={preview.subject_total}
                pageSize={PAGE_SIZE}
                onPageChange={setPage}
              />
            )}
          </div>

          {preview.problem_count > 0 && (
            <ul className="alert-warning list-disc pl-5 text-sm">
              {preview.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}

          <MembersToDecide
            members={preview.members}
            options={preview.member_options}
            busy={busy}
            idPrefix="training"
            onDecide={decideMembers}
          />

          <div className="flex items-center justify-end gap-3">
            <span className="text-theme-text-secondary text-sm">
              {formatNumber(preview.pending_records)} records to import
              {preview.already_imported ? `, ${formatNumber(preview.already_imported)} already imported` : ''}
            </span>
            <button
              type="button"
              className="btn-primary"
              disabled={busy || !preview.can_commit}
              onClick={() => void commit()}
            >
              Import training records
            </button>
          </div>
        </>
      )}
    </section>
  );
};

export default TrainingSection;
