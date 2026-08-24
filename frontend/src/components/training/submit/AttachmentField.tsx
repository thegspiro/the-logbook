import React from 'react';
import { Upload, X } from 'lucide-react';
import { ATTACHMENT_ACCEPT } from './submitFormatting';

export const AttachmentField: React.FC<{
  id: string;
  file: File | null;
  error: string;
  required?: boolean;
  invalid?: boolean;
  onSelect: (file: File | null) => void;
}> = ({ id, file, error, required, invalid, onSelect }) => (
  <div>
    <label
      htmlFor={id}
      className={`bg-theme-surface-secondary text-theme-text-secondary hover:border-theme-text-muted/40 flex min-h-[44px] w-full cursor-pointer items-center gap-2.5 rounded-lg border border-dashed p-3 text-sm transition-colors ${
        invalid ? 'border-red-600 dark:border-red-500' : 'border-theme-input-border'
      }`}
    >
      <Upload className="text-theme-text-muted h-[18px] w-[18px] shrink-0" />
      <span className="truncate">
        {file ? file.name : 'Attach certificate'}
        {!file &&
          (required ? (
            <span className="text-red-700 dark:text-red-400"> *</span>
          ) : (
            <span className="text-theme-text-muted font-normal"> optional</span>
          ))}
      </span>
    </label>
    <input
      id={id}
      type="file"
      accept={ATTACHMENT_ACCEPT}
      className="sr-only"
      onChange={(e) => {
        const selected = e.target.files?.[0] ?? null;
        onSelect(selected);
        // Clear the input so re-picking the same file after an error still fires.
        e.target.value = '';
      }}
    />
    {file && (
      <button
        type="button"
        onClick={() => onSelect(null)}
        className="text-theme-text-muted hover:text-theme-text-primary mt-1 inline-flex items-center gap-1 text-xs"
      >
        <X className="h-3 w-3" /> Remove attachment
      </button>
    )}
    {error && <p className="mt-1 text-xs text-red-700 dark:text-red-400">{error}</p>}
  </div>
);
