/**
 * FieldEditor - Modal for configuring a form field's properties.
 *
 * Used by FormBuilder to add or edit fields. Supports all 16 field types
 * with type-specific configuration panels (options for select/radio/checkbox,
 * min/max for number, validation patterns, etc.).
 */
import { useState, useEffect } from 'react';
import { X, Plus, Trash2, GripVertical } from 'lucide-react';
import type { FormFieldCreate, FormFieldOption } from '../../services/api';

const FIELD_TYPES = [
  { value: 'text', label: 'Text', icon: 'Aa' },
  { value: 'textarea', label: 'Text Area', icon: '¶' },
  { value: 'email', label: 'Email', icon: '@' },
  { value: 'phone', label: 'Phone', icon: '☎' },
  { value: 'number', label: 'Number', icon: '#' },
  { value: 'date', label: 'Date', icon: '📅' },
  { value: 'time', label: 'Time', icon: '⏰' },
  { value: 'datetime', label: 'Date & Time', icon: '📆' },
  { value: 'select', label: 'Dropdown', icon: '▾' },
  { value: 'multiselect', label: 'Multi-Select', icon: '☑' },
  { value: 'checkbox', label: 'Checkboxes', icon: '☐' },
  { value: 'radio', label: 'Radio Buttons', icon: '◉' },
  { value: 'member_lookup', label: 'Member Lookup', icon: '👤' },
  { value: 'section_header', label: 'Section Header', icon: '—' },
  { value: 'file', label: 'File Upload', icon: '📎' },
  { value: 'signature', label: 'Signature', icon: '✍' },
];

const WIDTH_OPTIONS = [
  { value: 'full', label: 'Full Width' },
  { value: 'half', label: 'Half Width' },
  { value: 'third', label: 'One Third' },
];

const NEEDS_OPTIONS = ['select', 'multiselect', 'checkbox', 'radio'];

export interface FieldEditorProps {
  /** Existing field data (edit mode) or null (add mode) */
  field?: FormFieldCreate | null;
  /** Called with field data on save */
  onSave: (field: FormFieldCreate) => void;
  /** Called when modal is closed */
  onClose: () => void;
  /** Next sort_order for new fields */
  nextSortOrder?: number;
}

const FieldEditor = ({ field, onSave, onClose, nextSortOrder = 0 }: FieldEditorProps) => {
  const isEditing = !!field;

  const [fieldType, setFieldType] = useState(field?.field_type || 'text');
  const [label, setLabel] = useState(field?.label || '');
  const [placeholder, setPlaceholder] = useState(field?.placeholder || '');
  const [helpText, setHelpText] = useState(field?.help_text || '');
  const [defaultValue, setDefaultValue] = useState(field?.default_value || '');
  const [required, setRequired] = useState(field?.required ?? false);
  const [minLength, setMinLength] = useState<number | undefined>(field?.min_length || undefined);
  const [maxLength, setMaxLength] = useState<number | undefined>(field?.max_length || undefined);
  const [options, setOptions] = useState<FormFieldOption[]>(field?.options || [{ value: '', label: '' }]);
  const [width, setWidth] = useState(field?.width || 'full');
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reset form when field prop changes
  useEffect(() => {
    if (field) {
      setFieldType(field.field_type);
      setLabel(field.label);
      setPlaceholder(field.placeholder || '');
      setHelpText(field.help_text || '');
      setDefaultValue(field.default_value || '');
      setRequired(field.required ?? false);
      setMinLength(field.min_length || undefined);
      setMaxLength(field.max_length || undefined);
      setOptions(field.options || [{ value: '', label: '' }]);
      setWidth(field.width || 'full');
    }
  }, [field]);

  const needsOptions = NEEDS_OPTIONS.includes(fieldType);
  const isSectionHeader = fieldType === 'section_header';
  const isNumeric = fieldType === 'number';
  const isTextLike = ['text', 'textarea', 'email', 'phone'].includes(fieldType);

  const addOption = () => {
    setOptions([...options, { value: '', label: '' }]);
  };

  const removeOption = (index: number) => {
    if (options.length <= 1) return;
    setOptions(options.filter((_, i) => i !== index));
  };

  const updateOption = (index: number, key: 'value' | 'label', val: string) => {
    const updated = [...options];
    updated[index] = { ...updated[index], [key]: val };
    // Auto-generate value from label if value is empty
    if (key === 'label' && !updated[index].value) {
      updated[index].value = val.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    }
    setOptions(updated);
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};

    if (!label.trim()) {
      errs.label = 'Label is required';
    }

    if (needsOptions) {
      const validOptions = options.filter((o) => o.label.trim() && o.value.trim());
      if (validOptions.length === 0) {
        errs.options = 'At least one option is required';
      }
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;

    const fieldData: FormFieldCreate = {
      label: label.trim(),
      field_type: fieldType,
      sort_order: field?.sort_order ?? nextSortOrder,
      width,
    };

    if (!isSectionHeader) {
      fieldData.required = required;
      if (placeholder.trim()) fieldData.placeholder = placeholder.trim();
      if (helpText.trim()) fieldData.help_text = helpText.trim();
      if (defaultValue.trim()) fieldData.default_value = defaultValue.trim();

      if (isTextLike) {
        if (minLength) fieldData.min_length = minLength;
        if (maxLength) fieldData.max_length = maxLength;
      }

      if (needsOptions) {
        fieldData.options = options.filter((o) => o.label.trim() && o.value.trim());
      }
    } else {
      // Section header only needs label and help_text
      if (helpText.trim()) fieldData.help_text = helpText.trim();
    }

    onSave(fieldData);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-slate-800 border border-white/20 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-slate-800 border-b border-white/10 px-6 py-4 flex items-center justify-between z-10">
          <h3 className="text-lg font-semibold text-white">
            {isEditing ? 'Edit Field' : 'Add Field'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Field Type Selector */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Field Type</label>
            <div className="grid grid-cols-4 gap-2">
              {FIELD_TYPES.map((ft) => (
                <button
                  key={ft.value}
                  type="button"
                  onClick={() => setFieldType(ft.value)}
                  className={`px-2 py-2 rounded-lg text-xs font-medium text-center transition-colors ${
                    fieldType === ft.value
                      ? 'bg-pink-600 text-white'
                      : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white border border-white/10'
                  }`}
                >
                  <span className="block text-base mb-0.5">{ft.icon}</span>
                  {ft.label}
                </button>
              ))}
            </div>
          </div>

          {/* Label */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              {isSectionHeader ? 'Section Title' : 'Field Label'}
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={isSectionHeader ? 'e.g., Equipment Details' : 'e.g., Full Name'}
              className={`w-full px-3 py-2 bg-white/5 border rounded-lg text-white placeholder-slate-500 focus:ring-2 focus:ring-pink-500 focus:border-pink-500 ${
                errors.label ? 'border-red-500/50' : 'border-white/20'
              }`}
            />
            {errors.label && <p className="text-xs text-red-400 mt-1">{errors.label}</p>}
          </div>

          {/* Help Text (all types) */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              {isSectionHeader ? 'Subtitle (optional)' : 'Help Text (optional)'}
            </label>
            <input
              type="text"
              value={helpText}
              onChange={(e) => setHelpText(e.target.value)}
              placeholder="Additional instructions for this field"
              className="w-full px-3 py-2 bg-white/5 border border-white/20 rounded-lg text-white placeholder-slate-500 focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
            />
          </div>

          {/* Non-section-header fields */}
          {!isSectionHeader && (
            <>
              {/* Placeholder */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Placeholder (optional)</label>
                <input
                  type="text"
                  value={placeholder}
                  onChange={(e) => setPlaceholder(e.target.value)}
                  placeholder="Placeholder text..."
                  className="w-full px-3 py-2 bg-white/5 border border-white/20 rounded-lg text-white placeholder-slate-500 focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                />
              </div>

              {/* Default Value */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Default Value (optional)</label>
                <input
                  type="text"
                  value={defaultValue}
                  onChange={(e) => setDefaultValue(e.target.value)}
                  placeholder="Pre-filled value"
                  className="w-full px-3 py-2 bg-white/5 border border-white/20 rounded-lg text-white placeholder-slate-500 focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                />
              </div>

              {/* Required + Width row */}
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={required}
                    onChange={(e) => setRequired(e.target.checked)}
                    className="w-4 h-4 text-pink-600 rounded"
                  />
                  <span className="text-sm text-slate-300">Required</span>
                </label>

                <div className="flex-1">
                  <select
                    value={width}
                    onChange={(e) => setWidth(e.target.value)}
                    className="w-full px-3 py-2 bg-white/5 border border-white/20 rounded-lg text-white focus:ring-2 focus:ring-pink-500 focus:border-pink-500 text-sm"
                  >
                    {WIDTH_OPTIONS.map((w) => (
                      <option key={w.value} value={w.value}>{w.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Text validation */}
              {isTextLike && (
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-slate-400 mb-1">Min Length</label>
                    <input
                      type="number"
                      value={minLength ?? ''}
                      onChange={(e) => setMinLength(e.target.value ? Number(e.target.value) : undefined)}
                      min={0}
                      className="w-full px-3 py-2 bg-white/5 border border-white/20 rounded-lg text-white text-sm focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-slate-400 mb-1">Max Length</label>
                    <input
                      type="number"
                      value={maxLength ?? ''}
                      onChange={(e) => setMaxLength(e.target.value ? Number(e.target.value) : undefined)}
                      min={0}
                      className="w-full px-3 py-2 bg-white/5 border border-white/20 rounded-lg text-white text-sm focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                    />
                  </div>
                </div>
              )}

              {/* Number validation */}
              {isNumeric && (
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-slate-400 mb-1">Min Value</label>
                    <input
                      type="number"
                      value={defaultValue}
                      onChange={(e) => setDefaultValue(e.target.value)}
                      className="w-full px-3 py-2 bg-white/5 border border-white/20 rounded-lg text-white text-sm focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                      placeholder="No minimum"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-slate-400 mb-1">Max Value</label>
                    <input
                      type="number"
                      className="w-full px-3 py-2 bg-white/5 border border-white/20 rounded-lg text-white text-sm focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                      placeholder="No maximum"
                    />
                  </div>
                </div>
              )}

              {/* Options editor (select, multiselect, checkbox, radio) */}
              {needsOptions && (
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Options</label>
                  {errors.options && <p className="text-xs text-red-400 mb-2">{errors.options}</p>}
                  <div className="space-y-2">
                    {options.map((opt, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <GripVertical className="w-4 h-4 text-slate-600 flex-shrink-0" />
                        <input
                          type="text"
                          value={opt.label}
                          onChange={(e) => updateOption(i, 'label', e.target.value)}
                          placeholder="Option label"
                          className="flex-1 px-3 py-1.5 bg-white/5 border border-white/20 rounded-lg text-white text-sm placeholder-slate-500 focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                        />
                        <input
                          type="text"
                          value={opt.value}
                          onChange={(e) => updateOption(i, 'value', e.target.value)}
                          placeholder="value"
                          className="w-28 px-3 py-1.5 bg-white/5 border border-white/20 rounded-lg text-white text-sm placeholder-slate-500 focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                        />
                        <button
                          type="button"
                          onClick={() => removeOption(i)}
                          disabled={options.length <= 1}
                          className="p-1 text-slate-500 hover:text-red-400 disabled:opacity-30"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={addOption}
                    className="mt-2 flex items-center gap-1 text-xs text-pink-400 hover:text-pink-300"
                  >
                    <Plus className="w-3 h-3" />
                    Add Option
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-slate-800 border-t border-white/10 px-6 py-4 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-5 py-2 bg-pink-600 hover:bg-pink-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {isEditing ? 'Update Field' : 'Add Field'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default FieldEditor;
