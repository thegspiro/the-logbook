import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import toast from 'react-hot-toast';
import { facilitiesService } from '../../../services/api';
import type { MaintenanceRecordCreate } from '../../../services/facilitiesServices';
import type { MaintenanceRecord, MaintenanceType } from '../types';
import { useTimezone } from '../../../hooks/useTimezone';
import { getTodayLocalDate } from '../../../utils/dateFormatting';
import { formCoercions } from '../../../utils/formValues';
import { placeApiError, useFieldErrors, type FieldErrors, type FieldSpecs } from '../../../hooks/useFieldErrors';
import { firstRefused, saveExceptRefused } from '../../../utils/saveExceptRefused';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { MAINTENANCE_DUE_WINDOW_DAYS, type MaintenanceStatusFilter } from '../constants';

export interface MaintenanceFormData {
  facility_id: string;
  maintenance_type_id: string;
  description: string;
  scheduled_date: string;
  due_date: string;
  performed_by: string;
  cost: string;
  vendor: string;
  work_order_number: string;
  notes: string;
}

const emptyForm = (facilityId?: string): MaintenanceFormData => ({
  facility_id: facilityId || '',
  maintenance_type_id: '',
  description: '',
  scheduled_date: '',
  due_date: '',
  performed_by: '',
  cost: '',
  vendor: '',
  work_order_number: '',
  notes: '',
});

function recordToForm(record: MaintenanceRecord): MaintenanceFormData {
  return {
    facility_id: record.facilityId,
    maintenance_type_id: record.maintenanceTypeId || '',
    description: record.description || '',
    scheduled_date: record.scheduledDate || '',
    due_date: record.dueDate || '',
    performed_by: record.performedBy || '',
    cost: record.cost?.toString() || '',
    vendor: record.vendor || '',
    work_order_number: record.workOrderNumber || '',
    notes: record.notes || '',
  };
}

/**
 * On create a blank optional field is omitted; on edit it goes as an explicit
 * null, because the backend dumps update payloads with `exclude_unset` and an
 * omitted key means "leave this alone" — so clearing a vendor, a cost or a due
 * date used to be lost behind a success toast (CLAUDE.md pitfall #1).
 *
 * `maintenance_type_id` is the exception: its column is NOT NULL, so a blank
 * one is omitted in both modes rather than nulled.
 */
function formToPayload(formData: MaintenanceFormData, isEdit: boolean): MaintenanceRecordCreate {
  const { text, pick, num } = formCoercions(isEdit);
  return {
    facility_id: formData.facility_id,
    description: formData.description.trim(),
    maintenance_type_id: formData.maintenance_type_id || undefined,
    scheduled_date: pick(formData.scheduled_date),
    due_date: pick(formData.due_date),
    performed_by: text(formData.performed_by),
    cost: num(formData.cost),
    vendor: text(formData.vendor),
    work_order_number: text(formData.work_order_number),
    notes: text(formData.notes),
  };
}

export type MaintenanceField = keyof MaintenanceFormData;

/** Field labels in screen order, so the first refusal takes focus. */
const MAINTENANCE_LABELS: Record<MaintenanceField, string> = {
  facility_id: 'Facility',
  description: 'Description',
  maintenance_type_id: 'Maintenance type',
  scheduled_date: 'Scheduled date',
  due_date: 'Due date',
  performed_by: 'Performed by',
  vendor: 'Vendor',
  cost: 'Cost',
  work_order_number: 'Work order number',
  notes: 'Notes',
};

/** Limits mirror FacilityMaintenanceBase. */
export const MAINTENANCE_LIMITS = { performed_by: 200, vendor: 200, work_order_number: 100 } as const;

/** The field specs for a dialog whose ids start with `idPrefix`. */
export function maintenanceFieldSpecs(idPrefix: string): FieldSpecs<MaintenanceField> {
  return Object.fromEntries(
    (Object.keys(MAINTENANCE_LABELS) as MaintenanceField[]).map((name) => [
      name,
      { id: `${idPrefix}-${name.replace(/_/g, '-')}`, label: MAINTENANCE_LABELS[name] },
    ])
  ) as FieldSpecs<MaintenanceField>;
}

type StatusFilter = MaintenanceStatusFilter;

export const MAINTENANCE_PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 250;

interface UseMaintenanceFormOptions {
  facilityId?: string;
  initialStatusFilter?: StatusFilter;
  /** The prefix of the dialog's field ids, so a refusal can focus its field. */
  idPrefix?: string;
}

export function useMaintenanceForm({
  facilityId,
  initialStatusFilter = 'all',
  idPrefix = 'facility-maintenance',
}: UseMaintenanceFormOptions = {}) {
  const { confirm } = useConfirm();
  const tz = useTimezone();
  const [records, setRecords] = useState<MaintenanceRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  // What the server is asked to search for: the box, settled for a moment, so
  // typing a word is one request rather than one per letter.
  const [appliedSearch, setAppliedSearch] = useState('');
  const [maintenanceTypes, setMaintenanceTypes] = useState<MaintenanceType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialStatusFilter);
  const [showModal, setShowModal] = useState(false);
  const [editingRecord, setEditingRecord] = useState<MaintenanceRecord | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState<MaintenanceFormData>(emptyForm(facilityId));
  // What the dialog held when it opened (or last saved), so closing asks
  // before throwing typed changes away (forms review F-6).
  const [baseline, setBaseline] = useState<MaintenanceFormData>(emptyForm(facilityId));
  const fieldSpecs = useMemo(() => maintenanceFieldSpecs(idPrefix), [idPrefix]);
  const fieldOrder = useMemo(() => Object.keys(fieldSpecs) as MaintenanceField[], [fieldSpecs]);
  const fieldErrors = useFieldErrors(fieldSpecs);
  const setField = (patch: Partial<MaintenanceFormData>) => {
    setFormData((p) => ({ ...p, ...patch }));
    for (const key of Object.keys(patch)) fieldErrors.setError(key as MaintenanceField, null);
  };
  const isDirty = showModal && JSON.stringify(formData) !== JSON.stringify(baseline);

  // A new filter or search starts again from the first page, so nobody is
  // left on page 4 of a result set that now has one page. Set in the same
  // update as the filter, so the stale page is never requested.
  const appliedSearchRef = useRef('');
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const next = searchQuery.trim();
      if (next === appliedSearchRef.current) return;
      appliedSearchRef.current = next;
      setAppliedSearch(next);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  const changeStatusFilter = useCallback((next: StatusFilter) => {
    setStatusFilter(next);
    setPage(1);
  }, []);

  // Responses can land out of order; only the latest request may write.
  const requestSeq = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void facilitiesService
      .getMaintenanceTypes()
      .then((types) => {
        if (!cancelled) setMaintenanceTypes(types);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const loadRecords = useCallback(async () => {
    const seq = ++requestSeq.current;
    setIsLoading(true);
    setLoadError(false);
    try {
      // Status, search and paging are all applied by the server (FAC2-5). The
      // old list endpoint returned the 100 most recently created records and
      // the screen filtered those, so an old overdue record or a vendor named
      // only on an older record was missing with no sign the list was partial.
      const params: Parameters<typeof facilitiesService.getMaintenancePage>[0] = {
        skip: (page - 1) * MAINTENANCE_PAGE_SIZE,
        limit: MAINTENANCE_PAGE_SIZE,
      };
      if (facilityId) params.facility_id = facilityId;
      if (statusFilter === 'completed') params.is_completed = true;
      if (statusFilter === 'pending') params.is_completed = false;
      if (statusFilter === 'overdue') params.is_overdue = true;
      if (statusFilter === 'due') params.due_within_days = MAINTENANCE_DUE_WINDOW_DAYS;
      if (appliedSearch) params.search = appliedSearch;
      const result = await facilitiesService.getMaintenancePage(params);
      if (seq !== requestSeq.current) return;
      setRecords(result.items);
      setTotal(result.total);
    } catch {
      if (seq !== requestSeq.current) return;
      setLoadError(true);
      toast.error('Failed to load maintenance records');
    } finally {
      if (seq === requestSeq.current) setIsLoading(false);
    }
  }, [facilityId, statusFilter, appliedSearch, page]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  // The server already filtered by status; repeating it here keeps a filter
  // change from showing the previous filter's rows while the request is out.
  const filtered = records.filter((r) => {
    if (statusFilter === 'completed' && !r.isCompleted) return false;
    if (statusFilter === 'pending' && r.isCompleted) return false;
    if (statusFilter === 'overdue' && !r.isOverdue) return false;
    if (statusFilter === 'due' && (r.isCompleted || r.isOverdue)) return false;
    return true;
  });

  const openCreate = (defaultFacilityId?: string) => {
    setEditingRecord(null);
    const seeded = emptyForm(defaultFacilityId || facilityId);
    setFormData(seeded);
    setBaseline(seeded);
    fieldErrors.clear();
    setShowModal(true);
  };

  const openEdit = (record: MaintenanceRecord) => {
    setEditingRecord(record);
    const seeded = recordToForm(record);
    setFormData(seeded);
    setBaseline(seeded);
    fieldErrors.clear();
    setShowModal(true);
  };

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    // Each missing answer is named on its field rather than in a toast that
    // vanished (forms review F-3).
    const problems: FieldErrors<MaintenanceField> = {};
    if (!facilityId && !formData.facility_id) problems.facility_id = 'Choose the facility this record is for.';
    if (!formData.description.trim()) problems.description = 'Describe the maintenance work.';
    // The server refuses a record with no type (its column is NOT NULL), and
    // that refusal used to arrive as a bare "Failed to save record".
    if (!formData.maintenance_type_id) problems.maintenance_type_id = 'Choose a maintenance type.';
    const cost = formData.cost.trim();
    if (cost && !(Number.isFinite(Number(cost)) && Number(cost) >= 0))
      problems.cost = 'Enter an amount of 0 or more, or leave it empty.';
    fieldErrors.setFormError(
      problems.maintenance_type_id && maintenanceTypes.length === 0
        ? 'No maintenance types are set up yet. Add one in facility settings, then save again.'
        : null
    );
    fieldErrors.setErrors(problems);
    // A new record is not created until every field is fixed. An edit saves
    // the rest and keeps a refused field's stored value (owner rule,
    // 2026-11-05) - except the facility and type, which the record cannot
    // lack, and which an edit has from the stored row anyway.
    if (!editingRecord && Object.keys(problems).length > 0) {
      fieldErrors.focusFirst(problems);
      return;
    }
    setIsSaving(true);
    try {
      const payload = formToPayload(formData, Boolean(editingRecord));
      if (editingRecord) {
        const { refused } = await saveExceptRefused<MaintenanceField, unknown>({
          payload: { ...payload },
          refused: problems,
          send: (body) => facilitiesService.updateMaintenanceRecord(editingRecord.id, body),
          place: (err) => placeApiError(fieldSpecs, err),
        });
        const first = firstRefused(fieldOrder, refused);
        if (first) {
          // The list refreshes behind the dialog, which stays open with the
          // refused field flagged; only that field still counts as unsaved.
          void loadRecords();
          fieldErrors.setErrors(refused);
          fieldErrors.setFormError(
            `Record saved, except ${MAINTENANCE_LABELS[first].toLowerCase()}. Fix it and save again.`
          );
          fieldErrors.focusFirst(refused);
          const keep = Object.fromEntries(Object.keys(refused).map((k) => [k, baseline[k as MaintenanceField]]));
          setBaseline({ ...formData, ...keep });
          return;
        }
        toast.success('Record updated');
      } else {
        await facilitiesService.createMaintenanceRecord(payload);
        toast.success('Record created');
      }
      setShowModal(false);
      void loadRecords();
    } catch (err: unknown) {
      // A refused field is flagged on that field (forms review F-2); a reason
      // no field answers for ("due date cannot be before the scheduled date")
      // is said in the dialog, where it stays until the next save.
      const placed = fieldErrors.setFromApiError(err, 'Failed to save record');
      fieldErrors.focusFirst(placed);
    } finally {
      setIsSaving(false);
    }
  };

  const handleComplete = async (record: MaintenanceRecord) => {
    try {
      await facilitiesService.updateMaintenanceRecord(record.id, {
        is_completed: true,
        completed_date: getTodayLocalDate(tz),
      });
      toast.success('Marked as completed');
      void loadRecords();
    } catch {
      toast.error('Failed to mark record completed');
    }
  };

  const handleDelete = async (record: MaintenanceRecord) => {
    if (
      !(await confirm({
        title: 'Delete maintenance record',
        message: 'The record and its cost, vendor and work-order details are removed for good.',
        confirmLabel: 'Delete',
        cancelLabel: 'Keep it',
      }))
    )
      return;
    try {
      await facilitiesService.deleteMaintenanceRecord(record.id);
      toast.success('Record deleted');
      void loadRecords();
    } catch {
      toast.error('Failed to delete record');
    }
  };

  return {
    records: filtered,
    allRecords: records,
    maintenanceTypes,
    isLoading,
    loadError,
    reload: loadRecords,
    page,
    setPage,
    total,
    pageSize: MAINTENANCE_PAGE_SIZE,
    searchQuery,
    setSearchQuery,
    statusFilter,
    setStatusFilter: changeStatusFilter,
    showModal,
    setShowModal,
    editingRecord,
    isSaving,
    formData,
    setFormData,
    setField,
    isDirty,
    fieldSpecs,
    errors: fieldErrors.errors,
    formError: fieldErrors.formError,
    openCreate,
    openEdit,
    handleSave,
    handleComplete,
    handleDelete,
  };
}
