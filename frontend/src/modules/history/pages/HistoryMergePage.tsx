/**
 * Merging another record of the same person into this one.
 *
 * The server says which fields differ, which fill in by themselves, and
 * whether this pair can be merged at all; this screen collects a choice for
 * each difference and shows the rest as the server reports it.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ArrowLeftRight, GitMerge, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { Breadcrumbs } from '../../../components/ux/Breadcrumbs';
import { SkeletonPage } from '../../../components/ux/Skeleton';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { getErrorMessage } from '../../../utils/errorHandling';
import { historyService } from '../services/api';
import {
  PUBLICATION_LEVEL_LABELS,
  type HistoricalMemberSummary,
  type HistoricalMemberView,
  type MergeChoice,
  type MergePreview,
  type MergeSide,
} from '../types';

const SideCard: React.FC<{ side: MergeSide; heading: string }> = ({ side, heading }) => (
  <div className="card-secondary p-3">
    <p className="text-theme-text-secondary text-xs font-semibold tracking-wide uppercase">{heading}</p>
    <p className="text-theme-text-primary font-medium">{side.display_name}</p>
    <p className="text-theme-text-secondary text-sm">
      {[
        side.service_years,
        PUBLICATION_LEVEL_LABELS[side.publication_level],
        `${side.period_count} service period${side.period_count === 1 ? '' : 's'}`,
        `${side.relation_count} family link${side.relation_count === 1 ? '' : 's'}`,
        side.linked_member_name && `Linked to ${side.linked_member_name}`,
      ]
        .filter(Boolean)
        .join(' · ')}
    </p>
  </div>
);

export const HistoryMergePage: React.FC = () => {
  const { personId = '' } = useParams<{ personId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const [person, setPerson] = useState<HistoricalMemberView | null>(null);
  const [otherId, setOtherId] = useState(searchParams.get('other') ?? '');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<HistoricalMemberSummary[]>([]);
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [choices, setChoices] = useState<Record<string, MergeChoice>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    historyService
      .getPerson(personId)
      .then(setPerson)
      .catch((err: unknown) => setError(getErrorMessage(err, 'Unable to load this person.')));
  }, [personId]);

  useEffect(() => {
    setOtherId(searchParams.get('other') ?? '');
  }, [searchParams]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      historyService
        .listPeople({ search: query.trim(), limit: 10 })
        .then((list) => {
          if (!cancelled) setResults(list.items.filter((p) => p.id !== personId));
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, personId]);

  useEffect(() => {
    if (!otherId) {
      setPreview(null);
      return;
    }
    setChoices({});
    historyService
      .mergePreview(personId, otherId)
      .then((data) => {
        setPreview(data);
        setError(null);
      })
      .catch((err: unknown) => setError(getErrorMessage(err, 'Unable to compare these records.')));
  }, [personId, otherId]);

  const differing = useMemo(() => (preview?.fields ?? []).filter((f) => f.state === 'differs'), [preview]);
  const filling = useMemo(() => (preview?.fields ?? []).filter((f) => f.state === 'keep_blank'), [preview]);
  const unanswered = differing.filter((f) => !choices[f.field]);

  const merge = async () => {
    if (!preview) return;
    const ok = await confirm({
      title: 'Merge these records',
      message: `${preview.other.display_name} is merged into ${preview.keep.display_name} and removed. Its service periods, family links and change history move across, and its address forwards to the kept record. This cannot be undone.`,
      confirmLabel: 'Merge',
      cancelLabel: 'Keep both',
      variant: 'warning',
    });
    if (!ok) return;
    setSaving(true);
    try {
      await historyService.mergePerson(personId, otherId, choices);
      toast.success('Records merged');
      void navigate(`/history/people/${personId}`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not merge these records.'));
    } finally {
      setSaving(false);
    }
  };

  if (error && !person) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <div role="alert" className="alert-danger rounded-md p-3 text-sm">
          {error}
        </div>
      </div>
    );
  }
  if (!person) return <SkeletonPage />;

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <Breadcrumbs
        items={[
          { label: 'History', path: '/history' },
          { label: 'Past members', path: '/history/people' },
          { label: person.display_name, path: `/history/people/${personId}` },
          { label: 'Merge' },
        ]}
      />
      <h1 className="text-theme-text-primary mb-1 flex items-center gap-2 text-2xl font-bold">
        <GitMerge className="h-6 w-6 shrink-0" aria-hidden="true" />
        Merge into {person.display_name}
      </h1>
      <p className="text-theme-text-secondary mb-4 text-sm">
        When the same person was entered twice, merge the second record into this one. This record is kept; the other is
        removed.
      </p>

      <section className="card mb-4 p-4" aria-labelledby="merge-pick-heading">
        <h2 id="merge-pick-heading" className="text-theme-text-primary mb-2 text-lg font-semibold">
          The other record
        </h2>
        <label className="relative block">
          <span className="form-label">Find it by name or badge number</span>
          <Search
            className="text-theme-text-muted pointer-events-none absolute bottom-3 left-3 h-4 w-4"
            aria-hidden="true"
          />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} className="form-input pl-9" />
        </label>
        {results.length > 0 && (
          <ul className="mt-2 space-y-1">
            {results.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    setOtherId(p.id);
                    setQuery('');
                    setResults([]);
                  }}
                  className="touch-target-phone text-theme-text-primary text-left text-sm underline"
                >
                  {p.display_name}
                  {p.service_years && <> ({p.service_years})</>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {error && (
        <div role="alert" className="alert-danger mb-4 rounded-md p-3 text-sm">
          {error}
        </div>
      )}

      {preview && (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <SideCard side={preview.keep} heading="Kept" />
            <SideCard side={preview.other} heading="Merged in and removed" />
          </div>
          <Link
            to={`/history/people/${preview.other.id}/merge?other=${preview.keep.id}`}
            className="touch-target-phone text-theme-text-primary mb-4 inline-flex items-center gap-1 text-sm underline"
          >
            <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
            Keep {preview.other.display_name} instead
          </Link>

          {preview.refusal ? (
            <div role="alert" className="alert-danger rounded-md p-3 text-sm">
              {preview.refusal}
            </div>
          ) : (
            <>
              {preview.warnings.map((w) => (
                <div key={w} className="alert-warning mb-3 rounded-md p-3 text-sm">
                  {w}
                </div>
              ))}

              {differing.length > 0 && (
                <fieldset className="card mb-4 p-4">
                  <legend className="text-theme-text-primary px-1 text-lg font-semibold">Choose what to keep</legend>
                  <div className="space-y-4">
                    {differing.map((f) => (
                      <div key={f.field} role="radiogroup" aria-label={f.label}>
                        <p className="text-theme-text-primary mb-1 text-sm font-medium">{f.label}</p>
                        <div className="grid gap-1">
                          {(
                            [
                              ['keep', f.keep_value],
                              ['other', f.other_value],
                              ...(f.can_keep_both ? [['both', 'Keep both, one after the other']] : []),
                            ] as [MergeChoice, string | null][]
                          ).map(([choice, text]) => (
                            <label key={choice} className="touch-target-phone flex items-start gap-2 text-sm">
                              <input
                                type="radio"
                                name={`merge-${f.field}`}
                                className="mt-1"
                                checked={choices[f.field] === choice}
                                onChange={() => setChoices((prev) => ({ ...prev, [f.field]: choice }))}
                              />
                              <span className="text-theme-text-primary line-clamp-3 break-words whitespace-pre-line">
                                {text}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </fieldset>
              )}

              {filling.length > 0 && (
                <div className="card mb-4 p-4">
                  <p className="text-theme-text-primary mb-1 text-sm font-medium">Filled in from the other record</p>
                  <ul className="text-theme-text-secondary list-inside list-disc text-sm">
                    {filling.map((f) => (
                      <li key={f.field}>
                        {f.label}: {f.other_value}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <button
                type="button"
                onClick={() => void merge()}
                disabled={saving || unanswered.length > 0}
                className="btn-primary rounded-md px-4 py-2 text-sm font-medium"
              >
                {unanswered.length > 0
                  ? `Choose ${unanswered.length} more value${unanswered.length === 1 ? '' : 's'}`
                  : 'Merge records'}
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
};

export default HistoryMergePage;
