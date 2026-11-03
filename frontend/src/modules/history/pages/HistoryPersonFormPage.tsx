/**
 * Add or edit a person's core record. Service periods and family links are
 * edited on the person's page.
 *
 * Create omits blank fields; update sends an explicit null for each cleared
 * field so the clear persists (CLAUDE.md pitfall #1). Warnings about reused
 * badge numbers and possible duplicates are shown, never enforced.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { AlertTriangle, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { Breadcrumbs } from '../../../components/ux/Breadcrumbs';
import { SkeletonPage } from '../../../components/ux/Skeleton';
import { userService } from '../../../services/userServices';
import { blankToNull } from '../../../utils/formValues';
import { getErrorMessage } from '../../../utils/errorHandling';
import { historyService } from '../services/api';
import { ArchiveHtml } from '../components/ArchiveHtml';
import { EditKindChoice } from '../components/EditKindChoice';
import { PartialDateInput } from '../components/PartialDateInput';
import {
  FIELD_VISIBILITY_LABELS,
  type DatePrecision,
  type EditKind,
  type FieldVisibility,
  type HistoricalMemberFullView,
  type PersonWarning,
} from '../types';

interface FormState {
  first_name: string;
  middle_name: string;
  last_name: string;
  suffix: string;
  nickname: string;
  badge_number: string;
  birth_date: string | null;
  birth_date_precision: DatePrecision;
  birth_date_circa: boolean;
  biography: string;
  addresses: string;
  verification_sources: string;
  research_notes: string;
  is_memorial: boolean;
  is_line_of_duty_death: boolean;
  death_date: string | null;
  death_date_precision: DatePrecision;
  death_date_circa: boolean;
  death_date_visibility: FieldVisibility;
  death_circumstances: string;
  death_circumstances_visibility: FieldVisibility;
  burial_location: string;
  burial_location_visibility: FieldVisibility;
}

const EMPTY: FormState = {
  first_name: '',
  middle_name: '',
  last_name: '',
  suffix: '',
  nickname: '',
  badge_number: '',
  birth_date: null,
  birth_date_precision: 'day',
  birth_date_circa: false,
  biography: '',
  addresses: '',
  verification_sources: '',
  research_notes: '',
  is_memorial: false,
  is_line_of_duty_death: false,
  death_date: null,
  death_date_precision: 'day',
  death_date_circa: false,
  death_date_visibility: 'historian',
  death_circumstances: '',
  death_circumstances_visibility: 'historian',
  burial_location: '',
  burial_location_visibility: 'historian',
};

const fromPerson = (p: HistoricalMemberFullView): FormState => ({
  first_name: p.first_name ?? '',
  middle_name: p.middle_name ?? '',
  last_name: p.last_name,
  suffix: p.suffix ?? '',
  nickname: p.nickname ?? '',
  badge_number: p.badge_number ?? '',
  birth_date: p.birth_date,
  birth_date_precision: p.birth_date_precision,
  birth_date_circa: p.birth_date_circa,
  biography: p.biography ?? '',
  addresses: p.addresses ?? '',
  verification_sources: p.verification_sources ?? '',
  research_notes: p.research_notes ?? '',
  is_memorial: p.is_memorial,
  is_line_of_duty_death: p.is_line_of_duty_death,
  death_date: p.death_date,
  death_date_precision: p.death_date_precision,
  death_date_circa: p.death_date_circa,
  death_date_visibility: p.death_date_visibility,
  death_circumstances: p.death_circumstances ?? '',
  death_circumstances_visibility: p.death_circumstances_visibility,
  burial_location: p.burial_location ?? '',
  burial_location_visibility: p.burial_location_visibility,
});

const VisibilitySelect: React.FC<{
  label: string;
  value: FieldVisibility;
  onChange: (v: FieldVisibility) => void;
}> = ({ label, value, onChange }) => (
  <label className="block">
    <span className="form-label">{label} shown to</span>
    <select value={value} onChange={(e) => onChange(e.target.value as FieldVisibility)} className="form-input">
      {(Object.keys(FIELD_VISIBILITY_LABELS) as FieldVisibility[]).map((v) => (
        <option key={v} value={v}>
          {FIELD_VISIBILITY_LABELS[v]}
        </option>
      ))}
    </select>
  </label>
);

interface MemberOption {
  id: string;
  name: string;
}

export const HistoryPersonFormPage: React.FC = () => {
  const { personId } = useParams();
  const editing = Boolean(personId);
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [original, setOriginal] = useState<HistoricalMemberFullView | null>(null);
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [warnings, setWarnings] = useState<PersonWarning[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [editKind, setEditKind] = useState<EditKind>('minor');
  const [editNote, setEditNote] = useState('');
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [memberId, setMemberId] = useState('');

  useEffect(() => {
    if (!personId) return;
    let cancelled = false;
    historyService
      .getPerson(personId)
      .then((person) => {
        if (cancelled) return;
        if (person.view !== 'full') {
          toast.error('You cannot edit this record');
          void navigate(`/history/people/${personId}`);
          return;
        }
        setOriginal(person);
        setForm(fromPerson(person));
      })
      .catch((err: unknown) => toast.error(getErrorMessage(err, 'Unable to load this person')))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [personId, navigate]);

  useEffect(() => {
    if (editing) return;
    userService
      .getUsers()
      .then((users) =>
        setMembers(
          users
            .filter((u) => u.last_name)
            .map((u) => ({ id: u.id, name: `${u.last_name ?? ''}, ${u.first_name ?? ''}`.trim() }))
            .sort((a, b) => a.name.localeCompare(b.name))
        )
      )
      .catch(() => setMembers([]));
  }, [editing]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const checkWarnings = async () => {
    if (!form.last_name.trim() && !form.badge_number.trim()) {
      setWarnings([]);
      return;
    }
    try {
      setWarnings(
        await historyService.checkPerson({
          last_name: form.last_name.trim() || undefined,
          first_name: form.first_name.trim() || undefined,
          badge_number: form.badge_number.trim() || undefined,
          exclude_id: personId,
        })
      );
    } catch {
      setWarnings([]);
    }
  };

  const showPreview = async () => {
    try {
      setPreview(await historyService.renderMarkdown(form.biography));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not preview the biography'));
    }
  };

  const startFromMember = async () => {
    if (!memberId) return;
    setSaving(true);
    try {
      const created = await historyService.createFromMember(memberId);
      toast.success('Record started from the member list');
      void navigate(`/history/people/${created.id}/edit`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not start a record from this member'));
    } finally {
      setSaving(false);
    }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.last_name.trim()) {
      toast.error('Enter a last name');
      return;
    }
    setSaving(true);
    try {
      if (editing && personId) {
        const saved = await historyService.updatePerson(personId, {
          first_name: blankToNull(form.first_name),
          middle_name: blankToNull(form.middle_name),
          last_name: form.last_name.trim(),
          suffix: blankToNull(form.suffix),
          nickname: blankToNull(form.nickname),
          badge_number: blankToNull(form.badge_number),
          birth_date: form.birth_date,
          birth_date_precision: form.birth_date_precision,
          birth_date_circa: form.birth_date_circa,
          biography: blankToNull(form.biography),
          addresses: blankToNull(form.addresses),
          verification_sources: blankToNull(form.verification_sources),
          research_notes: blankToNull(form.research_notes),
          is_memorial: form.is_memorial,
          is_line_of_duty_death: form.is_line_of_duty_death,
          death_date: form.death_date,
          death_date_precision: form.death_date_precision,
          death_date_circa: form.death_date_circa,
          death_date_visibility: form.death_date_visibility,
          death_circumstances: blankToNull(form.death_circumstances),
          death_circumstances_visibility: form.death_circumstances_visibility,
          burial_location: blankToNull(form.burial_location),
          burial_location_visibility: form.burial_location_visibility,
          edit_kind: editKind,
          edit_note: editNote.trim() || undefined,
        });
        toast.success('Saved');
        void navigate(`/history/people/${saved.id}`);
      } else {
        const created = await historyService.createPerson({
          first_name: form.first_name.trim() || undefined,
          middle_name: form.middle_name.trim() || undefined,
          last_name: form.last_name.trim(),
          suffix: form.suffix.trim() || undefined,
          nickname: form.nickname.trim() || undefined,
          badge_number: form.badge_number.trim() || undefined,
          birth_date: form.birth_date || undefined,
          birth_date_precision: form.birth_date_precision,
          birth_date_circa: form.birth_date_circa,
          biography: form.biography.trim() || undefined,
          addresses: form.addresses.trim() || undefined,
          verification_sources: form.verification_sources.trim() || undefined,
          research_notes: form.research_notes.trim() || undefined,
          is_memorial: form.is_memorial,
          is_line_of_duty_death: form.is_line_of_duty_death,
          death_date: form.death_date || undefined,
          death_date_precision: form.death_date_precision,
          death_date_circa: form.death_date_circa,
          death_date_visibility: form.death_date_visibility,
          death_circumstances: form.death_circumstances.trim() || undefined,
          death_circumstances_visibility: form.death_circumstances_visibility,
          burial_location: form.burial_location.trim() || undefined,
          burial_location_visibility: form.burial_location_visibility,
        });
        toast.success('Added to the archive as a draft');
        void navigate(`/history/people/${created.id}`);
      }
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save this person'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <SkeletonPage />;

  const title = editing ? `Edit ${original?.display_name ?? 'person'}` : 'Add a person';

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <Breadcrumbs
        items={[
          { label: 'History', path: '/history' },
          { label: 'Past members', path: '/history/people' },
          { label: editing ? 'Edit' : 'Add' },
        ]}
      />
      <h1 className="text-theme-text-primary mb-4 text-2xl font-bold">{title}</h1>

      {!editing && members.length > 0 && (
        <section aria-labelledby="from-member-heading" className="card mb-4 p-4">
          <h2 id="from-member-heading" className="text-theme-text-primary mb-2 font-semibold">
            Start from the member list
          </h2>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1">
              <span className="form-label">Current or former member</span>
              <select value={memberId} onChange={(e) => setMemberId(e.target.value)} className="form-input">
                <option value="">Choose a member</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn-secondary inline-flex items-center gap-2 rounded-md px-3 py-2"
              disabled={!memberId || saving}
              onClick={() => void startFromMember()}
            >
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Start record
            </button>
          </div>
        </section>
      )}

      <form onSubmit={(e) => void save(e)} className="card space-y-6 p-4">
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="text-theme-text-primary mb-2 font-semibold">Name</legend>
          <label>
            <span className="form-label">First name</span>
            <input
              value={form.first_name}
              onChange={(e) => set('first_name', e.target.value)}
              onBlur={() => void checkWarnings()}
              maxLength={100}
              className="form-input"
            />
          </label>
          <label>
            <span className="form-label">Middle name</span>
            <input
              value={form.middle_name}
              onChange={(e) => set('middle_name', e.target.value)}
              maxLength={100}
              className="form-input"
            />
          </label>
          <label>
            <span className="form-label">Last name (required)</span>
            <input
              required
              value={form.last_name}
              onChange={(e) => set('last_name', e.target.value)}
              onBlur={() => void checkWarnings()}
              maxLength={100}
              className="form-input"
            />
          </label>
          <label>
            <span className="form-label">Suffix</span>
            <input
              value={form.suffix}
              onChange={(e) => set('suffix', e.target.value)}
              maxLength={20}
              placeholder="Jr., Sr., III"
              className="form-input"
            />
          </label>
          <label>
            <span className="form-label">Nickname</span>
            <input
              value={form.nickname}
              onChange={(e) => set('nickname', e.target.value)}
              maxLength={100}
              className="form-input"
            />
          </label>
          <label>
            <span className="form-label">Badge number</span>
            <input
              value={form.badge_number}
              onChange={(e) => set('badge_number', e.target.value)}
              onBlur={() => void checkWarnings()}
              maxLength={50}
              className="form-input"
            />
          </label>
        </fieldset>

        {warnings.length > 0 && (
          <div role="status" className="alert-warning rounded-md p-3 text-sm">
            <p className="mb-1 flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              Worth a second look
            </p>
            <ul className="list-disc pl-5">
              {warnings.map((w) => (
                <li key={`${w.kind}-${w.member_id}`}>
                  {w.message}
                  {w.service_years ? ` (${w.service_years})` : ''}
                </li>
              ))}
            </ul>
            <p className="mt-1">You can still save; badge numbers were reissued and names repeat.</p>
          </div>
        )}

        <fieldset className="space-y-3">
          <legend className="text-theme-text-primary mb-2 font-semibold">Biography</legend>
          <label className="block">
            <span className="form-label">Written in Markdown: **bold**, *italic*, # headings, - lists</span>
            <textarea
              value={form.biography}
              onChange={(e) => set('biography', e.target.value)}
              rows={8}
              maxLength={20000}
              className="form-input font-mono"
            />
          </label>
          <button type="button" className="btn-secondary btn-sm rounded-md" onClick={() => void showPreview()}>
            Preview
          </button>
          {preview !== null && (
            <div className="card-secondary rounded-md p-3">
              {preview ? <ArchiveHtml html={preview} /> : <p className="text-sm">Nothing to preview.</p>}
            </div>
          )}
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-theme-text-primary mb-1 font-semibold">Historian only</legend>
          <p className="text-theme-text-secondary text-sm">
            Never shown to members or the public, whatever else is published.
          </p>
          <PartialDateInput
            label="Born"
            value={form.birth_date}
            precision={form.birth_date_precision}
            circa={form.birth_date_circa}
            onChange={(next) =>
              setForm((current) => ({
                ...current,
                birth_date: next.value,
                birth_date_precision: next.precision,
                birth_date_circa: next.circa,
              }))
            }
          />
          <label className="block">
            <span className="form-label">Addresses</span>
            <textarea
              value={form.addresses}
              onChange={(e) => set('addresses', e.target.value)}
              rows={2}
              className="form-input"
            />
          </label>
          <label className="block">
            <span className="form-label">How this was verified</span>
            <textarea
              value={form.verification_sources}
              onChange={(e) => set('verification_sources', e.target.value)}
              rows={2}
              className="form-input"
            />
          </label>
          <label className="block">
            <span className="form-label">Research notes</span>
            <textarea
              value={form.research_notes}
              onChange={(e) => set('research_notes', e.target.value)}
              rows={3}
              className="form-input"
            />
          </label>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-theme-text-primary mb-2 font-semibold">Memorial</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={form.is_memorial}
              onChange={(e) => set('is_memorial', e.target.checked)}
            />
            <span className="text-theme-text-primary">Has a memorial</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={form.is_line_of_duty_death}
              onChange={(e) => {
                set('is_line_of_duty_death', e.target.checked);
                if (e.target.checked) set('is_memorial', true);
              }}
            />
            <span className="text-theme-text-primary">Died in the line of duty (listed on the Honor Roll)</span>
          </label>
          {form.is_memorial && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <PartialDateInput
                  label="Died"
                  value={form.death_date}
                  precision={form.death_date_precision}
                  circa={form.death_date_circa}
                  onChange={(next) =>
                    setForm((current) => ({
                      ...current,
                      death_date: next.value,
                      death_date_precision: next.precision,
                      death_date_circa: next.circa,
                    }))
                  }
                />
                <VisibilitySelect
                  label="Date of death"
                  value={form.death_date_visibility}
                  onChange={(v) => set('death_date_visibility', v)}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="form-label">Circumstances</span>
                  <textarea
                    value={form.death_circumstances}
                    onChange={(e) => set('death_circumstances', e.target.value)}
                    rows={3}
                    className="form-input"
                  />
                </label>
                <VisibilitySelect
                  label="Circumstances"
                  value={form.death_circumstances_visibility}
                  onChange={(v) => set('death_circumstances_visibility', v)}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="form-label">Resting place</span>
                  <textarea
                    value={form.burial_location}
                    onChange={(e) => set('burial_location', e.target.value)}
                    rows={2}
                    maxLength={2000}
                    className="form-input"
                  />
                </label>
                <VisibilitySelect
                  label="Resting place"
                  value={form.burial_location_visibility}
                  onChange={(v) => set('burial_location_visibility', v)}
                />
              </div>
            </div>
          )}
        </fieldset>

        {editing && original && (
          <EditKindChoice
            kind={editKind}
            note={editNote}
            onKindChange={setEditKind}
            onNoteChange={setEditNote}
            isPublic={original.publication_level === 'public'}
          />
        )}

        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn-primary rounded-md px-4 py-2" disabled={saving}>
            {editing ? 'Save changes' : 'Add to the archive'}
          </button>
          <button
            type="button"
            className="btn-secondary rounded-md px-4 py-2"
            onClick={() => void navigate(personId ? `/history/people/${personId}` : '/history/people')}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};

export default HistoryPersonFormPage;
