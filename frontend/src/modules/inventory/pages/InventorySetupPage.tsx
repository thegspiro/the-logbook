/**
 * Inventory Setup — guided first-run workflow for a new quartermaster.
 *
 * Adding an item touches four separate admin screens before the item form is
 * even useful: a room has to exist, a storage area has to exist inside it, a
 * category has to exist to decide which fields the item form shows, and only
 * then does the item itself get typed. Nothing on the admin hub says that,
 * and nothing says in which order — so a new QM meets the item form first,
 * finds three empty dropdowns, and leaves them empty. An item with no room,
 * no storage area, and no category is the record that later cannot be found
 * on a shelf, does not appear in a low-stock alert, and has no inspection
 * cycle.
 *
 * This page puts those four in their dependency order on one screen, carries
 * each step's answer forward into the next (the room chosen in step 2 is the
 * room pre-filled in step 4), and lets any step be skipped — a department
 * that already has rooms should not be made to re-declare them.
 *
 * It is deliberately not a replacement for the individual admin pages, which
 * remain the place to do the work at volume; each step links to its page.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  MapPin,
  Box,
  Tag,
  Package,
  Plus,
  ExternalLink,
  Sparkles,
  PartyPopper,
  Upload,
  SlidersHorizontal,
  BoxSelect,
  Target,
} from 'lucide-react';
import { inventoryService, locationsService } from '../../../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';
import { ProgressSteps } from '../../../components/ux';
import { ItemFormModal } from '../components/ItemFormModal';
import type { CategoryPreset, InventoryCategory, InventorySetupStatus, Location, StorageAreaResponse } from '../types';
import { STORAGE_TYPES, ITEM_TYPES } from '../types';

const STEPS = [
  { label: 'Rooms', description: 'Where equipment lives' },
  { label: 'Storage', description: 'Racks, shelves, and bins' },
  { label: 'Categories', description: 'How items are classified' },
  { label: 'First items', description: 'Stock the catalog' },
  { label: 'Done', description: 'What to set up next' },
] as const;

const LAST_STEP = STEPS.length - 1;

function itemTypeLabel(value: string): string {
  return ITEM_TYPES.find((t) => t.value === value)?.label ?? value;
}

/* ---------- Shared step chrome ---------- */

interface StepShellProps {
  title: string;
  intro: string;
  /** Deep link to the full admin page for this step. */
  manageTo?: string;
  manageLabel?: string;
  children: React.ReactNode;
}

const StepShell: React.FC<StepShellProps> = ({ title, intro, manageTo, manageLabel, children }) => (
  <div className="card-secondary p-4 sm:p-6">
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h2 className="text-theme-text-primary text-lg font-semibold">{title}</h2>
        <p className="text-theme-text-secondary mt-1 text-sm">{intro}</p>
      </div>
      {manageTo && (
        <Link
          to={manageTo}
          className="text-theme-text-muted hover:text-theme-text-primary flex shrink-0 items-center gap-1 text-sm"
        >
          {manageLabel ?? 'Open full page'}
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
    {children}
  </div>
);

/** A short list of what the step has produced so far. */
interface ExistingListProps {
  icon: React.ReactNode;
  emptyText: string;
  entries: { id: string; primary: string; secondary?: string }[];
}

const ExistingList: React.FC<ExistingListProps> = ({ icon, emptyText, entries }) => {
  if (entries.length === 0) {
    return (
      <p className="text-theme-text-muted border-theme-surface-border rounded-lg border border-dashed p-4 text-sm">
        {emptyText}
      </p>
    );
  }
  return (
    <ul className="border-theme-surface-border divide-theme-surface-border divide-y rounded-lg border">
      {entries.map((entry) => (
        <li key={entry.id} className="flex items-center gap-2 px-3 py-2">
          <span className="text-theme-text-muted shrink-0">{icon}</span>
          <span className="text-theme-text-primary min-w-0 flex-1 truncate text-sm">{entry.primary}</span>
          {entry.secondary && <span className="text-theme-text-muted shrink-0 text-xs">{entry.secondary}</span>}
        </li>
      ))}
    </ul>
  );
};

/* ---------- Page ---------- */

const InventorySetupPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const stepParam = Number.parseInt(searchParams.get('step') ?? '', 10);
  const step = Number.isFinite(stepParam) && stepParam >= 0 && stepParam <= LAST_STEP ? stepParam : 0;

  const [status, setStatus] = useState<InventorySetupStatus | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [storageAreas, setStorageAreas] = useState<StorageAreaResponse[]>([]);
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [presets, setPresets] = useState<CategoryPreset[]>([]);
  const [loading, setLoading] = useState(true);

  // Step 1 — room form
  const [roomName, setRoomName] = useState('');
  const [roomBuilding, setRoomBuilding] = useState('');
  const [roomNumber, setRoomNumber] = useState('');
  const [savingRoom, setSavingRoom] = useState(false);

  // Step 2 — storage form
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [areaName, setAreaName] = useState('');
  const [areaType, setAreaType] = useState<string>(STORAGE_TYPES[0].value);
  const [savingArea, setSavingArea] = useState(false);

  // Step 3 — category presets
  const [selectedPresets, setSelectedPresets] = useState<string[]>([]);
  const [applyingPresets, setApplyingPresets] = useState(false);

  // Step 4 — first item
  const [selectedAreaId, setSelectedAreaId] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [itemModalOpen, setItemModalOpen] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [statusData, locationData, areaData, categoryData, presetData] = await Promise.all([
        inventoryService.getSetupStatus(),
        locationsService.getLocations({ is_active: true }),
        inventoryService.getStorageAreas({ flat: true }),
        inventoryService.getCategories(),
        inventoryService.getCategoryPresets(),
      ]);
      setStatus(statusData);
      setLocations(locationData);
      setStorageAreas(areaData);
      setCategories(categoryData);
      setPresets(presetData);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load setup status'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Default the room and category pickers to the first available option so a
  // department with one station never has to make a choice it has no choice in.
  //
  // Once only: step 4 offers "-- None --" on both, and an effect that watched
  // the selection would put the first option straight back and make clearing
  // it impossible.
  const roomDefaulted = useRef(false);
  const categoryDefaulted = useRef(false);

  useEffect(() => {
    if (!roomDefaulted.current && locations.length > 0) {
      roomDefaulted.current = true;
      setSelectedRoomId(locations[0]?.id ?? '');
    }
  }, [locations]);

  useEffect(() => {
    if (!categoryDefaulted.current && categories.length > 0) {
      categoryDefaulted.current = true;
      setSelectedCategoryId(categories[0]?.id ?? '');
    }
  }, [categories]);

  const areasInRoom = useMemo(
    () => (selectedRoomId ? storageAreas.filter((a) => a.location_id === selectedRoomId) : storageAreas),
    [storageAreas, selectedRoomId]
  );

  useEffect(() => {
    if (selectedAreaId && !areasInRoom.some((a) => a.id === selectedAreaId)) setSelectedAreaId('');
  }, [areasInRoom, selectedAreaId]);

  const goToStep = useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(next, 0), LAST_STEP);
      const params = new URLSearchParams(searchParams);
      params.set('step', String(clamped));
      setSearchParams(params, { replace: true });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [searchParams, setSearchParams]
  );

  /* ---------- Step actions ---------- */

  const addRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomName.trim()) {
      toast.error('Room name is required');
      return;
    }
    setSavingRoom(true);
    try {
      const created = await locationsService.createLocation({
        name: roomName.trim(),
        // `||` not `??`: an untouched field is '' and must not reach the API.
        building: roomBuilding.trim() || undefined,
        room_number: roomNumber.trim() || undefined,
      });
      toast.success(`"${created.name}" added`);
      setRoomName('');
      setRoomBuilding('');
      setRoomNumber('');
      setSelectedRoomId(created.id);
      await loadAll();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to add the room'));
    } finally {
      setSavingRoom(false);
    }
  };

  const addStorageArea = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!areaName.trim()) {
      toast.error('Storage area name is required');
      return;
    }
    setSavingArea(true);
    try {
      await inventoryService.createStorageArea({
        name: areaName.trim(),
        storage_type: areaType,
        location_id: selectedRoomId || undefined,
      });
      toast.success(`"${areaName.trim()}" added`);
      setAreaName('');
      await loadAll();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to add the storage area'));
    } finally {
      setSavingArea(false);
    }
  };

  const togglePreset = (key: string) => {
    setSelectedPresets((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const applyPresets = async () => {
    if (selectedPresets.length === 0) return;
    setApplyingPresets(true);
    try {
      const result = await inventoryService.applyCategoryPresets(selectedPresets);
      if (result.created.length > 0) {
        toast.success(`Added ${result.created.length} categor${result.created.length === 1 ? 'y' : 'ies'}`);
      }
      if (result.skipped.length > 0) {
        toast(`${result.skipped.length} already existed and were left alone`, { icon: 'ℹ️' });
      }
      setSelectedPresets([]);
      await loadAll();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to add the categories'));
    } finally {
      setApplyingPresets(false);
    }
  };

  /* ---------- Step completion ---------- */

  const stepComplete = [
    locations.length > 0,
    storageAreas.length > 0,
    categories.length > 0,
    (status?.items ?? 0) > 0,
    true,
  ];

  const currentComplete = stepComplete[step] ?? false;

  if (loading && !status) {
    return (
      <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
        <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <Link
        to="/inventory/admin"
        className="text-theme-text-muted hover:text-theme-text-secondary flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Admin
      </Link>

      <div>
        <div className="flex items-center gap-3">
          <div className="shrink-0 rounded-lg bg-blue-600 p-2">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-theme-text-primary text-xl font-bold sm:text-2xl">Inventory Setup</h1>
            <p className="text-theme-text-secondary text-sm">
              Four steps, in the order an item needs them. Skip anything already done.
            </p>
          </div>
        </div>
      </div>

      <ProgressSteps steps={[...STEPS]} currentStep={step} />

      {/* Step 1 — Rooms */}
      {step === 0 && (
        <StepShell
          title="Rooms"
          intro="A room is the place an item is kept — a station bay, a gear room, a supply closet. Storage areas hang off a room, so this comes first."
          manageTo="/locations"
          manageLabel="Manage locations"
        >
          <div className="space-y-4">
            <ExistingList
              icon={<MapPin className="h-4 w-4" />}
              emptyText="No rooms yet. Add the room where most of your equipment is kept — you can add the rest later."
              entries={locations.map((l) => ({
                id: l.id,
                primary: l.name,
                secondary: [l.building, l.room_number ? `Room ${l.room_number}` : ''].filter(Boolean).join(' · '),
              }))}
            />

            <form onSubmit={(e) => void addRoom(e)} className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <div className="sm:col-span-2">
                <label htmlFor="setup-room-name" className="form-label">
                  Room name <span className="text-red-500">*</span>
                </label>
                <input
                  id="setup-room-name"
                  className="form-input"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  placeholder="e.g. Gear Room"
                />
              </div>
              <div>
                <label htmlFor="setup-room-building" className="form-label">
                  Building
                </label>
                <input
                  id="setup-room-building"
                  className="form-input"
                  value={roomBuilding}
                  onChange={(e) => setRoomBuilding(e.target.value)}
                  placeholder="Station 1"
                />
              </div>
              <div>
                <label htmlFor="setup-room-number" className="form-label">
                  Room #
                </label>
                <input
                  id="setup-room-number"
                  className="form-input"
                  value={roomNumber}
                  onChange={(e) => setRoomNumber(e.target.value)}
                  placeholder="103"
                />
              </div>
              <div className="sm:col-span-4">
                <button type="submit" disabled={savingRoom} className="btn-info btn-md inline-flex items-center gap-2">
                  {savingRoom ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Add room
                </button>
              </div>
            </form>
          </div>
        </StepShell>
      )}

      {/* Step 2 — Storage areas */}
      {step === 1 && (
        <StepShell
          title="Storage areas"
          intro="Racks, shelves, lockers, and bins inside a room. This is what turns “it's in the gear room somewhere” into a shelf you can walk to."
          manageTo="/inventory/storage-areas"
          manageLabel="Manage storage areas"
        >
          {locations.length === 0 ? (
            <p className="alert-warning text-sm">Add a room in step 1 first — a storage area belongs to a room.</p>
          ) : (
            <div className="space-y-4">
              <div>
                <label htmlFor="setup-area-room" className="form-label">
                  Room
                </label>
                <select
                  id="setup-area-room"
                  className="form-input"
                  value={selectedRoomId}
                  onChange={(e) => setSelectedRoomId(e.target.value)}
                >
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                      {l.building ? ` — ${l.building}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <ExistingList
                icon={<Box className="h-4 w-4" />}
                emptyText="No storage areas in this room yet. Add one for each place gear actually sits."
                entries={areasInRoom.map((a) => ({
                  id: a.id,
                  primary: a.name,
                  secondary: STORAGE_TYPES.find((t) => t.value === a.storage_type)?.label ?? a.storage_type,
                }))}
              />

              <form onSubmit={(e) => void addStorageArea(e)} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label htmlFor="setup-area-name" className="form-label">
                    Storage area name <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="setup-area-name"
                    className="form-input"
                    value={areaName}
                    onChange={(e) => setAreaName(e.target.value)}
                    placeholder="e.g. Rack A"
                  />
                </div>
                <div>
                  <label htmlFor="setup-area-type" className="form-label">
                    Type
                  </label>
                  <select
                    id="setup-area-type"
                    className="form-input"
                    value={areaType}
                    onChange={(e) => setAreaType(e.target.value)}
                  >
                    {STORAGE_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-3">
                  <button
                    type="submit"
                    disabled={savingArea}
                    className="btn-info btn-md inline-flex items-center gap-2"
                  >
                    {savingArea ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    Add storage area
                  </button>
                </div>
              </form>
            </div>
          )}
        </StepShell>
      )}

      {/* Step 3 — Categories */}
      {step === 2 && (
        <StepShell
          title="Categories"
          intro="A category decides which fields an item asks for and whether it gets inspection and NFPA tracking. Pick the ones your department carries — each is an ordinary category afterwards and can be edited."
          manageTo="/inventory/admin/categories"
          manageLabel="Manage categories"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {presets.map((preset) => {
                const already = preset.exists;
                const checked = selectedPresets.includes(preset.key);
                return (
                  <label
                    key={preset.key}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                      already
                        ? 'border-theme-surface-border bg-theme-surface-secondary/50 cursor-default'
                        : checked
                          ? 'border-blue-500/50 bg-blue-500/10'
                          : 'border-theme-surface-border hover:border-theme-text-muted'
                    }`}
                  >
                    {already ? (
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
                    ) : (
                      <input
                        type="checkbox"
                        className="form-checkbox mt-0.5 shrink-0"
                        checked={checked}
                        onChange={() => togglePreset(preset.key)}
                      />
                    )}
                    <span className="min-w-0">
                      <span className="text-theme-text-primary block text-sm font-medium">
                        {preset.name}
                        {already && (
                          <span className="text-theme-text-muted ml-1.5 text-xs font-normal">already added</span>
                        )}
                      </span>
                      <span className="text-theme-text-muted block text-xs">{preset.description}</span>
                      <span className="text-theme-text-muted mt-1 flex flex-wrap gap-1.5 text-[11px]">
                        <span className="bg-theme-surface-hover rounded px-1.5 py-0.5">
                          {itemTypeLabel(preset.item_type)}
                        </span>
                        {preset.requires_serial_number && (
                          <span className="bg-theme-surface-hover rounded px-1.5 py-0.5">Serial #</span>
                        )}
                        {preset.requires_maintenance && (
                          <span className="bg-theme-surface-hover rounded px-1.5 py-0.5">Maintenance</span>
                        )}
                        {preset.nfpa_tracking_enabled && (
                          <span className="bg-theme-surface-hover rounded px-1.5 py-0.5">NFPA</span>
                        )}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => void applyPresets()}
              disabled={applyingPresets || selectedPresets.length === 0}
              className="btn-info btn-md inline-flex items-center gap-2 disabled:opacity-50"
            >
              {applyingPresets ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {selectedPresets.length > 0
                ? `Add ${selectedPresets.length} categor${selectedPresets.length === 1 ? 'y' : 'ies'}`
                : 'Add selected categories'}
            </button>

            <div>
              <p className="text-theme-text-muted mb-2 text-xs font-semibold tracking-wider uppercase">
                Categories you have ({categories.length})
              </p>
              <ExistingList
                icon={<Tag className="h-4 w-4" />}
                emptyText="No categories yet. Pick from the list above, or create your own on the categories page."
                entries={categories.map((c) => ({
                  id: c.id,
                  primary: c.name,
                  secondary: itemTypeLabel(c.item_type),
                }))}
              />
            </div>
          </div>
        </StepShell>
      )}

      {/* Step 4 — First items */}
      {step === 3 && (
        <StepShell
          title="First items"
          intro="Everything the item form asks for is now ready. Pick where these items live and what they are, and the form opens with those already filled in."
          manageTo="/inventory/admin/items"
          manageLabel="Manage items"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="setup-item-room" className="form-label">
                  Room
                </label>
                <select
                  id="setup-item-room"
                  className="form-input"
                  value={selectedRoomId}
                  onChange={(e) => setSelectedRoomId(e.target.value)}
                >
                  <option value="">-- None --</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="setup-item-area" className="form-label">
                  Storage area
                </label>
                <select
                  id="setup-item-area"
                  className="form-input"
                  value={selectedAreaId}
                  onChange={(e) => setSelectedAreaId(e.target.value)}
                >
                  <option value="">-- None --</option>
                  {areasInRoom.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="setup-item-category" className="form-label">
                  Category
                </label>
                <select
                  id="setup-item-category"
                  className="form-input"
                  value={selectedCategoryId}
                  onChange={(e) => setSelectedCategoryId(e.target.value)}
                >
                  <option value="">-- None --</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setItemModalOpen(true)}
                className="btn-info btn-md inline-flex items-center gap-2"
              >
                <Plus className="h-4 w-4" />
                Add an item
              </button>
              <Link to="/inventory/import" className="btn-secondary btn-md inline-flex items-center gap-2">
                <Upload className="h-4 w-4" />
                Import from CSV
              </Link>
            </div>

            <p className="text-theme-text-muted text-sm">
              {(status?.items ?? 0) > 0
                ? `${status?.items ?? 0} item${(status?.items ?? 0) === 1 ? '' : 's'} in the catalog so far.`
                : 'Nothing in the catalog yet. One item is enough to finish setup — the rest can come from a CSV import.'}
            </p>
          </div>
        </StepShell>
      )}

      {/* Step 5 — Done */}
      {step === 4 && (
        <StepShell
          title="Setup complete"
          intro="The basics are in place. These are the pieces worth setting up next, in rough order of how soon most departments need them."
        >
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg border border-green-500/30 bg-green-500/10 p-3">
              <PartyPopper className="h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />
              <p className="text-sm text-green-700 dark:text-green-300">
                {locations.length} room{locations.length === 1 ? '' : 's'}, {storageAreas.length} storage area
                {storageAreas.length === 1 ? '' : 's'}, {categories.length} categor
                {categories.length === 1 ? 'y' : 'ies'}, and {status?.items ?? 0} item
                {(status?.items ?? 0) === 1 ? '' : 's'}.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Link
                to="/inventory/admin/allowances"
                className="card-secondary hover:bg-theme-surface-hover flex items-start gap-3 p-3"
              >
                <SlidersHorizontal className="mt-0.5 h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" />
                <span>
                  <span className="text-theme-text-primary block text-sm font-semibold">Issuance allowances</span>
                  <span className="text-theme-text-muted block text-xs">
                    Cap how many units per category a member can hold
                  </span>
                </span>
              </Link>
              <Link
                to="/inventory/admin/kits"
                className="card-secondary hover:bg-theme-surface-hover flex items-start gap-3 p-3"
              >
                <BoxSelect className="mt-0.5 h-5 w-5 shrink-0 text-purple-600 dark:text-purple-400" />
                <span>
                  <span className="text-theme-text-primary block text-sm font-semibold">Equipment kits</span>
                  <span className="text-theme-text-muted block text-xs">
                    Issue a new member their whole set in one action
                  </span>
                </span>
              </Link>
              <Link
                to="/inventory/admin/impact-planner"
                className="card-secondary hover:bg-theme-surface-hover flex items-start gap-3 p-3"
              >
                <Target className="mt-0.5 h-5 w-5 shrink-0 text-purple-600 dark:text-purple-400" />
                <span>
                  <span className="text-theme-text-primary block text-sm font-semibold">Impact planner</span>
                  <span className="text-theme-text-muted block text-xs">
                    Plan an issue: who's affected and what sizes to order
                  </span>
                </span>
              </Link>
              <Link
                to="/inventory/print-labels"
                className="card-secondary hover:bg-theme-surface-hover flex items-start gap-3 p-3"
              >
                <Package className="mt-0.5 h-5 w-5 shrink-0 text-cyan-600 dark:text-cyan-400" />
                <span>
                  <span className="text-theme-text-primary block text-sm font-semibold">Barcode labels</span>
                  <span className="text-theme-text-muted block text-xs">
                    Print labels so items can be scanned in and out
                  </span>
                </span>
              </Link>
            </div>
          </div>
        </StepShell>
      )}

      {/* Footer navigation */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => goToStep(step - 1)}
          disabled={step === 0}
          className="btn-secondary btn-md inline-flex items-center gap-2 disabled:opacity-40"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>

        {step < LAST_STEP ? (
          <div className="flex items-center gap-3">
            {!currentComplete && (
              <button
                type="button"
                onClick={() => goToStep(step + 1)}
                className="text-theme-text-muted hover:text-theme-text-primary text-sm underline"
              >
                Skip this step
              </button>
            )}
            <button
              type="button"
              onClick={() => goToStep(step + 1)}
              className="btn-info btn-md inline-flex items-center gap-2"
            >
              Continue
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <Link to="/inventory/admin" className="btn-info btn-md inline-flex items-center gap-2">
            Go to Inventory Admin
            <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </div>

      <ItemFormModal
        isOpen={itemModalOpen}
        onClose={() => setItemModalOpen(false)}
        onSaved={() => {
          void loadAll();
        }}
        categories={categories}
        locations={locations}
        storageAreas={storageAreas}
        defaults={{
          category_id: selectedCategoryId || undefined,
          location_id: selectedRoomId || undefined,
          storage_area_id: selectedAreaId || undefined,
        }}
      />
    </div>
  );
};

export default InventorySetupPage;
