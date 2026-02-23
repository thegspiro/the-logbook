/**
 * Inline Edit Component (#37)
 *
 * Click-to-edit for simple fields like status, titles, and quantities.
 * Saves on blur or Enter, cancels on Escape.
 */

import React, { useState, useRef, useEffect } from 'react';
import { Check, X, Pencil, Loader2 } from 'lucide-react';

interface InlineEditProps {
  value: string;
  onSave: (newValue: string) => Promise<void> | void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  type?: 'text' | 'number';
  renderDisplay?: (value: string) => React.ReactNode;
}

export const InlineEdit: React.FC<InlineEditProps> = ({
  value,
  onSave,
  placeholder = 'Click to edit',
  className = '',
  inputClassName = '',
  type = 'text',
  renderDisplay,
}) => {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  useEffect(() => {
    setEditValue(value);
  }, [value]);

  const handleSave = async () => {
    if (editValue === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(editValue);
      setEditing(false);
    } catch {
      setEditValue(value);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditValue(value);
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') handleCancel();
  };

  if (editing) {
    return (
      <div className={`flex items-center gap-1 ${className}`}>
        <input
          ref={inputRef}
          type={type}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSave}
          disabled={saving}
          className={`px-2 py-1 text-sm bg-theme-input-bg border border-red-500 rounded text-theme-text-primary focus:outline-none ${inputClassName}`}
        />
        {saving ? (
          <Loader2 className="w-4 h-4 animate-spin text-theme-text-muted" />
        ) : (
          <>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleSave}
              className="p-0.5 text-green-600 hover:text-green-700"
              aria-label="Save"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleCancel}
              className="p-0.5 text-red-600 hover:text-red-700"
              aria-label="Cancel"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className={`group inline-flex items-center gap-1.5 text-left hover:bg-theme-surface-hover rounded px-1 -mx-1 py-0.5 transition-colors ${className}`}
      title="Click to edit"
    >
      {renderDisplay ? renderDisplay(value) : (
        <span className={value ? 'text-theme-text-primary' : 'text-theme-text-muted italic'}>
          {value || placeholder}
        </span>
      )}
      <Pencil className="w-3 h-3 text-theme-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
};
