/**
 * FieldRenderer - Renders a single form field based on its type.
 *
 * Reusable across modules: Forms, Scheduling (shift checkout),
 * Training (updates), Inventory (equipment checks), etc.
 *
 * Supports all 16 field types: text, textarea, email, phone, number,
 * date, time, datetime, select, multiselect, checkbox, radio,
 * file, signature, section_header, member_lookup.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, User, Upload, FileText, X, Trash2 } from 'lucide-react';
import { formsService } from '../../services/api';
import type { MemberLookupResult } from '../../services/api';
import { FieldType, formatRank } from '../../constants/enums';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface SignaturePadProps {
  value: string;
  onChange: (dataUrl: string) => void;
  isDark: boolean;
  inputClass: string;
  disabled: boolean;
}

function SignaturePad({ value, onChange, isDark, inputClass, disabled }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);

  const getPoint = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ('touches' in e) {
      const touch = e.touches[0];
      return { x: (touch.clientX - rect.left) * scaleX, y: (touch.clientY - rect.top) * scaleY };
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }, []);

  const startDrawing = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (disabled) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    isDrawingRef.current = true;
    const pt = getPoint(e);
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
  }, [disabled, getPoint]);

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawingRef.current || disabled) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const pt = getPoint(e);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
  }, [disabled, getPoint]);

  const stopDrawing = useCallback(() => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    const canvas = canvasRef.current;
    if (canvas) {
      onChange(canvas.toDataURL('image/png'));
    }
  }, [onChange]);

  // Initialize canvas styles and restore previous signature
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.strokeStyle = isDark ? '#e2e8f0' : '#1f2937';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (value) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0);
      img.src = value;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    onChange('');
  };

  return (
    <div>
      <div className={`${inputClass} relative p-0 overflow-hidden`}>
        <canvas
          ref={canvasRef}
          width={560}
          height={160}
          className="w-full h-40 cursor-crosshair touch-none"
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
      </div>
      <div className="flex items-center justify-between mt-2">
        <p className={`text-xs ${isDark ? 'text-theme-text-muted' : 'text-theme-text-muted'}`}>
          Draw your signature above
        </p>
        {value && (
          <button
            type="button"
            onClick={handleClear}
            disabled={disabled}
            className={`text-xs flex items-center gap-1 ${isDark ? 'text-theme-text-muted hover:text-red-700 dark:hover:text-red-400' : 'text-theme-text-muted hover:text-red-700 dark:hover:text-red-500'} disabled:opacity-50`}
          >
            <Trash2 className="w-3 h-3" />
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

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
  condition_field_id?: string;
  condition_operator?: string;
  condition_value?: string;
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
    ? `w-full px-3 py-2 bg-theme-surface-secondary border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:ring-2 focus:ring-pink-500 focus:border-pink-500 ${
        error ? 'border-red-500/50' : 'border-theme-surface-border'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`
    : `w-full px-4 py-3 bg-white border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
        error ? 'border-red-300' : 'border-theme-input-border'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`;

  const labelClass = isDark ? 'text-theme-text-secondary' : 'text-theme-text-primary';
  const radioTextClass = isDark ? 'text-theme-text-secondary' : 'text-theme-text-primary';
  const sectionHeaderClass = isDark ? 'text-theme-text-primary' : 'text-theme-text-primary';
  const sectionSubClass = isDark ? 'text-theme-text-muted' : 'text-theme-text-muted';

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
  if (field.field_type === FieldType.SECTION_HEADER) {
    return (
      <div className={`pt-2 ${isDark ? 'border-b border-theme-surface-border' : 'border-b border-theme-surface-border'} pb-2`}>
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
            type={field.field_type === FieldType.PHONE ? 'tel' : field.field_type}
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
            step="900"
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
            step="900"
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
          <div className={`${isDark ? 'bg-theme-surface-secondary border-theme-surface-border' : 'bg-white border-theme-input-border'} border rounded-lg p-3 space-y-2`}>
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
              <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isDark ? 'text-theme-text-muted' : 'text-theme-text-muted'}`} />
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
              <div className={`absolute z-10 mt-1 w-full rounded-lg shadow-lg max-h-48 overflow-y-auto ${isDark ? 'bg-theme-surface border border-theme-surface-border' : 'bg-white border border-theme-surface-border'}`}>
                {memberResults.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => selectMember(member)}
                    className={`w-full text-left px-4 py-2 flex items-center gap-3 ${isDark ? 'hover:bg-theme-surface-hover text-theme-text-primary' : 'hover:bg-theme-surface-secondary text-theme-text-primary'}`}
                  >
                    <User className="w-4 h-4 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium">{member.full_name}</p>
                      {member.rank && <p className={`text-xs ${isDark ? 'text-theme-text-muted' : 'text-theme-text-muted'}`}>{formatRank(member.rank)}</p>}
                    </div>
                  </button>
                ))}
              </div>
            )}
            {value && !memberQuery && (
              <p className={`text-xs mt-1 ${isDark ? 'text-theme-text-muted' : 'text-theme-text-muted'}`}>Member selected (ID: {value.slice(0, 8)}...)</p>
            )}
          </div>
        );

      case 'file': {
        let fileInfo: { name: string; size: number; type: string } | null = null;
        if (value) {
          try { fileInfo = JSON.parse(value); } catch { /* invalid stored value */ }
        }

        const handleFileSelect = (file: File) => {
          if (file.size > MAX_FILE_SIZE) {
            return; // silently reject; the error prop can be set by the parent
          }
          const reader = new FileReader();
          reader.onload = () => {
            onChange(field.id, JSON.stringify({
              name: file.name,
              size: file.size,
              type: file.type,
              data: reader.result as string,
            }));
          };
          reader.readAsDataURL(file);
        };

        const handleDrop = (e: React.DragEvent) => {
          e.preventDefault();
          if (disabled) return;
          const file = e.dataTransfer.files[0];
          if (file) handleFileSelect(file);
        };

        if (fileInfo) {
          return (
            <div className={`${inputClass} flex items-center justify-between py-3`}>
              <div className="flex items-center gap-2 min-w-0">
                <FileText className={`w-4 h-4 flex-shrink-0 ${isDark ? 'text-pink-700 dark:text-pink-400' : 'text-blue-700 dark:text-blue-500'}`} />
                <span className="text-sm truncate">{fileInfo.name}</span>
                <span className={`text-xs flex-shrink-0 ${isDark ? 'text-theme-text-muted' : 'text-theme-text-muted'}`}>
                  ({formatFileSize(fileInfo.size)})
                </span>
              </div>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onChange(field.id, '')}
                  className={`flex-shrink-0 ml-2 ${isDark ? 'text-theme-text-muted hover:text-red-700 dark:hover:text-red-400' : 'text-theme-text-muted hover:text-red-700 dark:hover:text-red-500'}`}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          );
        }

        const fileInputId = `file-input-${field.id}`;
        return (
          <label
            htmlFor={fileInputId}
            className={`${inputClass} flex flex-col items-center justify-center py-6 border-dashed cursor-pointer`}
            onDragOver={(e) => { e.preventDefault(); }}
            onDrop={handleDrop}
          >
            <Upload className={`w-6 h-6 mb-2 ${isDark ? 'text-theme-text-muted' : 'text-theme-text-muted'}`} />
            <p className={`text-sm ${isDark ? 'text-theme-text-muted' : 'text-theme-text-muted'}`}>
              Click to upload or drag and drop
            </p>
            <p className={`text-xs mt-1 ${isDark ? 'text-theme-text-muted' : 'text-theme-text-muted'}`}>
              Max file size: {formatFileSize(MAX_FILE_SIZE)}
            </p>
            <input
              id={fileInputId}
              type="file"
              className="hidden"
              disabled={disabled}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelect(file);
              }}
            />
          </label>
        );
      }

      case 'signature':
        return (
          <SignaturePad
            value={value}
            onChange={(dataUrl) => onChange(field.id, dataUrl)}
            isDark={isDark}
            inputClass={inputClass}
            disabled={disabled}
          />
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
        {field.required && <span className="text-red-700 dark:text-red-400 ml-1">*</span>}
      </label>
      {field.help_text && (
        <p className={`text-xs mb-2 ${sectionSubClass}`}>{field.help_text}</p>
      )}
      {renderInput()}
      {error && <p className="text-xs text-red-700 dark:text-red-400 mt-1">{error}</p>}
    </div>
  );
};

export default FieldRenderer;
