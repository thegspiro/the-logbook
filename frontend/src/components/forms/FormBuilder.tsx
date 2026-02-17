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
} from 'lucide-react';
import FieldEditor from './FieldEditor';
import { formsService } from '../../services/api';
import type { FormField, FormFieldCreate } from '../../services/api';
import type { FieldDefinition } from './FieldRenderer';

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

  // Load fields from backend
  useEffect(() => {
    if (formId) {
      loadFields();
    }
  }, [formId]);

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

  const handleAddField = () => {
    setEditingField(null);
    setEditingFieldId(null);
    setEditorOpen(true);
  };

  const handleEditField = (field: FormField | FieldDefinition) => {
    setEditingField({
      label: field.label,
      field_type: field.field_type,
      placeholder: field.placeholder || undefined,
      help_text: field.help_text || undefined,
      default_value: field.default_value || undefined,
      required: field.required,
      min_length: field.min_length || undefined,
      max_length: field.max_length || undefined,
      options: field.options || undefined,
      sort_order: field.sort_order,
      width: field.width,
    });
    setEditingFieldId(field.id);
    setEditorOpen(true);
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
          updated[idx] = { ...updated[idx], ...fieldData };
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
    const tempOrder = sorted[idx].sort_order;
    sorted[idx].sort_order = sorted[swapIdx].sort_order;
    sorted[swapIdx].sort_order = tempOrder;

    if (isConnected) {
      try {
        setSaving(true);
        await Promise.all([
          formsService.updateField(formId, sorted[idx].id, { sort_order: sorted[idx].sort_order }),
          formsService.updateField(formId, sorted[swapIdx].id, { sort_order: sorted[swapIdx].sort_order }),
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
  }, [fields, formId, isConnected, onFieldsChange]);

  // Loading
  if (loading) {
    return (
      <div className="bg-theme-surface-secondary rounded-lg p-8 text-center">
        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-pink-700 dark:text-pink-400" />
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
            <span className="flex items-center gap-1 text-xs text-pink-700 dark:text-pink-400">
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
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-pink-600 hover:bg-pink-700 rounded-lg transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Field
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 rounded-lg flex items-center gap-2 bg-red-500/10 border border-red-500/30">
          <AlertCircle className="w-4 h-4 text-red-700 dark:text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          <button onClick={() => setError(null)} className="ml-auto text-red-700 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300">
            <span className="sr-only">Dismiss</span>&times;
          </button>
        </div>
      )}

      {/* Empty state */}
      {sortedFields.length === 0 && (
        <div className="bg-theme-surface-secondary border border-dashed border-theme-surface-border rounded-lg p-8 text-center">
          <Plus className="w-8 h-8 text-theme-text-muted mx-auto mb-2" />
          <p className="text-theme-text-muted text-sm">No fields yet. Click "Add Field" to start building your form.</p>
        </div>
      )}

      {/* Field list */}
      {sortedFields.length > 0 && !previewMode && (
        <div className="space-y-2">
          {sortedFields.map((field, idx) => (
            <div
              key={field.id}
              className="group bg-theme-surface-secondary border border-theme-surface-border rounded-lg px-4 py-3 flex items-center gap-3 hover:border-theme-surface-border transition-colors"
            >
              {/* Drag handle */}
              <div className="text-theme-text-muted flex-shrink-0 cursor-grab">
                <GripVertical className="w-4 h-4" />
              </div>

              {/* Type icon */}
              <div className="w-8 h-8 rounded-lg bg-theme-surface flex items-center justify-center flex-shrink-0 text-theme-text-muted">
                {FIELD_TYPE_ICONS[field.field_type] || <Type className="w-4 h-4" />}
              </div>

              {/* Field info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-theme-text-primary truncate">{field.label}</span>
                  {field.required && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-700 dark:text-red-400 font-medium">Required</span>
                  )}
                  {field.width !== 'full' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-theme-surface text-theme-text-muted">{field.width}</span>
                  )}
                </div>
                <span className="text-xs text-theme-text-muted">{field.field_type}</span>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => handleReorder(field.id, 'up')}
                  disabled={idx === 0}
                  className="p-1 text-theme-text-muted hover:text-theme-text-primary disabled:opacity-30"
                  title="Move up"
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleReorder(field.id, 'down')}
                  disabled={idx === sortedFields.length - 1}
                  className="p-1 text-theme-text-muted hover:text-theme-text-primary disabled:opacity-30"
                  title="Move down"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleEditField(field)}
                  className="p-1 text-theme-text-muted hover:text-cyan-700 dark:hover:text-cyan-400"
                  title="Edit field"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteField(field.id)}
                  className="p-1 text-theme-text-muted hover:text-red-700 dark:hover:text-red-400"
                  title="Delete field"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Preview mode */}
      {sortedFields.length > 0 && previewMode && (
        <div className="bg-theme-surface-secondary border border-theme-surface-border rounded-lg p-6">
          <p className="text-xs text-theme-text-muted uppercase tracking-wide mb-4">Preview</p>
          <div className="space-y-4">
            {sortedFields.map((field) => {
              if (field.field_type === 'section_header') {
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
                  <div className="px-3 py-2 bg-theme-surface-secondary border border-theme-surface-border rounded-lg text-theme-text-muted text-sm">
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
          onSave={handleSaveField}
          onClose={() => {
            setEditorOpen(false);
            setEditingField(null);
            setEditingFieldId(null);
          }}
          nextSortOrder={fields.length}
        />
      )}
    </div>
  );
};

export default FormBuilder;
