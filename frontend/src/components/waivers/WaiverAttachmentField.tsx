/**
 * WaiverAttachmentField — the document picker on a waiver request.
 *
 * Shown only when the department's policy takes documents. Wraps the shared
 * `FileDropzone`, which keeps the chosen list itself (and lets the member
 * remove a file), so this component reports problems with the whole list
 * rather than silently dropping a file: a fourth file or a GIF stays visible
 * with a message saying why it would be refused, and the form holds the
 * submit until it is removed. The backend checks every rule again by the
 * file's content; these checks only save a refused upload.
 */

import React, { useCallback, useId, useState } from 'react';
import { FileDropzone } from '../ux/FileDropzone';
import {
  WAIVER_ATTACHMENT_ACCEPT,
  WAIVER_ATTACHMENT_MAX_COUNT,
  WAIVER_ATTACHMENT_MAX_MB,
  WAIVER_ATTACHMENT_TYPES_LABEL,
  WaiverAttachmentMode,
  waiverSelectionProblems,
} from '../../services/waiverAttachmentService';

export interface WaiverAttachmentSelection {
  files: File[];
  /** No file would be refused, and a required document is present. */
  valid: boolean;
}

interface WaiverAttachmentFieldProps {
  /** The policy's setting; render nothing for `off`. */
  mode: WaiverAttachmentMode;
  onChange: (selection: WaiverAttachmentSelection) => void;
  /** Documents the request already holds, when adding to a pending one. */
  alreadyFiled?: number;
  /** Show the "a document is required" message (after a submit attempt). */
  showRequiredError?: boolean;
}

export const WaiverAttachmentField: React.FC<WaiverAttachmentFieldProps> = ({
  mode,
  onChange,
  alreadyFiled = 0,
  showRequiredError = false,
}) => {
  const [files, setFiles] = useState<File[]>([]);
  const hintId = useId();
  const required = mode === WaiverAttachmentMode.REQUIRED;

  const handleFiles = useCallback(
    (chosen: File[]) => {
      setFiles(chosen);
      const problems = waiverSelectionProblems(chosen, alreadyFiled);
      onChange({
        files: chosen,
        valid: problems.length === 0 && (!required || chosen.length + alreadyFiled > 0),
      });
    },
    [alreadyFiled, onChange, required]
  );

  if (mode === WaiverAttachmentMode.OFF) return null;

  const problems = waiverSelectionProblems(files, alreadyFiled);
  const missing = required && showRequiredError && files.length + alreadyFiled === 0;

  return (
    <div>
      <p className="form-label">
        Supporting document{' '}
        {required ? (
          <span className="text-red-700 dark:text-red-400">(required)</span>
        ) : (
          <span className="text-theme-text-muted">(optional)</span>
        )}
      </p>
      <p id={hintId} className="text-theme-text-muted mb-2 text-xs">
        {WAIVER_ATTACHMENT_TYPES_LABEL}, up to {WAIVER_ATTACHMENT_MAX_MB} MB each, at most {WAIVER_ATTACHMENT_MAX_COUNT}{' '}
        per request. Only you and the people who decide your request can open them; the file name is not kept.
      </p>
      <FileDropzone
        onFilesSelected={handleFiles}
        accept={WAIVER_ATTACHMENT_ACCEPT}
        multiple
        maxSizeMB={WAIVER_ATTACHMENT_MAX_MB}
        label="Drop a document here or click to choose one"
      />
      {(problems.length > 0 || missing) && (
        <ul role="alert" className="mt-2 space-y-1 text-sm text-red-700 dark:text-red-400">
          {missing && <li>Attach a document to this request.</li>}
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default WaiverAttachmentField;
