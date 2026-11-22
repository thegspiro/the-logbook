/**
 * Adding or editing a historical apparatus: its catalogue and its unit
 * numbers over time. A new record can instead start from a truck in the
 * Apparatus module, which copies its descriptive details once; the server
 * decides what is copied, and never a price, VIN, plate or maintenance figure.
 *
 * On an edit, a change to anything a reader sees is recorded as substantial
 * whatever is chosen here: the server decides.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import toast from 'react-hot-toast';
import { Breadcrumbs } from '../../../components/ux/Breadcrumbs';
import { SkeletonPage } from '../../../components/ux/Skeleton';
import { useEnabledModules } from '../../../hooks/useEnabledModules';
import { getErrorMessage } from '../../../utils/errorHandling';
import { DesignationsEditor } from '../components/DesignationsEditor';
import { EditKindChoice } from '../components/EditKindChoice';
import { ListEntrySelect } from '../components/ListEntrySelect';
import { PartialDateInput } from '../components/PartialDateInput';
import { historyApparatusService, historyListService, historyMediaService } from '../services/api';
import {
  APPARATUS_DISPOSITION_LABELS,
  type ApparatusDisposition,
  type ApparatusFullView,
  type EditKind,
  type FleetOption,
  type HistoryListEntry,
  type HistorySource,
} from '../types';
import {
  EMPTY_APPARATUS_FORM,
  apparatusForCreate,
  apparatusFormFrom,
  apparatusForUpdate,
  type ApparatusForm,
} from '../utils/apparatusCatalogue';

type TextKey = {
  [K in keyof ApparatusForm]: ApparatusForm[K] extends string ? K : never;
}[keyof ApparatusForm];

const FromTheFleet: React.FC<{ onCreated: (item: ApparatusFullView) => void }> = ({ onCreated }) => {
  const [options, setOptions] = useState<FleetOption[] | null>(null);
  const [chosen, setChosen] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    historyApparatusService
      .fleetOptions()
      .then(setOptions)
      .catch(() => setOptions([]));
  }, []);

  if (!options || options.length === 0) return null;

  const start = async () => {
    setSaving(true);
    try {
      onCreated(await historyApparatusService.createFromFleet(chosen));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not start a record from this truck'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="from-fleet-heading" className="card mb-4 space-y-3 p-4">
      <h2 id="from-fleet-heading" className="text-theme-text-primary text-lg font-semibold">
        Start from a truck in the fleet
      </h2>
      <p className="text-theme-text-secondary text-sm">
        Copies its name, type, year, make, model, figures, unit number, in-service date and disposal once. Nothing syncs
        afterwards, and no price, VIN, plate or maintenance record is copied.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-[1_1_14rem]">
          <span className="form-label">Truck</span>
          <select value={chosen} onChange={(e) => setChosen(e.target.value)} className="form-input">
            <option value="">Choose a truck</option>
            {options.map((option) => (
              <option key={option.id} value={option.id} disabled={Boolean(option.history_apparatus_id)}>
                {option.unit_number}
                {option.name ? ` (${option.name})` : ''} · {option.description}
                {option.is_archived ? ' · previously owned' : ''}
                {option.history_apparatus_id ? ' · already in History' : ''}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn-primary rounded-md px-3 py-2 text-sm"
          disabled={!chosen || saving}
          onClick={() => void start()}
        >
          Start record
        </button>
      </div>
    </section>
  );
};

export const HistoryApparatusFormPage: React.FC = () => {
  const { apparatusId } = useParams();
  const navigate = useNavigate();
  const { isModuleOn, isLoading: modulesLoading } = useEnabledModules();
  const [item, setItem] = useState<ApparatusFullView | null>(null);
  const [form, setForm] = useState<ApparatusForm | null>(apparatusId ? null : EMPTY_APPARATUS_FORM);
  const [stations, setStations] = useState<HistoryListEntry[]>([]);
  const [types, setTypes] = useState<HistoryListEntry[]>([]);
  const [sources, setSources] = useState<HistorySource[]>([]);
  const [editKind, setEditKind] = useState<EditKind>('minor');
  const [editNote, setEditNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void historyListService
      .list('stations', true)
      .then(setStations)
      .catch(() => setStations([]));
    void historyListService
      .list('apparatus-types', true)
      .then(setTypes)
      .catch(() => setTypes([]));
    void historyMediaService
      .listSources(true)
      .then(setSources)
      .catch(() => setSources([]));
    if (!apparatusId) return;
    historyApparatusService
      .getApparatus(apparatusId)
      .then((loaded) => {
        if (loaded.view !== 'full') {
          setError('Only the archive’s keepers can edit an apparatus record.');
          return;
        }
        setItem(loaded);
        setForm(apparatusFormFrom(loaded));
      })
      .catch((err: unknown) => setError(getErrorMessage(err, 'Unable to load this apparatus.')));
  }, [apparatusId]);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <div role="alert" className="alert-danger rounded-md p-3 text-sm">
          {error}
        </div>
      </div>
    );
  }
  if (!form) return <SkeletonPage />;

  const set = <K extends keyof ApparatusForm>(key: K, value: ApparatusForm[K]) =>
    setForm((current) => (current ? { ...current, [key]: value } : current));

  const text = (key: TextKey, label: string, maxLength: number, inputMode?: 'numeric') => (
    <label className="block">
      <span className="form-label">{label}</span>
      <input
        value={form[key]}
        maxLength={maxLength}
        inputMode={inputMode}
        onChange={(e) => set(key, e.target.value)}
        className="form-input"
        disabled={saving}
      />
    </label>
  );

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Enter a name');
      return;
    }
    setSaving(true);
    try {
      const saved = item
        ? await historyApparatusService.updateApparatus(item.id, {
            ...apparatusForUpdate(form),
            edit_kind: editKind,
            edit_note: editNote.trim() || undefined,
          })
        : await historyApparatusService.createApparatus(apparatusForCreate(form));
      toast.success(item ? 'Saved' : 'Apparatus added as a draft');
      void navigate(`/history/apparatus/${saved.id}`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save this apparatus'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <Breadcrumbs
        items={[
          { label: 'History', path: '/history' },
          { label: 'Apparatus', path: '/history/apparatus' },
          ...(item
            ? [{ label: item.name, path: `/history/apparatus/${item.id}` }, { label: 'Edit' }]
            : [{ label: 'New' }]),
        ]}
      />
      <h1 className="text-theme-text-primary mb-4 text-2xl font-bold">
        {item ? `Edit ${item.name}` : 'Add an apparatus'}
      </h1>

      {!item && !modulesLoading && isModuleOn('apparatus') && (
        <FromTheFleet
          onCreated={(created) => {
            toast.success('Record started as a draft');
            void navigate(`/history/apparatus/${created.id}`);
          }}
        />
      )}

      <form onSubmit={(e) => void save(e)} className="space-y-4">
        <section className="card grid gap-4 p-4 sm:grid-cols-2 sm:p-5" aria-label="The apparatus">
          <label className="block sm:col-span-2">
            <span className="form-label">
              Name<span aria-hidden="true"> *</span>
            </span>
            <input
              value={form.name}
              maxLength={200}
              required
              placeholder="1924 Ahrens-Fox pumper"
              onChange={(e) => set('name', e.target.value)}
              className="form-input"
              disabled={saving}
            />
          </label>
          <ListEntrySelect
            label="Type"
            path="apparatus-types"
            noun="apparatus type"
            entries={types}
            value={form.apparatus_type_id}
            onChange={(id) => set('apparatus_type_id', id)}
            onAdded={(entry) => setTypes((current) => [...current, entry])}
            disabled={saving}
          />
          {text('year', 'Year built', 4, 'numeric')}
          {text('make', 'Make', 100)}
          {text('model', 'Model', 100)}
          {text('body_builder', 'Body builder', 100)}
          {text('pump_gpm', 'Pump (GPM)', 6, 'numeric')}
          {text('tank_gallons', 'Tank (gallons)', 6, 'numeric')}
          {text('ladder_feet', 'Ladder (feet)', 4, 'numeric')}
          <PartialDateInput
            label="Into service"
            value={form.in_service_date}
            precision={form.in_service_precision}
            circa={form.in_service_circa}
            disabled={saving}
            onChange={(next) =>
              setForm({
                ...form,
                in_service_date: next.value,
                in_service_precision: next.precision,
                in_service_circa: next.circa,
              })
            }
          />
          <PartialDateInput
            label="Out of service"
            value={form.out_of_service_date}
            precision={form.out_of_service_precision}
            circa={form.out_of_service_circa}
            disabled={saving}
            onChange={(next) =>
              setForm({
                ...form,
                out_of_service_date: next.value,
                out_of_service_precision: next.precision,
                out_of_service_circa: next.circa,
              })
            }
          />
          <label className="block">
            <span className="form-label">What became of it</span>
            <select
              value={form.disposition}
              onChange={(e) => set('disposition', e.target.value as ApparatusDisposition)}
              className="form-input"
              disabled={saving}
            >
              {(Object.keys(APPARATUS_DISPOSITION_LABELS) as ApparatusDisposition[]).map((key) => (
                <option key={key} value={key}>
                  {APPARATUS_DISPOSITION_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
          {text('current_location', 'Where it is now', 255)}
          <label className="block sm:col-span-2">
            <span className="form-label">Description</span>
            <textarea
              value={form.description}
              rows={4}
              maxLength={20000}
              onChange={(e) => set('description', e.target.value)}
              className="form-input"
              disabled={saving}
            />
          </label>
          <label className="block">
            <span className="form-label">Source or donor</span>
            <select
              value={form.source_id}
              onChange={(e) => set('source_id', e.target.value)}
              className="form-input"
              disabled={saving}
            >
              <option value="">Not recorded</option>
              {sources
                .filter((s) => !s.is_retired || s.id === form.source_id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>
          {text('accession_number', 'Accession number', 100)}
          <label className="block sm:col-span-2">
            <span className="form-label">Research notes (Historian only)</span>
            <textarea
              value={form.research_notes}
              rows={3}
              maxLength={20000}
              onChange={(e) => set('research_notes', e.target.value)}
              className="form-input"
              disabled={saving}
            />
          </label>
        </section>

        <section className="card space-y-3 p-4 sm:p-5" aria-labelledby="apparatus-form-units-heading">
          <h2 id="apparatus-form-units-heading" className="text-theme-text-primary text-lg font-semibold">
            Unit numbers
          </h2>
          <DesignationsEditor
            value={form.designations}
            onChange={(next) => set('designations', next)}
            stations={stations}
            onStationAdded={(entry) => setStations((current) => [...current, entry])}
            disabled={saving}
          />
        </section>

        {item && (
          <EditKindChoice
            kind={editKind}
            onKindChange={setEditKind}
            note={editNote}
            onNoteChange={setEditNote}
            isPublic={item.publication_level === 'public'}
          />
        )}
        <div className="flex gap-2">
          <button type="submit" disabled={saving} className="btn-primary rounded-md px-4 py-2 text-sm font-medium">
            {saving ? 'Saving…' : item ? 'Save' : 'Add apparatus'}
          </button>
          <button
            type="button"
            onClick={() => void navigate(item ? `/history/apparatus/${item.id}` : '/history/apparatus')}
            className="btn-secondary rounded-md px-4 py-2 text-sm"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};

export default HistoryApparatusFormPage;
