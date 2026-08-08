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
    if (e.key === 'Enter') void handleSave();
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
          onBlur={() => {
            void handleSave();
          }}
          disabled={saving}
          className={`bg-theme-input-bg text-theme-text-primary rounded-sm border border-red-500 px-2 py-1 text-sm focus:outline-hidden ${inputClassName}`}
        />
        {saving ? (
          <Loader2 className="text-theme-text-muted h-4 w-4 animate-spin" />
        ) : (
          <>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                void handleSave();
              }}
              className="inline-flex items-center justify-center p-1 text-green-600 hover:text-green-700 max-sm:min-h-[44px] max-sm:min-w-[44px] dark:text-green-400 dark:hover:text-green-300"
              aria-label="Save"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleCancel}
              className="inline-flex items-center justify-center p-1 text-red-600 hover:text-red-700 max-sm:min-h-[44px] max-sm:min-w-[44px] dark:text-red-400 dark:hover:text-red-300"
              aria-label="Cancel"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className={`group hover:bg-theme-surface-hover -mx-1 inline-flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-left transition-colors ${className}`}
      title="Click to edit"
    >
      {renderDisplay ? (
        renderDisplay(value)
      ) : (
        <span className={value ? 'text-theme-text-primary' : 'text-theme-text-muted italic'}>
          {value || placeholder}
        </span>
      )}
      <Pencil className="text-theme-text-muted h-3 w-3 transition-opacity sm:opacity-0 sm:group-hover:opacity-100" />
    </button>
  );
};
