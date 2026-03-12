/**
 * FormBuilder - Full form field designer with add, edit, delete, and reorder.
 *
 * Embeddable in any module. Can work with the backend formsService or
 * in a standalone mode for local field management.
 *
 * Usage (connected to backend):
 *   <FormBuilder formId="uuid" />
 *
 * Usage (standalone / local):
 *   <FormBuilder
 *     fields={localFields}
 *     onFieldsChange={(fields) => setLocalFields(fields)}
 *   />
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Pencil, Trash2, GripVertical, ChevronUp, ChevronDown,
  Eye, EyeOff, RefreshCw, AlertCircle, Type, Hash, Mail, Phone,
  Calendar, Clock, List, CheckSquare, CircleDot, Users, Minus, FileText, PenTool,
  GitBranch, Copy,
} from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import FieldEditor from './FieldEditor';
import type { SiblingField } from './FieldEditor';
import { formsService } from '../../services/api';
import type { FormField, FormFieldCreate } from '../../services/api';
import type { FieldDefinition } from './FieldRenderer';
import { FieldType } from '../../constants/enums';

/** Field types that require at least one option to function. */
const OPTION_FIELD_TYPES = new Set(['select', 'multiselect', 'checkbox', 'radio']);

/** Returns a human-readable warning if a field is incomplete, or null if OK. */
const getFieldWarning = (field: { field_type: string; options?: unknown[] | null | undefined; label?: string | undefined }): string | null => {
  if (OPTION_FIELD_TYPES.has(field.field_type)) {
    const validOptions = (field.options ?? []).filter((o) => {
      if (typeof o === 'object' && o !== null && 'label' in o && 'value' in o) {
        const opt = o as { label: string; value: string };
        return opt.label.trim() && opt.value.trim();
      }
      return false;
    });
    if (validOptions.length === 0) {
      return 'Needs options — click Edit to add choices';
    }
  }
  if (!field.label?.trim()) {
    return 'Missing label';
  }
  return null;
};

const FIELD_TYPE_ICONS: Record<string, React.ReactNode> = {
  text: <Type className="w-4 h-4" />,
  textarea: <FileText className="w-4 h-4" />,
  email: <Mail className="w-4 h-4" />,
  phone: <Phone className="w-4 h-4" />,
  number: <Hash className="w-4 h-4" />,
  date: <Calendar className="w-4 h-4" />,
  time: <Clock className="w-4 h-4" />,
  datetime: <Calendar className="w-4 h-4" />,
  select: <List className="w-4 h-4" />,
  multiselect: <CheckSquare className="w-4 h-4" />,
  checkbox: <CheckSquare className="w-4 h-4" />,
  radio: <CircleDot className="w-4 h-4" />,
  member_lookup: <Users className="w-4 h-4" />,
  section_header: <Minus className="w-4 h-4" />,
  file: <FileText className="w-4 h-4" />,
  signature: <PenTool className="w-4 h-4" />,
};

export interface FormBuilderProps {
  /** Backend form ID — fields are loaded/saved via API */
  formId?: string;
  /** Direct field management (standalone mode) */
  fields?: FieldDefinition[];
  /** Called when fields change in standalone mode */
  onFieldsChange?: (fields: FieldDefinition[]) => void;
  /** Show preview toggle */
  showPreview?: boolean;
  /** Compact mode */
  compact?: boolean;
}

/** Props for each sortable field row. */
interface SortableFieldRowProps {
  field: FormField | FieldDefinition;
  idx: number;
  totalFields: number;
  warning: string | null;
  onEdit: (field: FormField | FieldDefinition) => void;
  onDelete: (fieldId: string) => void;
  onDuplicate: (field: FormField | FieldDefinition) => void;
  onReorder: (fieldId: string, direction: 'up' | 'down') => void;
}

const SortableFieldRow = ({ field, idx, totalFields, warning, onEdit, onDelete, onDuplicate, onReorder }: SortableFieldRowProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`card-secondary flex gap-3 group items-center px-4 py-3 transition-colors ${
        warning
          ? 'border-yellow-500/40 hover:border-yellow-500/60 bg-yellow-500/5'
          : 'hover:border-theme-surface-border'
      }`}
    >
      {/* Drag handle */}
      <div
        className="text-theme-text-muted shrink-0 cursor-grab active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="w-4 h-4" />
      </div>

      {/* Type icon */}
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
        warning
          ? 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400'
          : 'bg-theme-surface text-theme-text-muted'
      }`}>
        {FIELD_TYPE_ICONS[field.field_type] || <Type className="w-4 h-4" />}
      </div>

      {/* Field info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-theme-text-primary truncate">{field.label}</span>
          {field.required && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-red-500/20 text-red-700 dark:text-red-400 font-medium">Required</span>
          )}
          {field.width !== 'full' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-theme-surface text-theme-text-muted">{field.width}</span>
          )}
          {field.condition_field_id && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-purple-500/20 text-purple-700 dark:text-purple-400 font-medium flex items-center gap-0.5">
              <GitBranch className="w-2.5 h-2.5" />
              Conditional
            </span>
          )}
          {warning && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 font-medium flex items-center gap-0.5">
              <AlertCircle className="w-2.5 h-2.5" />
              Needs setup
            </span>
          )}
        </div>
        <span className="text-xs text-theme-text-muted">{field.field_type}</span>
        {warning && (
          <button
            type="button"
            onClick={() => onEdit(field)}
            className="block text-xs text-yellow-700 dark:text-yellow-400 hover:underline mt-0.5"
          >
            {warning}
          </button>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={() => { onReorder(field.id, 'up'); }}
          disabled={idx === 0}
          className="p-1 text-theme-text-muted hover:text-theme-text-primary disabled:opacity-30"
          title="Move up"
          aria-label={`Move ${field.label} up`}
        >
          <ChevronUp className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => { onReorder(field.id, 'down'); }}
          disabled={idx === totalFields - 1}
          className="p-1 text-theme-text-muted hover:text-theme-text-primary disabled:opacity-30"
          title="Move down"
          aria-label={`Move ${field.label} down`}
        >
          <ChevronDown className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => onDuplicate(field)}
          className="p-1 text-theme-text-muted hover:text-theme-text-primary"
          title="Duplicate field"
          aria-label={`Duplicate ${field.label}`}
        >
          <Copy className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => onEdit(field)}
          className="p-1 text-theme-text-muted hover:text-cyan-700 dark:hover:text-cyan-400"
          title="Edit field"
          aria-label={`Edit ${field.label}`}
        >
          <Pencil className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => { onDelete(field.id); }}
          className="p-1 text-theme-text-muted hover:text-red-700 dark:hover:text-red-400"
          title="Delete field"
          aria-label={`Delete ${field.label}`}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

const FormBuilder = ({
  formId,
  fields: externalFields,
  onFieldsChange,
  showPreview = true,
  compact = false,
}: FormBuilderProps) => {
  const [fields, setFields] = useState<(FormField | FieldDefinition)[]>(externalFields || []);
  const [loading, setLoading] = useState(!!formId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingField, setEditingField] = useState<FormFieldCreate | null>(null);
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);

  const isConnected = !!formId;

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Load fields from backend
  useEffect(() => {
    if (formId) {
      void loadFields();
    }
  }, [formId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync external fields
  useEffect(() => {
    if (externalFields) {
      setFields(externalFields);
    }
  }, [externalFields]);

  const loadFields = async () => {
    if (!formId) return;
    try {
      setLoading(true);
      setError(null);
      const form = await formsService.getForm(formId);
      setFields(form.fields);
    } catch {
      setError('Failed to load form fields.');
    } finally {
      setLoading(false);
    }
  };

  const sortedFields = [...fields].sort((a, b) => a.sort_order - b.sort_order);
  const incompleteCount = sortedFields.filter((f) => getFieldWarning(f) !== null).length;

  const handleAddField = () => {
    setEditingField(null);
    setEditingFieldId(null);
    setEditorOpen(true);
  };

  const handleEditField = (field: FormField | FieldDefinition) => {
    setEditingField({
      label: field.label,
      field_type: field.field_type,
      placeholder: field.placeholder ?? undefined,
      help_text: field.help_text ?? undefined,
      default_value: field.default_value ?? undefined,
      required: field.required,
      min_length: field.min_length ?? undefined,
      max_length: field.max_length ?? undefined,
      validation_pattern: field.validation_pattern ?? undefined,
      options: field.options ?? undefined,
      condition_field_id: field.condition_field_id ?? undefined,
      condition_operator: field.condition_operator ?? undefined,
      condition_value: field.condition_value ?? undefined,
      sort_order: field.sort_order,
      width: field.width,
    });
    setEditingFieldId(field.id);
    setEditorOpen(true);
  };

  const handleDuplicateField = async (field: FormField | FieldDefinition) => {
    const fieldData: FormFieldCreate = {
      label: `${field.label} (copy)`,
      field_type: field.field_type,
      placeholder: field.placeholder ?? undefined,
      help_text: field.help_text ?? undefined,
      default_value: field.default_value ?? undefined,
      required: field.required,
      min_length: field.min_length ?? undefined,
      max_length: field.max_length ?? undefined,
      validation_pattern: field.validation_pattern ?? undefined,
      options: field.options ? [...field.options] : undefined,
      width: field.width,
      sort_order: field.sort_order + 1,
    };

    // Bump sort_order on all fields after the duplicated one
    const reindexed = fields.map((f) =>
      f.sort_order > field.sort_order ? { ...f, sort_order: f.sort_order + 1 } : f
    );

    if (isConnected) {
      try {
        setSaving(true);
        await formsService.addField(formId, fieldData);
        await loadFields();
      } catch {
        setError('Failed to duplicate field.');
      } finally {
        setSaving(false);
      }
    } else {
      const newField: FieldDefinition = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        ...fieldData,
        label: fieldData.label,
        field_type: fieldData.field_type,
        required: fieldData.required ?? false,
        sort_order: fieldData.sort_order ?? fields.length,
        width: fieldData.width || 'full',
      };
      const updated = [...reindexed, newField];
      setFields(updated);
      onFieldsChange?.(updated);
    }
  };

  const handleSaveField = async (fieldData: FormFieldCreate) => {
    setError(null);

    if (isConnected) {
      // Backend mode
      try {
        setSaving(true);
        if (editingFieldId) {
          await formsService.updateField(formId, editingFieldId, fieldData);
        } else {
          fieldData.sort_order = fields.length;
          await formsService.addField(formId, fieldData);
        }
        await loadFields();
      } catch {
        setError(editingFieldId ? 'Failed to update field.' : 'Failed to add field.');
        return;
      } finally {
        setSaving(false);
      }
    } else {
      // Standalone mode
      const updated = [...fields];
      if (editingFieldId) {
        const idx = updated.findIndex((f) => f.id === editingFieldId);
        if (idx >= 0) {
          const existing = updated[idx];
          if (existing) {
            updated[idx] = { ...existing, ...fieldData, id: existing.id };
          }
        }
      } else {
        const newField: FieldDefinition = {
          id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          ...fieldData,
          label: fieldData.label,
          field_type: fieldData.field_type,
          required: fieldData.required ?? false,
          sort_order: fieldData.sort_order ?? fields.length,
          width: fieldData.width || 'full',
        };
        updated.push(newField);
      }
      setFields(updated);
      onFieldsChange?.(updated as FieldDefinition[]);
    }

    setEditorOpen(false);
    setEditingField(null);
    setEditingFieldId(null);
  };

  const handleDeleteField = async (fieldId: string) => {
    setError(null);

    if (isConnected) {
      try {
        setSaving(true);
        await formsService.deleteField(formId, fieldId);
        await loadFields();
      } catch {
        setError('Failed to delete field.');
      } finally {
        setSaving(false);
      }
    } else {
      const updated = fields.filter((f) => f.id !== fieldId);
      // Re-index sort orders
      updated.forEach((f, i) => { f.sort_order = i; });
      setFields(updated);
      onFieldsChange?.(updated as FieldDefinition[]);
    }
  };

  const handleReorder = useCallback(async (fieldId: string, direction: 'up' | 'down') => {
    const sorted = [...fields].sort((a, b) => a.sort_order - b.sort_order);
    const idx = sorted.findIndex((f) => f.id === fieldId);
    if (idx < 0) return;

    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;

    // Swap sort_orders
    const fieldA = sorted[idx];
    const fieldB = sorted[swapIdx];
    if (!fieldA || !fieldB) return;
    const tempOrder = fieldA.sort_order;
    fieldA.sort_order = fieldB.sort_order;
    fieldB.sort_order = tempOrder;

    if (isConnected) {
      try {
        setSaving(true);
        await Promise.all([
          formsService.updateField(formId, fieldA.id, { sort_order: fieldA.sort_order }),
          formsService.updateField(formId, fieldB.id, { sort_order: fieldB.sort_order }),
        ]);
        await loadFields();
      } catch {
        setError('Failed to reorder fields.');
      } finally {
        setSaving(false);
      }
    } else {
      setFields([...sorted]);
      onFieldsChange?.([...sorted] as FieldDefinition[]);
    }
  }, [fields, formId, isConnected, onFieldsChange]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const sorted = [...fields].sort((a, b) => a.sort_order - b.sort_order);
    const oldIndex = sorted.findIndex((f) => f.id === active.id);
    const newIndex = sorted.findIndex((f) => f.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    // Reorder the array and reassign sort_order values
    const [moved] = sorted.splice(oldIndex, 1);
    if (!moved) return;
    sorted.splice(newIndex, 0, moved);
    sorted.forEach((f, i) => { f.sort_order = i; });

    if (isConnected) {
      try {
        setSaving(true);
        const fieldIds = sorted.map((f) => f.id);
        await formsService.reorderFields(formId, fieldIds);
        await loadFields();
      } catch {
        setError('Failed to reorder fields.');
      } finally {
        setSaving(false);
      }
    } else {
      setFields([...sorted]);
      onFieldsChange?.([...sorted] as FieldDefinition[]);
    }
  }, [fields, formId, isConnected, onFieldsChange]); // eslint-disable-line react-hooks/exhaustive-deps

  // Loading
  if (loading) {
    return (
      <div className="bg-theme-surface-secondary rounded-lg p-8 text-center">
        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-theme-text-muted" />
        <p className="text-sm text-theme-text-muted">Loading form builder...</p>
      </div>
    );
  }

  return (
    <div>
      {/* Toolbar */}
      <div className={`flex items-center justify-between ${compact ? 'mb-3' : 'mb-4'}`}>
        <div className="flex items-center gap-2">
          <span className="text-sm text-theme-text-muted">
            {fields.length} {fields.length === 1 ? 'field' : 'fields'}
          </span>
          {saving && (
            <span className="flex items-center gap-1 text-xs text-theme-text-muted">
              <RefreshCw className="w-3 h-3 animate-spin" />
              Saving...
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {showPreview && fields.length > 0 && (
            <button
              type="button"
              onClick={() => setPreviewMode(!previewMode)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-theme-text-muted hover:text-theme-text-primary bg-theme-surface-secondary hover:bg-theme-surface-hover rounded-lg transition-colors"
            >
              {previewMode ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {previewMode ? 'Edit' : 'Preview'}
            </button>
          )}
          <button
            type="button"
            onClick={handleAddField}
            className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Field
          </button>
        </div>
      </div>

      {/* Incomplete fields banner */}
      {incompleteCount > 0 && !previewMode && (
        <div className="mb-4 p-3 rounded-lg flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/30">
          <AlertCircle className="w-4 h-4 text-yellow-700 dark:text-yellow-400 shrink-0" />
          <p className="text-sm text-yellow-700 dark:text-yellow-300">
            {incompleteCount} {incompleteCount === 1 ? 'field needs' : 'fields need'} additional setup before this form is ready to use.
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 rounded-lg flex items-center gap-2 bg-red-500/10 border border-red-500/30">
          <AlertCircle className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" />
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          <button onClick={() => setError(null)} className="ml-auto text-red-700 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300">
            <span className="sr-only">Dismiss</span>&times;
          </button>
        </div>
      )}

      {/* Empty state */}
      {sortedFields.length === 0 && (
        <div className="card-secondary border-dashed p-8 text-center">
          <Plus className="w-8 h-8 text-theme-text-muted mx-auto mb-3" />
          <p className="text-theme-text-primary text-sm font-medium mb-1">No fields yet</p>
          <p className="text-theme-text-muted text-sm mb-4">
            Click &quot;Add Field&quot; to start building your form. Choose from text inputs, dropdowns, checkboxes, date pickers, and more.
          </p>
          <button
            type="button"
            onClick={handleAddField}
            className="btn-primary inline-flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Add Your First Field
          </button>
        </div>
      )}

      {/* Field list with drag-and-drop */}
      {sortedFields.length > 0 && !previewMode && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e: DragEndEvent) => { void handleDragEnd(e); }}>
          <SortableContext items={sortedFields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {sortedFields.map((field, idx) => (
                <SortableFieldRow
                  key={field.id}
                  field={field}
                  idx={idx}
                  totalFields={sortedFields.length}
                  warning={getFieldWarning(field)}
                  onEdit={handleEditField}
                  onDelete={(id) => { void handleDeleteField(id); }}
                  onDuplicate={(f) => { void handleDuplicateField(f); }}
                  onReorder={(id, dir) => { void handleReorder(id, dir); }}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Preview mode */}
      {sortedFields.length > 0 && previewMode && (
        <div className="card-secondary p-6">
          <p className="text-xs text-theme-text-muted uppercase tracking-wide mb-4">Preview</p>
          <div className="space-y-4">
            {sortedFields.map((field) => {
              if (field.field_type === FieldType.SECTION_HEADER) {
                return (
                  <div key={field.id} className="border-b border-theme-surface-border pb-2 pt-2">
                    <h3 className="text-lg font-semibold text-theme-text-primary">{field.label}</h3>
                    {field.help_text && <p className="text-sm text-theme-text-muted mt-1">{field.help_text}</p>}
                  </div>
                );
              }
              return (
                <div key={field.id} className={field.width === 'half' ? 'w-1/2 inline-block pr-2 align-top' : field.width === 'third' ? 'w-1/3 inline-block pr-2 align-top' : ''}>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                    {field.label}
                    {field.required && <span className="text-red-700 dark:text-red-400 ml-1">*</span>}
                  </label>
                  {field.help_text && <p className="text-xs text-theme-text-muted mb-1">{field.help_text}</p>}
                  <div className="card-secondary px-3 py-2 text-sm text-theme-text-muted">
                    {field.placeholder || field.field_type}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Field Editor Modal */}
      {editorOpen && (
        <FieldEditor
          field={editingField}
          onSave={(fieldData) => { void handleSaveField(fieldData); }}
          onClose={() => {
            setEditorOpen(false);
            setEditingField(null);
            setEditingFieldId(null);
          }}
          nextSortOrder={fields.length}
          siblingFields={fields.map((f) => ({
            id: f.id,
            label: f.label,
            field_type: f.field_type,
            options: f.options ?? undefined,
          } as SiblingField))}
          editingFieldId={editingFieldId ?? undefined}
        />
      )}
    </div>
  );
};

export default FormBuilder;
