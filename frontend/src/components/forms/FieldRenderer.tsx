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
import { FieldType } from '../../constants/enums';
import { useRanks } from '../../hooks/useRanks';
import TimeQuarterHour from '../ux/TimeQuarterHour';
import DateTimeQuarterHour from '../ux/DateTimeQuarterHour';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface SignaturePadProps {
  value: string;
  onChange: (dataUrl: string) => void;
  inputClass: string;
  disabled: boolean;
}

function SignaturePad({ value, onChange, inputClass, disabled }: SignaturePadProps) {
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
      if (!touch) return { x: 0, y: 0 };
      return { x: (touch.clientX - rect.left) * scaleX, y: (touch.clientY - rect.top) * scaleY };
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }, []);

  const startDrawing = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (disabled) return;
      e.preventDefault();
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return;
      isDrawingRef.current = true;
      const pt = getPoint(e);
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y);
    },
    [disabled, getPoint]
  );

  const draw = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!isDrawingRef.current || disabled) return;
      e.preventDefault();
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return;
      const pt = getPoint(e);
      ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
    },
    [disabled, getPoint]
  );

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
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#1f2937';
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
      <div className={`${inputClass} relative overflow-hidden p-0`}>
        <canvas
          ref={canvasRef}
          width={560}
          height={160}
          className="h-40 w-full cursor-crosshair touch-none"
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
      </div>
      <div className="mt-2 flex items-center justify-between">
        <p className="text-theme-text-muted text-xs">Draw your signature above</p>
        {value && (
          <button
            type="button"
            onClick={handleClear}
            disabled={disabled}
            className="text-theme-text-muted flex items-center gap-1 text-xs hover:text-red-700 disabled:opacity-50 dark:hover:text-red-400"
          >
            <Trash2 className="h-3 w-3" />
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
  placeholder?: string | undefined;
  help_text?: string | undefined;
  default_value?: string | undefined;
  required: boolean;
  min_length?: number | undefined;
  max_length?: number | undefined;
  min_value?: number;
  max_value?: number;
  validation_pattern?: string | undefined;
  options?: { value: string; label: string }[] | undefined;
  condition_field_id?: string | undefined;
  condition_operator?: string | undefined;
  condition_value?: string | undefined;
  sort_order: number;
  width: string;
}

export interface FieldRendererProps {
  field: FieldDefinition;
  value: string;
  onChange: (fieldId: string, value: string) => void;
  /** Called when the field loses focus. */
  onBlur?: (fieldId: string) => void;
  /** Use dark theme (internal app) or light theme (public forms). Default: dark */
  theme?: 'dark' | 'light';
  disabled?: boolean;
  error?: string | undefined;
}

const FieldRenderer = ({
  field,
  value,
  onChange,
  onBlur,
  theme = 'dark',
  disabled = false,
  error,
}: FieldRendererProps) => {
  const { formatRank } = useRanks();
  const [memberResults, setMemberResults] = useState<MemberLookupResult[]>([]);
  const [memberQuery, setMemberQuery] = useState('');
  const [searchingMembers, setSearchingMembers] = useState(false);

  const isDark = theme === 'dark';
  const errorId = `field-error-${field.id}`;
  const ariaProps = {
    ...(error ? { 'aria-describedby': errorId, 'aria-invalid': true as const } : {}),
    ...(field.required ? { 'aria-required': true as const } : {}),
  };

  const inputClass = isDark
    ? `w-full px-4 py-3 bg-theme-input-bg border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:ring-2 focus:ring-theme-focus-ring focus:border-theme-focus-ring ${
        error ? 'border-red-500/50' : 'border-theme-input-border'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`
    : `w-full px-4 py-3 bg-theme-input-bg border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:ring-2 focus:ring-theme-focus-ring focus:border-theme-focus-ring ${
        error ? 'border-red-300 dark:border-red-500/50' : 'border-theme-input-border'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`;

  const labelClass = isDark ? 'text-theme-text-secondary' : 'text-theme-text-primary';
  const radioTextClass = 'text-theme-text-secondary';
  const sectionHeaderClass = 'text-theme-text-primary';
  const sectionSubClass = 'text-theme-text-muted';

  const handleBlur = () => {
    onBlur?.(field.id);
  };

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
      <div className="border-theme-surface-border border-b pt-2 pb-2">
        <h3 className={`text-lg font-semibold ${sectionHeaderClass}`}>{field.label}</h3>
        {field.help_text && <p className={`mt-1 text-sm ${sectionSubClass}`}>{field.help_text}</p>}
      </div>
    );
  }

  const renderInput = () => {
    switch (field.field_type) {
      case FieldType.TEXT:
      case FieldType.EMAIL:
      case FieldType.PHONE:
        return (
          <>
            <input
              id={`field-${field.id}`}
              type={field.field_type === FieldType.PHONE ? 'tel' : field.field_type}
              className={inputClass}
              placeholder={field.placeholder || ''}
              value={value}
              onChange={(e) => onChange(field.id, e.target.value)}
              onBlur={handleBlur}
              required={field.required}
              disabled={disabled}
              minLength={field.min_length ?? undefined}
              maxLength={field.max_length ?? undefined}
              pattern={field.validation_pattern ?? undefined}
              {...ariaProps}
            />
            {field.max_length && (
              <p className="text-theme-text-muted mt-1 text-right text-[11px]">
                {value.length} / {field.max_length}
              </p>
            )}
          </>
        );

      case FieldType.NUMBER:
        return (
          <input
            id={`field-${field.id}`}
            type="number"
            inputMode="decimal"
            className={inputClass}
            placeholder={field.placeholder || ''}
            value={value}
            onChange={(e) => onChange(field.id, e.target.value)}
            onBlur={handleBlur}
            required={field.required}
            disabled={disabled}
            min={field.min_value ?? undefined}
            max={field.max_value ?? undefined}
            {...ariaProps}
          />
        );

      case FieldType.TEXTAREA:
        return (
          <>
            <textarea
              id={`field-${field.id}`}
              className={`${inputClass} min-h-[100px] resize-y`}
              placeholder={field.placeholder || ''}
              value={value}
              onChange={(e) => onChange(field.id, e.target.value)}
              onBlur={handleBlur}
              required={field.required}
              disabled={disabled}
              minLength={field.min_length ?? undefined}
              maxLength={field.max_length ?? undefined}
              {...ariaProps}
            />
            {field.max_length && (
              <p className="text-theme-text-muted mt-1 text-right text-[11px]">
                {value.length} / {field.max_length}
              </p>
            )}
          </>
        );

      case FieldType.DATE:
        return (
          <input
            id={`field-${field.id}`}
            type="date"
            className={inputClass}
            value={value}
            onChange={(e) => onChange(field.id, e.target.value)}
            onBlur={handleBlur}
            required={field.required}
            disabled={disabled}
            {...ariaProps}
          />
        );

      case FieldType.TIME:
        return (
          <TimeQuarterHour
            id={`field-${field.id}`}
            className={inputClass}
            value={value}
            onChange={(e) => onChange(field.id, e.target.value)}
            required={field.required}
          />
        );

      case FieldType.DATETIME:
        return (
          <DateTimeQuarterHour
            id={`field-${field.id}`}
            className={inputClass}
            value={value}
            onChange={(val) => onChange(field.id, val)}
            required={field.required}
          />
        );

      case FieldType.SELECT:
        return (
          <select
            id={`field-${field.id}`}
            className={inputClass}
            value={value}
            onChange={(e) => onChange(field.id, e.target.value)}
            onBlur={handleBlur}
            required={field.required}
            disabled={disabled}
            {...ariaProps}
          >
            <option value="">{field.placeholder || 'Select an option...'}</option>
            {field.options?.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        );

      case FieldType.MULTISELECT: {
        const selected = value ? value.split(',').filter(Boolean) : [];
        return (
          <div className="bg-theme-input-bg border-theme-input-border space-y-2 rounded-lg border p-3">
            {field.options?.map((opt) => {
              const checked = selected.includes(opt.value);
              return (
                <label key={opt.value} className="flex cursor-pointer items-center gap-3">
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
                    className="h-4 w-4 rounded-sm text-red-600"
                  />
                  <span className={radioTextClass}>{opt.label}</span>
                </label>
              );
            })}
          </div>
        );
      }

      case FieldType.CHECKBOX: {
        const checkedValues = value ? value.split(',').filter(Boolean) : [];
        return (
          <div className="space-y-2">
            {field.options?.map((opt) => {
              const checked = checkedValues.includes(opt.value);
              return (
                <label key={opt.value} className="flex cursor-pointer items-center gap-3">
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
                    className="h-4 w-4 rounded-sm text-red-600"
                  />
                  <span className={radioTextClass}>{opt.label}</span>
                </label>
              );
            })}
          </div>
        );
      }

      case FieldType.RADIO:
        return (
          <fieldset className="space-y-2">
            <legend className="sr-only">{field.label}</legend>
            {field.options?.map((opt) => (
              <label key={opt.value} className="flex cursor-pointer items-center gap-3">
                <input
                  type="radio"
                  name={`field-${field.id}`}
                  value={opt.value}
                  checked={value === opt.value}
                  disabled={disabled}
                  onChange={(e) => onChange(field.id, e.target.value)}
                  className="h-4 w-4 text-red-600"
                />
                <span className={radioTextClass}>{opt.label}</span>
              </label>
            ))}
          </fieldset>
        );

      case FieldType.MEMBER_LOOKUP:
        return (
          <div className="relative">
            <div className="relative">
              <Search className="text-theme-text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <input
                type="text"
                className={`${inputClass} pl-10`}
                placeholder={field.placeholder || 'Search members...'}
                value={memberQuery}
                onChange={(e) => {
                  void handleMemberSearch(e.target.value);
                }}
                disabled={disabled}
                {...ariaProps}
              />
              {searchingMembers && (
                <div
                  className={`absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-t-transparent ${isDark ? 'border-red-500' : 'border-blue-500 dark:border-blue-400'}`}
                />
              )}
            </div>
            {memberResults.length > 0 && (
              <div className="bg-theme-surface-modal border-theme-surface-border absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border shadow-lg">
                {memberResults.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => selectMember(member)}
                    className="hover:bg-theme-surface-hover text-theme-text-primary flex w-full items-center gap-3 px-4 py-2 text-left"
                  >
                    <User className="h-4 w-4 shrink-0" />
                    <div>
                      <p className="text-sm font-medium">{member.full_name}</p>
                      {member.rank && <p className="text-theme-text-muted text-xs">{formatRank(member.rank)}</p>}
                    </div>
                  </button>
                ))}
              </div>
            )}
            {value && !memberQuery && (
              <p className="text-theme-text-muted mt-1 text-xs">Member selected (ID: {value.slice(0, 8)}...)</p>
            )}
          </div>
        );

      case FieldType.FILE: {
        let fileInfo: { name: string; size: number; type: string } | null = null;
        if (value) {
          try {
            fileInfo = JSON.parse(value) as { name: string; size: number; type: string };
          } catch {
            /* invalid stored value */
          }
        }

        const handleFileSelect = (file: File) => {
          if (file.size > MAX_FILE_SIZE) {
            return; // silently reject; the error prop can be set by the parent
          }
          const reader = new FileReader();
          reader.onload = () => {
            onChange(
              field.id,
              JSON.stringify({
                name: file.name,
                size: file.size,
                type: file.type,
                data: reader.result as string,
              })
            );
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
              <div className="flex min-w-0 items-center gap-2">
                <FileText
                  className={`h-4 w-4 shrink-0 ${isDark ? 'text-red-700 dark:text-red-400' : 'text-blue-700 dark:text-blue-400'}`}
                />
                <span className="truncate text-sm">{fileInfo.name}</span>
                <span className="text-theme-text-muted shrink-0 text-xs">({formatFileSize(fileInfo.size)})</span>
              </div>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onChange(field.id, '')}
                  className="text-theme-text-muted ml-2 shrink-0 hover:text-red-700 dark:hover:text-red-400"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          );
        }

        const fileInputId = `file-input-${field.id}`;
        return (
          <label
            htmlFor={fileInputId}
            className={`${inputClass} flex cursor-pointer flex-col items-center justify-center border-dashed py-6`}
            onDragOver={(e) => {
              e.preventDefault();
            }}
            onDrop={handleDrop}
          >
            <Upload className="text-theme-text-muted mb-2 h-6 w-6" />
            <p className="text-theme-text-muted text-sm">Click to upload or drag and drop</p>
            <p className="text-theme-text-muted mt-1 text-xs">Max file size: {formatFileSize(MAX_FILE_SIZE)}</p>
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

      case FieldType.SIGNATURE:
        return (
          <SignaturePad
            value={value}
            onChange={(dataUrl) => onChange(field.id, dataUrl)}
            inputClass={inputClass}
            disabled={disabled}
          />
        );

      default:
        return (
          <input
            id={`field-${field.id}`}
            type="text"
            className={inputClass}
            placeholder={field.placeholder || ''}
            value={value}
            onChange={(e) => onChange(field.id, e.target.value)}
            onBlur={handleBlur}
            required={field.required}
            disabled={disabled}
            {...ariaProps}
          />
        );
    }
  };

  return (
    <div
      className={
        field.width === 'half'
          ? 'inline-block w-1/2 pr-2 align-top'
          : field.width === 'third'
            ? 'inline-block w-1/3 pr-2 align-top'
            : ''
      }
    >
      <label className={`mb-1 block text-sm font-medium ${labelClass}`}>
        {field.label}
        {field.required && <span className="ml-1 text-red-700 dark:text-red-400">*</span>}
      </label>
      {field.help_text && <p className={`mb-2 text-xs ${sectionSubClass}`}>{field.help_text}</p>}
      {renderInput()}
      {error && (
        <p id={errorId} className="mt-1 text-xs text-red-700 dark:text-red-400" role="alert" aria-live="assertive">
          {error}
        </p>
      )}
    </div>
  );
};

export default FieldRenderer;
