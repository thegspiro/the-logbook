/**
 * FieldRenderer - Renders a single form field based on its type.
 *
 * Reusable across modules: Forms, Scheduling (shift checkout),
 * Training (updates), Inventory (equipment checks), etc.
 *
 * Supports all 16 field types: text, textarea, email, phone, number,
 * date, time, datetime, select, multiselect, checkbox, radio,
 * file (stub), signature (stub), section_header, member_lookup.
 */
import { useState } from 'react';
import { Search, User } from 'lucide-react';
import { formsService } from '../../services/api';
import type { MemberLookupResult } from '../../services/api';

export interface FieldDefinition {
  id: string;
  label: string;
  field_type: string;
  placeholder?: string;
  help_text?: string;
  default_value?: string;
  required: boolean;
  min_length?: number;
  max_length?: number;
  min_value?: number;
  max_value?: number;
  validation_pattern?: string;
  options?: { value: string; label: string }[];
  sort_order: number;
  width: string;
}

export interface FieldRendererProps {
  field: FieldDefinition;
  value: string;
  onChange: (fieldId: string, value: string) => void;
  /** Use dark theme (internal app) or light theme (public forms). Default: dark */
  theme?: 'dark' | 'light';
  disabled?: boolean;
  error?: string;
}

const FieldRenderer = ({ field, value, onChange, theme = 'dark', disabled = false, error }: FieldRendererProps) => {
  const [memberResults, setMemberResults] = useState<MemberLookupResult[]>([]);
  const [memberQuery, setMemberQuery] = useState('');
  const [searchingMembers, setSearchingMembers] = useState(false);

  const isDark = theme === 'dark';

  const inputClass = isDark
    ? `w-full px-3 py-2 bg-white/5 border rounded-lg text-white placeholder-slate-500 focus:ring-2 focus:ring-pink-500 focus:border-pink-500 ${
        error ? 'border-red-500/50' : 'border-white/20'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`
    : `w-full px-4 py-3 bg-white border rounded-lg text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
        error ? 'border-red-300' : 'border-gray-300'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`;

  const labelClass = isDark ? 'text-slate-300' : 'text-gray-700';
  const radioTextClass = isDark ? 'text-slate-300' : 'text-gray-700';
  const sectionHeaderClass = isDark ? 'text-white' : 'text-gray-800';
  const sectionSubClass = isDark ? 'text-slate-400' : 'text-gray-500';

  const handleMemberSearch = async (query: string) => {
    setMemberQuery(query);
    if (query.length < 2) {
      setMemberResults([]);
      return;
    }
    try {
      setSearchingMembers(true);
      const result = await formsService.memberLookup(query);
      setMemberResults(result.members);
    } catch {
      setMemberResults([]);
    } finally {
      setSearchingMembers(false);
    }
  };

  const selectMember = (member: MemberLookupResult) => {
    onChange(field.id, member.id);
    setMemberQuery(member.full_name);
    setMemberResults([]);
  };

  // Section headers are purely visual dividers
  if (field.field_type === 'section_header') {
    return (
      <div className={`pt-2 ${isDark ? 'border-b border-white/10' : 'border-b border-gray-200'} pb-2`}>
        <h3 className={`text-lg font-semibold ${sectionHeaderClass}`}>{field.label}</h3>
        {field.help_text && <p className={`text-sm mt-1 ${sectionSubClass}`}>{field.help_text}</p>}
      </div>
    );
  }

  const renderInput = () => {
    switch (field.field_type) {
      case 'text':
      case 'email':
      case 'phone':
        return (
          <input
            type={field.field_type === 'phone' ? 'tel' : field.field_type}
            className={inputClass}
            placeholder={field.placeholder || ''}
            value={value}
            onChange={(e) => onChange(field.id, e.target.value)}
            required={field.required}
            disabled={disabled}
            minLength={field.min_length || undefined}
            maxLength={field.max_length || undefined}
            pattern={field.validation_pattern || undefined}
          />
        );

      case 'number':
        return (
          <input
            type="number"
            className={inputClass}
            placeholder={field.placeholder || ''}
            value={value}
            onChange={(e) => onChange(field.id, e.target.value)}
            required={field.required}
            disabled={disabled}
            min={field.min_value || undefined}
            max={field.max_value || undefined}
          />
        );

      case 'textarea':
        return (
          <textarea
            className={`${inputClass} min-h-[100px] resize-y`}
            placeholder={field.placeholder || ''}
            value={value}
            onChange={(e) => onChange(field.id, e.target.value)}
            required={field.required}
            disabled={disabled}
            minLength={field.min_length || undefined}
            maxLength={field.max_length || undefined}
          />
        );

      case 'date':
        return (
          <input
            type="date"
            className={inputClass}
            value={value}
            onChange={(e) => onChange(field.id, e.target.value)}
            required={field.required}
            disabled={disabled}
          />
        );

      case 'time':
        return (
          <input
            type="time"
            className={inputClass}
            value={value}
            onChange={(e) => onChange(field.id, e.target.value)}
            required={field.required}
            disabled={disabled}
          />
        );

      case 'datetime':
        return (
          <input
            type="datetime-local"
            className={inputClass}
            value={value}
            onChange={(e) => onChange(field.id, e.target.value)}
            required={field.required}
            disabled={disabled}
          />
        );

      case 'select':
        return (
          <select
            className={inputClass}
            value={value}
            onChange={(e) => onChange(field.id, e.target.value)}
            required={field.required}
            disabled={disabled}
          >
            <option value="">{field.placeholder || 'Select an option...'}</option>
            {field.options?.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        );

      case 'multiselect': {
        const selected = value ? value.split(',').filter(Boolean) : [];
        return (
          <div className={`${isDark ? 'bg-white/5 border-white/20' : 'bg-white border-gray-300'} border rounded-lg p-3 space-y-2`}>
            {field.options?.map((opt) => {
              const checked = selected.includes(opt.value);
              return (
                <label key={opt.value} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={(e) => {
                      const updated = e.target.checked
                        ? [...selected, opt.value]
                        : selected.filter((v) => v !== opt.value);
                      onChange(field.id, updated.join(','));
                    }}
                    className="w-4 h-4 text-pink-600 rounded"
                  />
                  <span className={radioTextClass}>{opt.label}</span>
                </label>
              );
            })}
          </div>
        );
      }

      case 'checkbox': {
        const checkedValues = value ? value.split(',').filter(Boolean) : [];
        return (
          <div className="space-y-2">
            {field.options?.map((opt) => {
              const checked = checkedValues.includes(opt.value);
              return (
                <label key={opt.value} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={(e) => {
                      const updated = e.target.checked
                        ? [...checkedValues, opt.value]
                        : checkedValues.filter((v) => v !== opt.value);
                      onChange(field.id, updated.join(','));
                    }}
                    className="w-4 h-4 text-pink-600 rounded"
                  />
                  <span className={radioTextClass}>{opt.label}</span>
                </label>
              );
            })}
          </div>
        );
      }

      case 'radio':
        return (
          <div className="space-y-2">
            {field.options?.map((opt) => (
              <label key={opt.value} className="flex items-center gap-3 cursor-pointer">
                <input
                  type="radio"
                  name={`field-${field.id}`}
                  value={opt.value}
                  checked={value === opt.value}
                  disabled={disabled}
                  onChange={(e) => onChange(field.id, e.target.value)}
                  className="w-4 h-4 text-pink-600"
                />
                <span className={radioTextClass}>{opt.label}</span>
              </label>
            ))}
          </div>
        );

      case 'member_lookup':
        return (
          <div className="relative">
            <div className="relative">
              <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isDark ? 'text-slate-500' : 'text-gray-400'}`} />
              <input
                type="text"
                className={`${inputClass} pl-10`}
                placeholder={field.placeholder || 'Search members...'}
                value={memberQuery}
                onChange={(e) => handleMemberSearch(e.target.value)}
                disabled={disabled}
              />
              {searchingMembers && (
                <div className={`absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-t-transparent rounded-full animate-spin ${isDark ? 'border-pink-500' : 'border-blue-500'}`} />
              )}
            </div>
            {memberResults.length > 0 && (
              <div className={`absolute z-10 mt-1 w-full rounded-lg shadow-lg max-h-48 overflow-y-auto ${isDark ? 'bg-slate-800 border border-white/20' : 'bg-white border border-gray-200'}`}>
                {memberResults.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => selectMember(member)}
                    className={`w-full text-left px-4 py-2 flex items-center gap-3 ${isDark ? 'hover:bg-white/10 text-white' : 'hover:bg-gray-50 text-gray-900'}`}
                  >
                    <User className="w-4 h-4 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium">{member.full_name}</p>
                      {member.rank && <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>{member.rank}</p>}
                    </div>
                  </button>
                ))}
              </div>
            )}
            {value && !memberQuery && (
              <p className={`text-xs mt-1 ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>Member selected (ID: {value.slice(0, 8)}...)</p>
            )}
          </div>
        );

      case 'file':
        return (
          <div className={`${inputClass} flex items-center justify-center py-6 border-dashed`}>
            <p className={`text-sm ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>File upload coming soon</p>
          </div>
        );

      case 'signature':
        return (
          <div className={`${inputClass} flex items-center justify-center py-8 border-dashed`}>
            <p className={`text-sm ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>Signature capture coming soon</p>
          </div>
        );

      default:
        return (
          <input
            type="text"
            className={inputClass}
            placeholder={field.placeholder || ''}
            value={value}
            onChange={(e) => onChange(field.id, e.target.value)}
            required={field.required}
            disabled={disabled}
          />
        );
    }
  };

  return (
    <div className={field.width === 'half' ? 'w-1/2 inline-block pr-2 align-top' : field.width === 'third' ? 'w-1/3 inline-block pr-2 align-top' : ''}>
      <label className={`block text-sm font-medium mb-1 ${labelClass}`}>
        {field.label}
        {field.required && <span className="text-red-400 ml-1">*</span>}
      </label>
      {field.help_text && (
        <p className={`text-xs mb-2 ${sectionSubClass}`}>{field.help_text}</p>
      )}
      {renderInput()}
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  );
};

export default FieldRenderer;
