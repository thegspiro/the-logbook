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
  Plus,
  Pencil,
  Trash2,
  GripVertical,
  ChevronUp,
  ChevronDown,
  Eye,
  EyeOff,
  RefreshCw,
  AlertCircle,
  Type,
  Hash,
  Mail,
  Phone,
  Calendar,
  Clock,
  List,
  CheckSquare,
  CircleDot,
  Users,
  Minus,
  FileText,
  PenTool,
  GitBranch,
  Copy,
} from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
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
const getFieldWarning = (field: {
  field_type: string;
  options?: unknown[] | null | undefined;
  label?: string | undefined;
}): string | null => {
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
  text: <Type className="h-4 w-4" />,
  textarea: <FileText className="h-4 w-4" />,
  email: <Mail className="h-4 w-4" />,
  phone: <Phone className="h-4 w-4" />,
  number: <Hash className="h-4 w-4" />,
  date: <Calendar className="h-4 w-4" />,
  time: <Clock className="h-4 w-4" />,
  datetime: <Calendar className="h-4 w-4" />,
  select: <List className="h-4 w-4" />,
  multiselect: <CheckSquare className="h-4 w-4" />,
  checkbox: <CheckSquare className="h-4 w-4" />,
  radio: <CircleDot className="h-4 w-4" />,
  member_lookup: <Users className="h-4 w-4" />,
  section_header: <Minus className="h-4 w-4" />,
  file: <FileText className="h-4 w-4" />,
  signature: <PenTool className="h-4 w-4" />,
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

const SortableFieldRow = ({
  field,
  idx,
  totalFields,
  warning,
  onEdit,
  onDelete,
  onDuplicate,
  onReorder,
}: SortableFieldRowProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id });

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
      className={`card-secondary group flex items-center gap-3 px-4 py-3 transition-colors ${
        warning
          ? 'border-yellow-500/40 bg-yellow-500/5 hover:border-yellow-500/60'
          : 'hover:border-theme-surface-border'
      }`}
    >
      {/* Drag handle */}
      <div className="text-theme-text-muted shrink-0 cursor-grab active:cursor-grabbing" {...attributes} {...listeners}>
        <GripVertical className="h-4 w-4" />
      </div>

      {/* Type icon */}
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
          warning ? 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400' : 'bg-theme-surface text-theme-text-muted'
        }`}
      >
        {FIELD_TYPE_ICONS[field.field_type] || <Type className="h-4 w-4" />}
      </div>

      {/* Field info */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-theme-text-primary truncate text-sm font-medium">{field.label}</span>
          {field.required && (
            <span className="rounded-sm bg-red-500/20 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:text-red-400">
              Required
            </span>
          )}
          {field.width !== 'full' && (
            <span className="bg-theme-surface text-theme-text-muted rounded-sm px-1.5 py-0.5 text-[10px]">
              {field.width}
            </span>
          )}
          {field.condition_field_id && (
            <span className="flex items-center gap-0.5 rounded-sm bg-purple-500/20 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 dark:text-purple-400">
              <GitBranch className="h-2.5 w-2.5" />
              Conditional
            </span>
          )}
          {warning && (
            <span className="flex items-center gap-0.5 rounded-sm bg-yellow-500/20 px-1.5 py-0.5 text-[10px] font-medium text-yellow-700 dark:text-yellow-400">
              <AlertCircle className="h-2.5 w-2.5" />
              Needs setup
            </span>
          )}
        </div>
        <span className="text-theme-text-muted text-xs">{field.field_type}</span>
        {warning && (
          <button
            type="button"
            onClick={() => onEdit(field)}
            className="mt-0.5 block text-xs text-yellow-700 hover:underline dark:text-yellow-400"
          >
            {warning}
          </button>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
        <button
          type="button"
          onClick={() => {
            onReorder(field.id, 'up');
          }}
          disabled={idx === 0}
          className="text-theme-text-muted hover:text-theme-text-primary p-1 disabled:opacity-30"
          title="Move up"
          aria-label={`Move ${field.label} up`}
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => {
            onReorder(field.id, 'down');
          }}
          disabled={idx === totalFields - 1}
          className="text-theme-text-muted hover:text-theme-text-primary p-1 disabled:opacity-30"
          title="Move down"
          aria-label={`Move ${field.label} down`}
        >
          <ChevronDown className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onDuplicate(field)}
          className="text-theme-text-muted hover:text-theme-text-primary p-1"
          title="Duplicate field"
          aria-label={`Duplicate ${field.label}`}
        >
          <Copy className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onEdit(field)}
          className="text-theme-text-muted p-1 hover:text-cyan-700 dark:hover:text-cyan-400"
          title="Edit field"
          aria-label={`Edit ${field.label}`}
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => {
            onDelete(field.id);
          }}
          className="text-theme-text-muted p-1 hover:text-red-700 dark:hover:text-red-400"
          title="Delete field"
          aria-label={`Delete ${field.label}`}
        >
          <Trash2 className="h-4 w-4" />
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
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
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
    const reindexed = fields.map((f) => (f.sort_order > field.sort_order ? { ...f, sort_order: f.sort_order + 1 } : f));

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
      onFieldsChange?.(updated);
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
      updated.forEach((f, i) => {
        f.sort_order = i;
      });
      setFields(updated);
      onFieldsChange?.(updated);
    }
  };

  const handleReorder = useCallback(
    async (fieldId: string, direction: 'up' | 'down') => {
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
    },
    [fields, formId, isConnected, onFieldsChange] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
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
      sorted.forEach((f, i) => {
        f.sort_order = i;
      });

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
    },
    [fields, formId, isConnected, onFieldsChange] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Loading
  if (loading) {
    return (
      <div className="bg-theme-surface-secondary rounded-lg p-8 text-center">
        <RefreshCw className="text-theme-text-muted mx-auto mb-2 h-6 w-6 animate-spin" />
        <p className="text-theme-text-muted text-sm">Loading form builder...</p>
      </div>
    );
  }

  return (
    <div>
      {/* Toolbar */}
      <div className={`flex items-center justify-between ${compact ? 'mb-3' : 'mb-4'}`}>
        <div className="flex items-center gap-2">
          <span className="text-theme-text-muted text-sm">
            {fields.length} {fields.length === 1 ? 'field' : 'fields'}
          </span>
          {saving && (
            <span className="text-theme-text-muted flex items-center gap-1 text-xs">
              <RefreshCw className="h-3 w-3 animate-spin" />
              Saving...
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {showPreview && fields.length > 0 && (
            <button
              type="button"
              onClick={() => setPreviewMode(!previewMode)}
              className="text-theme-text-muted hover:text-theme-text-primary bg-theme-surface-secondary hover:bg-theme-surface-hover flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors"
            >
              {previewMode ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {previewMode ? 'Edit' : 'Preview'}
            </button>
          )}
          <button
            type="button"
            onClick={handleAddField}
            className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Field
          </button>
        </div>
      </div>

      {/* Incomplete fields banner */}
      {incompleteCount > 0 && !previewMode && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3">
          <AlertCircle className="h-4 w-4 shrink-0 text-yellow-700 dark:text-yellow-400" />
          <p className="text-sm text-yellow-700 dark:text-yellow-300">
            {incompleteCount} {incompleteCount === 1 ? 'field needs' : 'fields need'} additional setup before this form
            is ready to use.
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-700 dark:text-red-400" />
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-red-700 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
          >
            <span className="sr-only">Dismiss</span>&times;
          </button>
        </div>
      )}

      {/* Empty state */}
      {sortedFields.length === 0 && (
        <div className="card-secondary border-dashed p-8 text-center">
          <Plus className="text-theme-text-muted mx-auto mb-3 h-8 w-8" />
          <p className="text-theme-text-primary mb-1 text-sm font-medium">No fields yet</p>
          <p className="text-theme-text-muted mb-4 text-sm">
            Click &quot;Add Field&quot; to start building your form. Choose from text inputs, dropdowns, checkboxes,
            date pickers, and more.
          </p>
          <button type="button" onClick={handleAddField} className="btn-primary inline-flex items-center gap-1.5">
            <Plus className="h-4 w-4" />
            Add Your First Field
          </button>
        </div>
      )}

      {/* Field list with drag-and-drop */}
      {sortedFields.length > 0 && !previewMode && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={(e: DragEndEvent) => {
            void handleDragEnd(e);
          }}
        >
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
                  onDelete={(id) => {
                    void handleDeleteField(id);
                  }}
                  onDuplicate={(f) => {
                    void handleDuplicateField(f);
                  }}
                  onReorder={(id, dir) => {
                    void handleReorder(id, dir);
                  }}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Preview mode */}
      {sortedFields.length > 0 && previewMode && (
        <div className="card-secondary p-6">
          <p className="text-theme-text-muted mb-4 text-xs tracking-wide uppercase">Preview</p>
          <div className="space-y-4">
            {sortedFields.map((field) => {
              if (field.field_type === FieldType.SECTION_HEADER) {
                return (
                  <div key={field.id} className="border-theme-surface-border border-b pt-2 pb-2">
                    <h3 className="text-theme-text-primary text-lg font-semibold">{field.label}</h3>
                    {field.help_text && <p className="text-theme-text-muted mt-1 text-sm">{field.help_text}</p>}
                  </div>
                );
              }
              return (
                <div
                  key={field.id}
                  className={
                    field.width === 'half'
                      ? 'inline-block w-1/2 pr-2 align-top'
                      : field.width === 'third'
                        ? 'inline-block w-1/3 pr-2 align-top'
                        : ''
                  }
                >
                  <label className="text-theme-text-secondary mb-1 block text-sm font-medium">
                    {field.label}
                    {field.required && <span className="ml-1 text-red-700 dark:text-red-400">*</span>}
                  </label>
                  {field.help_text && <p className="text-theme-text-muted mb-1 text-xs">{field.help_text}</p>}
                  <div className="card-secondary text-theme-text-muted px-3 py-2 text-sm">
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
          onSave={(fieldData) => {
            void handleSaveField(fieldData);
          }}
          onClose={() => {
            setEditorOpen(false);
            setEditingField(null);
            setEditingFieldId(null);
          }}
          nextSortOrder={fields.length}
          siblingFields={fields.map(
            (f) =>
              ({
                id: f.id,
                label: f.label,
                field_type: f.field_type,
                options: f.options ?? undefined,
              }) as SiblingField
          )}
          editingFieldId={editingFieldId ?? undefined}
        />
      )}
    </div>
  );
};

export default FormBuilder;
