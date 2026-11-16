/**
 * Curriculum → Course Links: training records that name no library course,
 * linked to one by their name.
 *
 * Compliance credits a course or certification requirement only through a
 * record's course link, so a record entered with a free-text name, or imported
 * from a file whose name matched no course, counts toward nothing that names a
 * course. Each row is one name (its spellings grouped), with the library course
 * the server suggests. Nothing is linked until the officer says so; linking
 * sets the course, its category and its training type on every unlinked record
 * carrying the name.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { EmptyState, Pagination } from '../../components/ux';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useTimezone } from '../../hooks/useTimezone';
import { trainingService } from '../../services/api';
import type { CourseLinkName, CourseLinksView } from '../../types/training';
import { formatDate, formatNumber } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';

const PAGE_SIZE = 25;
const SEARCH_DELAY_MS = 300;

const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

const CourseLinksPanel: React.FC = () => {
  const { confirm } = useConfirm();
  const tz = useTimezone();
  const [view, setView] = useState<CourseLinksView | null>(null);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  // The course chosen in each row's picker, by name key, before Link is pressed.
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (target: number, query: string) => {
    try {
      setView(
        await trainingService.getCourseLinks({
          search: query || undefined,
          offset: (target - 1) * PAGE_SIZE,
          limit: PAGE_SIZE,
        })
      );
      setLoadError(null);
    } catch (err: unknown) {
      setLoadError(getErrorMessage(err, 'Could not read the unlinked course names'));
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  useEffect(() => {
    void load(page, search);
  }, [load, page, search]);

  const courseFor = (name: CourseLinkName) => chosen[name.key] ?? name.suggested_course?.id ?? '';

  const link = async (name: CourseLinkName) => {
    const courseId = courseFor(name);
    const course = view?.courses.find((c) => c.id === courseId);
    if (!course) return;
    const ok = await confirm({
      title: `Link “${name.label}” to ${course.name}?`,
      message: `${plural(name.records, 'record', 'records')} for ${plural(
        name.members,
        'member',
        'members'
      )} take this course, its category and its training type, and count toward the requirements that name it. Each keeps its own name, date and hours.`,
      confirmLabel: 'Link records',
      cancelLabel: 'Not yet',
      variant: 'info',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await trainingService.linkCourseName(name.key, course.id);
      toast.success(`${plural(result.records, 'record', 'records')} linked to ${course.name}`);
      await load(page, search);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not link those records'));
    } finally {
      setBusy(false);
    }
  };

  const linkSuggested = async () => {
    if (!view) return;
    const ok = await confirm({
      title: 'Link every suggested course?',
      message: `${plural(view.suggested_names, 'name', 'names')} (${plural(
        view.suggested_records,
        'record',
        'records'
      )}) are linked to the course suggested for each. Check the suggestions first: a link is not undone from here.`,
      confirmLabel: 'Link all suggested',
      cancelLabel: 'Not yet',
      variant: 'info',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await trainingService.linkSuggestedCourseNames();
      toast.success(`${plural(result.names, 'name', 'names')} linked (${plural(result.records, 'record', 'records')})`);
      setPage(1);
      await load(1, search);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not link the suggested courses'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 py-6">
      <div className="split-row gap-3 sm:items-start">
        <div className="split-row-main">
          <h2 className="text-theme-text-primary text-lg font-semibold">Course Links</h2>
          <p className="text-theme-text-secondary mt-1 text-sm">
            Training records that name no library course count toward no course or certification requirement. Link each
            name to the course it is, and every record carrying it counts from then on.
          </p>
        </div>
        {view && view.suggested_names > 0 && (
          <button
            type="button"
            className="split-row-aside btn-secondary"
            disabled={busy}
            onClick={() => void linkSuggested()}
          >
            Link all suggested ({formatNumber(view.suggested_names)})
          </button>
        )}
      </div>

      <div>
        <label htmlFor="course-links-search" className="form-label">
          Search names
        </label>
        <input
          id="course-links-search"
          type="search"
          className="form-input sm:max-w-sm"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Course name"
        />
      </div>

      {loadError && (
        <p role="alert" className="alert-error text-sm">
          {loadError}
        </p>
      )}

      {!view && !loadError && <p className="text-theme-text-secondary text-sm">Reading the course names…</p>}

      {view && view.items.length === 0 && (
        <EmptyState
          title={search ? 'No names match that search' : 'Every training record names a library course'}
          description={search ? 'Try another part of the name.' : 'There is nothing to link.'}
        />
      )}

      {view && view.items.length > 0 && (
        <>
          <p className="text-theme-text-secondary text-sm">
            {plural(view.total, 'name', 'names')} {search ? 'match' : 'to link'}, most records first.
          </p>
          <ul className="divide-theme-surface-border card divide-y">
            {view.items.map((name) => {
              const id = `course-link-${name.key}`;
              const courseId = courseFor(name);
              const others = name.spellings.filter((s) => s.name !== name.label);
              return (
                <li key={name.key} className="split-row gap-3 p-4 sm:items-center">
                  <div className="split-row-main min-w-0 text-sm">
                    <p className="text-theme-text-primary font-medium break-words">{name.label}</p>
                    <p className="text-theme-text-secondary">
                      {plural(name.records, 'record', 'records')} · {plural(name.members, 'member', 'members')}
                      {name.first_date && name.last_date
                        ? ` · ${formatDate(name.first_date, tz)} to ${formatDate(name.last_date, tz)}`
                        : ''}
                    </p>
                    {others.length > 0 && (
                      <p className="text-theme-text-muted text-xs break-words">
                        Also spelled {others.map((s) => s.name).join(', ')}
                      </p>
                    )}
                    {name.suggested_course && (
                      <p className="text-theme-text-muted text-xs">Suggested: {name.suggested_course.name}</p>
                    )}
                  </div>
                  <div className="split-row-aside flex flex-col gap-2 sm:w-96 sm:flex-row sm:items-center">
                    <label htmlFor={id} className="sr-only">
                      Library course for {name.label}
                    </label>
                    <select
                      id={id}
                      className="form-input"
                      value={courseId}
                      disabled={busy}
                      onChange={(e) => setChosen((prev) => ({ ...prev, [name.key]: e.target.value }))}
                    >
                      <option value="">Choose a course…</option>
                      {view.courses.map((course) => (
                        <option key={course.id} value={course.id}>
                          {course.name}
                          {course.code ? ` (${course.code})` : ''}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn-primary shrink-0"
                      disabled={busy || !courseId}
                      aria-label={`Link ${name.label}`}
                      onClick={() => void link(name)}
                    >
                      Link
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {view.total > PAGE_SIZE && (
            <Pagination currentPage={page} totalItems={view.total} pageSize={PAGE_SIZE} onPageChange={setPage} />
          )}
        </>
      )}
    </div>
  );
};

export default CourseLinksPanel;
