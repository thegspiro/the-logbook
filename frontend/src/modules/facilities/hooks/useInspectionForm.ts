import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import toast from 'react-hot-toast';
import { facilitiesService } from '../../../services/api';
import type { InspectionCreate } from '../../../services/facilitiesServices';
import type { Inspection } from '../types';
import { useTimezone } from '../../../hooks/useTimezone';
import { getTodayLocalDate } from '../../../utils/dateFormatting';
import { formCoercions } from '../../../utils/formValues';
import { placeApiError, useFieldErrors, type FieldErrors, type FieldSpecs } from '../../../hooks/useFieldErrors';
import { firstRefused, saveExceptRefused } from '../../../utils/saveExceptRefused';
import { useConfirm } from '../../../contexts/ConfirmContext';

export interface InspectionFormData {
  facility_id: string;
  inspection_type: string;
  title: string;
  description: string;
  inspection_date: string;
  next_inspection_date: string;
  inspector_name: string;
  inspector_organization: string;
  passed: string;
  findings: string;
  corrective_actions: string;
  corrective_action_deadline: string;
  notes: string;
}

const emptyForm = (tz: string, facilityId?: string): InspectionFormData => ({
  facility_id: facilityId || '',
  inspection_type: 'routine',
  title: '',
  description: '',
  inspection_date: getTodayLocalDate(tz),
  next_inspection_date: '',
  inspector_name: '',
  inspector_organization: '',
  passed: '',
  findings: '',
  corrective_actions: '',
  corrective_action_deadline: '',
  notes: '',
});

function inspectionToForm(insp: Inspection): InspectionFormData {
  return {
    facility_id: insp.facilityId,
    inspection_type: insp.inspectionType || 'routine',
    title: insp.title || '',
    description: insp.description || '',
    inspection_date: insp.inspectionDate || '',
    next_inspection_date: insp.nextInspectionDate || '',
    inspector_name: insp.inspectorName || '',
    inspector_organization: insp.inspectorOrganization || '',
    passed: insp.passed === true ? 'true' : insp.passed === false ? 'false' : '',
    findings: insp.findings || '',
    corrective_actions: insp.correctiveActions || '',
    corrective_action_deadline: insp.correctiveActionDeadline || '',
    notes: insp.notes || '',
  };
}

/**
 * On create a blank optional field is omitted; on edit it goes as an explicit
 * null, because the backend dumps update payloads with `exclude_unset` and an
 * omitted key means "leave this alone" — so clearing an inspector name, a
 * corrective-action deadline or the findings used to be lost behind a success
 * toast (CLAUDE.md pitfall #1).
 *
 * `inspection_type`, `title` and `inspection_date` back NOT NULL columns and
 * are always sent as values; the form requires the latter two.
 */
function formToPayload(formData: InspectionFormData, isEdit: boolean): InspectionCreate {
  const { text, pick } = formCoercions(isEdit);
  return {
    facility_id: formData.facility_id,
    inspection_type: formData.inspection_type,
    title: formData.title.trim(),
    inspection_date: formData.inspection_date,
    passed: formData.passed === 'true' ? true : formData.passed === 'false' ? false : null,
    description: text(formData.description),
    next_inspection_date: pick(formData.next_inspection_date),
    inspector_name: text(formData.inspector_name),
    inspector_organization: text(formData.inspector_organization),
    findings: text(formData.findings),
    corrective_actions: text(formData.corrective_actions),
    corrective_action_deadline: pick(formData.corrective_action_deadline),
    notes: text(formData.notes),
  };
}

export type InspectionField = keyof InspectionFormData;

/** Field labels in screen order, so the first refusal takes focus. */
const INSPECTION_LABELS: Record<InspectionField, string> = {
  facility_id: 'Facility',
  title: 'Title',
  inspection_type: 'Type',
  passed: 'Result',
  inspection_date: 'Inspection date',
  next_inspection_date: 'Next inspection date',
  inspector_name: 'Inspector name',
  inspector_organization: 'Inspector organization',
  description: 'Description',
  findings: 'Findings',
  corrective_actions: 'Corrective actions',
  corrective_action_deadline: 'Corrective action deadline',
  notes: 'Notes',
};

/** Limits mirror FacilityInspectionBase. */
export const INSPECTION_LIMITS = { title: 300, inspector_name: 200, inspector_organization: 200 } as const;

/** The field specs for a dialog whose ids start with `idPrefix`. */
export function inspectionFieldSpecs(idPrefix: string): FieldSpecs<InspectionField> {
  return Object.fromEntries(
    (Object.keys(INSPECTION_LABELS) as InspectionField[]).map((name) => [
      name,
      { id: `${idPrefix}-${name.replace(/_/g, '-')}`, label: INSPECTION_LABELS[name] },
    ])
  ) as FieldSpecs<InspectionField>;
}

type ResultFilter = 'all' | 'passed' | 'failed' | 'pending';

export const INSPECTIONS_PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 250;

interface UseInspectionFormOptions {
  facilityId?: string;
  /** Only inspections whose next date falls from today through this many days ahead. */
  dueWithinDays?: number | undefined;
  /** The prefix of the dialog's field ids, so a refusal can focus its field. */
  idPrefix?: string;
}

export function useInspectionForm({
  facilityId,
  dueWithinDays,
  idPrefix = 'facility-inspection',
}: UseInspectionFormOptions = {}) {
  const { confirm } = useConfirm();
  const tz = useTimezone();
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [appliedSearch, setAppliedSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all');
  const [showModal, setShowModal] = useState(false);
  const [editingInspection, setEditingInspection] = useState<Inspection | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState<InspectionFormData>(emptyForm(tz, facilityId));
  // What the dialog held when it opened (or last saved), so closing asks
  // before throwing typed changes away (forms review F-6).
  const [baseline, setBaseline] = useState<InspectionFormData>(formData);
  const fieldSpecs = useMemo(() => inspectionFieldSpecs(idPrefix), [idPrefix]);
  const fieldOrder = useMemo(() => Object.keys(fieldSpecs) as InspectionField[], [fieldSpecs]);
  const fieldErrors = useFieldErrors(fieldSpecs);
  const setField = (patch: Partial<InspectionFormData>) => {
    setFormData((p) => ({ ...p, ...patch }));
    for (const key of Object.keys(patch)) fieldErrors.setError(key as InspectionField, null);
  };
  const isDirty = showModal && JSON.stringify(formData) !== JSON.stringify(baseline);

  // A new filter or search starts again from the first page, in the same
  // update, so the stale page is never requested.
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

  const changeResultFilter = useCallback((next: ResultFilter) => {
    setResultFilter(next);
    setPage(1);
  }, []);

  // Responses can land out of order; only the latest request may write.
  const requestSeq = useRef(0);

  const loadInspections = useCallback(async () => {
    const seq = ++requestSeq.current;
    setIsLoading(true);
    setLoadError(false);
    try {
      // Result, search and paging run on the server (FAC2-5). The list
      // endpoint could not ask for "pending" at all, and searching the first
      // 100 rows missed anything older.
      const params: Parameters<typeof facilitiesService.getInspectionsPage>[0] = {
        skip: (page - 1) * INSPECTIONS_PAGE_SIZE,
        limit: INSPECTIONS_PAGE_SIZE,
      };
      if (facilityId) params.facility_id = facilityId;
      if (resultFilter !== 'all') params.result = resultFilter;
      if (appliedSearch) params.search = appliedSearch;
      if (dueWithinDays !== undefined) params.due_within_days = dueWithinDays;
      const result = await facilitiesService.getInspectionsPage(params);
      if (seq !== requestSeq.current) return;
      setInspections(result.items);
      setTotal(result.total);
    } catch {
      if (seq !== requestSeq.current) return;
      setLoadError(true);
      toast.error('Failed to load inspections');
    } finally {
      if (seq === requestSeq.current) setIsLoading(false);
    }
  }, [facilityId, resultFilter, appliedSearch, dueWithinDays, page]);

  useEffect(() => {
    void loadInspections();
  }, [loadInspections]);

  // The server already applied the result filter; repeating it keeps a filter
  // change from showing the previous filter's rows while the request is out.
  const filtered = inspections.filter((i) => {
    if (resultFilter === 'passed' && i.passed !== true) return false;
    if (resultFilter === 'failed' && i.passed !== false) return false;
    if (resultFilter === 'pending' && i.passed !== null && i.passed !== undefined) return false;
    return true;
  });

  const openCreate = (defaultFacilityId?: string) => {
    setEditingInspection(null);
    const seeded = emptyForm(tz, defaultFacilityId || facilityId);
    setFormData(seeded);
    setBaseline(seeded);
    fieldErrors.clear();
    setShowModal(true);
  };

  const openEdit = (insp: Inspection) => {
    setEditingInspection(insp);
    const seeded = inspectionToForm(insp);
    setFormData(seeded);
    setBaseline(seeded);
    fieldErrors.clear();
    setShowModal(true);
  };

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    // Each missing answer is named on its field rather than in a toast that
    // vanished (forms review F-3).
    const problems: FieldErrors<InspectionField> = {};
    if (!facilityId && !formData.facility_id) problems.facility_id = 'Choose the facility this inspection is for.';
    if (!formData.title.trim()) problems.title = 'Enter a title for the inspection.';
    if (!formData.inspection_date) problems.inspection_date = 'Enter the date of the inspection.';
    fieldErrors.setFormError(null);
    fieldErrors.setErrors(problems);
    // A new inspection is not created until every field is fixed; an edit
    // saves the rest and keeps a refused field's stored value (owner rule,
    // 2026-11-05).
    if (!editingInspection && Object.keys(problems).length > 0) {
      fieldErrors.focusFirst(problems);
      return;
    }
    setIsSaving(true);
    try {
      const payload = formToPayload(formData, Boolean(editingInspection));
      if (editingInspection) {
        const { refused } = await saveExceptRefused<InspectionField, unknown>({
          payload: { ...payload },
          refused: problems,
          send: (body) => facilitiesService.updateInspection(editingInspection.id, body),
          place: (err) => placeApiError(fieldSpecs, err),
        });
        const first = firstRefused(fieldOrder, refused);
        if (first) {
          // The list refreshes behind the dialog, which stays open with the
          // refused field flagged; only that field still counts as unsaved.
          void loadInspections();
          fieldErrors.setErrors(refused);
          fieldErrors.setFormError(
            `Inspection saved, except ${INSPECTION_LABELS[first].toLowerCase()}. Fix it and save again.`
          );
          fieldErrors.focusFirst(refused);
          const keep = Object.fromEntries(Object.keys(refused).map((k) => [k, baseline[k as InspectionField]]));
          setBaseline({ ...formData, ...keep });
          return;
        }
        toast.success('Inspection updated');
      } else {
        await facilitiesService.createInspection(payload);
        toast.success('Inspection created');
      }
      setShowModal(false);
      void loadInspections();
    } catch (err: unknown) {
      // A refused field is flagged on that field (forms review F-2); anything
      // no field answers for is said in the dialog, where it stays.
      const placed = fieldErrors.setFromApiError(err, 'Failed to save inspection');
      fieldErrors.focusFirst(placed);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (insp: Inspection) => {
    if (
      !(await confirm({
        title: 'Delete inspection',
        message: `Delete "${insp.title}"? Its findings and corrective actions go with it.`,
        confirmLabel: 'Delete',
        cancelLabel: 'Keep it',
      }))
    )
      return;
    try {
      await facilitiesService.deleteInspection(insp.id);
      toast.success('Inspection deleted');
      void loadInspections();
    } catch {
      toast.error('Failed to delete inspection');
    }
  };

  return {
    inspections: filtered,
    allInspections: inspections,
    isLoading,
    loadError,
    reload: loadInspections,
    page,
    setPage,
    total,
    pageSize: INSPECTIONS_PAGE_SIZE,
    searchQuery,
    setSearchQuery,
    resultFilter,
    setResultFilter: changeResultFilter,
    showModal,
    setShowModal,
    editingInspection,
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
    handleDelete,
  };
}
