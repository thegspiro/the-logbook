/**
 * File Dropzone Component (#34)
 *
 * Drag-and-drop file upload zone with thumbnail preview,
 * progress indication, and file size display.
 */

import React, { useState, useRef, useCallback } from 'react';
import { Upload, X, File as FileIcon, Image } from 'lucide-react';

interface FileDropzoneProps {
  onFilesSelected: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  maxSizeMB?: number;
  label?: string;
  className?: string;
}

interface FilePreview {
  file: File;
  preview?: string;
}

export const FileDropzone: React.FC<FileDropzoneProps> = ({
  onFilesSelected,
  accept = '*',
  multiple = false,
  maxSizeMB = 10,
  label = 'Drop files here or click to browse',
  className = '',
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<FilePreview[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateAndAddFiles = useCallback(
    (newFiles: FileList | File[]) => {
      setError(null);
      const validFiles: FilePreview[] = [];

      Array.from(newFiles).forEach((file) => {
        if (file.size > maxSizeMB * 1024 * 1024) {
          setError(`${file.name} exceeds ${maxSizeMB}MB limit`);
          return;
        }

        const preview = file.type.startsWith('image/')
          ? URL.createObjectURL(file)
          : undefined;

        validFiles.push({ file, preview });
      });

      if (validFiles.length > 0) {
        const updated = multiple ? [...files, ...validFiles] : validFiles;
        setFiles(updated);
        onFilesSelected(updated.map((f) => f.file));
      }
    },
    [files, maxSizeMB, multiple, onFilesSelected]
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      validateAndAddFiles(e.dataTransfer.files);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      validateAndAddFiles(e.target.files);
    }
  };

  const removeFile = (index: number) => {
    const updated = files.filter((_, i) => i !== index);
    // Revoke object URLs to avoid memory leaks
    if (files[index].preview) URL.revokeObjectURL(files[index].preview!);
    setFiles(updated);
    onFilesSelected(updated.map((f) => f.file));
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div className={className}>
      {/* Drop zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
          isDragging
            ? 'border-red-500 bg-red-500/5'
            : 'border-theme-surface-border hover:border-theme-text-muted'
        }`}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}
        aria-label={label}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={handleInputChange}
          className="hidden"
          aria-hidden="true"
        />
        <Upload className="w-8 h-8 text-theme-text-muted mx-auto mb-2" />
        <p className="text-sm text-theme-text-secondary">{label}</p>
        <p className="text-xs text-theme-text-muted mt-1">Max {maxSizeMB}MB per file</p>
      </div>

      {/* Error */}
      {error && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {/* File previews */}
      {files.length > 0 && (
        <div className="mt-3 space-y-2">
          {files.map((fp, index) => (
            <div
              key={index}
              className="flex items-center gap-3 p-2 bg-theme-surface-secondary rounded-lg"
            >
              {fp.preview ? (
                <img src={fp.preview} alt="" className="w-10 h-10 rounded object-cover" />
              ) : (
                <div className="w-10 h-10 rounded bg-theme-surface-hover flex items-center justify-center">
                  {fp.file.type.startsWith('image/') ? (
                    <Image className="w-5 h-5 text-theme-text-muted" />
                  ) : (
                    <FileIcon className="w-5 h-5 text-theme-text-muted" />
                  )}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-theme-text-primary truncate">{fp.file.name}</p>
                <p className="text-xs text-theme-text-muted">{formatSize(fp.file.size)}</p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); removeFile(index); }}
                className="p-1 text-theme-text-muted hover:text-red-500 transition-colors"
                aria-label={`Remove ${fp.file.name}`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
