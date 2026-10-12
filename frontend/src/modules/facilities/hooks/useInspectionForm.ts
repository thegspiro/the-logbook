import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { facilitiesService } from '../../../services/api';
import type { InspectionCreate } from '../../../services/facilitiesServices';
import type { Inspection } from '../types';
import { useTimezone } from '../../../hooks/useTimezone';
import { getTodayLocalDate } from '../../../utils/dateFormatting';
import { formCoercions } from '../../../utils/formValues';

import { useConfirm } from '../../../contexts/ConfirmContext';
interface InspectionFormData {
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

type ResultFilter = 'all' | 'passed' | 'failed' | 'pending';

interface UseInspectionFormOptions {
  facilityId?: string;
}

export function useInspectionForm({ facilityId }: UseInspectionFormOptions = {}) {
  const { confirm } = useConfirm();
  const tz = useTimezone();
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all');
  const [showModal, setShowModal] = useState(false);
  const [editingInspection, setEditingInspection] = useState<Inspection | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState<InspectionFormData>(emptyForm(tz, facilityId));

  const loadInspections = useCallback(async () => {
    setIsLoading(true);
    setLoadError(false);
    try {
      const params: { facility_id?: string } = {};
      if (facilityId) params.facility_id = facilityId;
      const data = await facilitiesService.getInspections(params);
      setInspections(data);
    } catch {
      setLoadError(true);
      toast.error('Failed to load inspections');
    } finally {
      setIsLoading(false);
    }
  }, [facilityId]);

  useEffect(() => {
    void loadInspections();
  }, [loadInspections]);

  const filtered = inspections.filter((i) => {
    if (resultFilter === 'passed' && i.passed !== true) return false;
    if (resultFilter === 'failed' && i.passed !== false) return false;
    if (resultFilter === 'pending' && i.passed !== null && i.passed !== undefined) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return !!(
        i.title?.toLowerCase().includes(q) ||
        i.inspectorName?.toLowerCase().includes(q) ||
        i.inspectorOrganization?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const openCreate = (defaultFacilityId?: string) => {
    setEditingInspection(null);
    setFormData(emptyForm(tz, defaultFacilityId || facilityId));
    setShowModal(true);
  };

  const openEdit = (insp: Inspection) => {
    setEditingInspection(insp);
    setFormData(inspectionToForm(insp));
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!facilityId && !formData.facility_id) {
      toast.error('Select a facility');
      return;
    }
    if (!formData.title.trim()) {
      toast.error('Title is required');
      return;
    }
    if (!formData.inspection_date) {
      toast.error('Inspection date is required');
      return;
    }
    setIsSaving(true);
    try {
      const payload = formToPayload(formData, Boolean(editingInspection));
      if (editingInspection) {
        await facilitiesService.updateInspection(editingInspection.id, payload);
        toast.success('Inspection updated');
      } else {
        await facilitiesService.createInspection(payload);
        toast.success('Inspection created');
      }
      setShowModal(false);
      void loadInspections();
    } catch {
      toast.error('Failed to save inspection');
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
    searchQuery,
    setSearchQuery,
    resultFilter,
    setResultFilter,
    showModal,
    setShowModal,
    editingInspection,
    isSaving,
    formData,
    setFormData,
    openCreate,
    openEdit,
    handleSave,
    handleDelete,
  };
}
