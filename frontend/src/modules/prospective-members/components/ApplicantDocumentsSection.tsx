/**
 * Applicant Documents Section
 *
 * The paperwork on an applicant's record — the signed application, an ID, a
 * background-check return — listed with a link to open each one, an upload
 * control, and a way to remove one filed by mistake.
 *
 * The API and the client method for all three have existed since documents
 * were added; nothing rendered them, so a file could be uploaded only by
 * calling the endpoint directly and could never be read back.
 *
 * A document-upload stage advances only when a document exists for each of
 * the coordinator's configured type labels, so those labels are offered as
 * buttons rather than left to be typed. Uploading everything as one fixed
 * type — which is what this did — could never satisfy a stage configured for
 * "Background Check" and "Photo ID", so both auto-advance and manual
 * completion stayed blocked no matter how many files were filed.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { FileText, Upload, Trash2, Loader2, Download, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Applicant, ApplicantDocument, DocumentStageConfig } from '../types';
import { FILE_UPLOAD_LIMITS } from '../types';
import { applicantService } from '../services/api';
import { ApplicantStatus, StageType } from '../../../constants/enums';
import { formatDate } from '../../../utils/dateFormatting';
import { enumLabel } from '../../../utils/displayValue';
import { getErrorMessage } from '../../../utils/errorHandling';
import { useConfirm } from '../../../contexts/ConfirmContext';

interface ApplicantDocumentsSectionProps {
  applicant: Applicant;
  tz: string;
}

/** Bytes as the size a person would say — "1.4 MB", not "1468006". */
const fileSize = (bytes: number): string => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Match the server's grading exactly.
 *
 * `_advance_prospect_step` normalizes both the configured label and the stored
 * document type with NFKC + strip + casefold before comparing them, so a
 * checkmark here that used any other rule would tell an applicant a
 * requirement was met while the stage refused to advance.
 */
const normalizeType = (value: string): string => value.normalize('NFKC').trim().toLowerCase();

/** The stage's default when it names no types, and the historical value. */
const FALLBACK_DOCUMENT_TYPE = 'application';

const ApplicantDocumentsSection: React.FC<ApplicantDocumentsSectionProps> = ({ applicant, tz }) => {
  const { confirm } = useConfirm();
  const [documents, setDocuments] = useState<ApplicantDocument[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  // Which required label the pending file picker is filing under. Held in a
  // ref rather than state: the picker's change event fires long after the
  // click, and a re-render in between must not lose the choice.
  const pendingTypeRef = useRef<string>(FALLBACK_DOCUMENT_TYPE);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const requiredTypes = useMemo(() => {
    if (applicant.current_stage_type !== StageType.DOCUMENT_UPLOAD) return [];
    const config = applicant.current_stage_config as DocumentStageConfig | undefined;
    // The stage builder seeds this as [''], so a blank row is "not configured
    // yet" rather than a document called nothing.
    return (config?.required_document_types ?? []).map((type) => type.trim()).filter(Boolean);
  }, [applicant.current_stage_type, applicant.current_stage_config]);

  const filedTypes = useMemo(
    () => new Set(documents.map((document) => normalizeType(document.document_type ?? ''))),
    [documents]
  );

  useEffect(() => {
    if (!applicant.id) {
      setDocuments([]);
      return;
    }
    setIsLoading(true);
    applicantService
      .getDocuments(applicant.id)
      .then(setDocuments)
      .catch(() => setDocuments([]))
      .finally(() => setIsLoading(false));
  }, [applicant.id]);

  const handleUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Cleared before the await: leaving the value in place means choosing the
      // same file again fires no change event, and the second upload silently
      // does nothing.
      event.target.value = '';
      if (!file) return;
      const documentType = pendingTypeRef.current;
      setIsUploading(true);
      try {
        const document = await applicantService.uploadDocument(
          applicant.id,
          applicant.current_stage_id || '',
          documentType,
          file
        );
        setDocuments((prev) => [document, ...prev]);
        toast.success(
          documentType === FALLBACK_DOCUMENT_TYPE ? `${file.name} uploaded` : `${file.name} filed as ${documentType}`
        );
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to upload the file'));
      } finally {
        setIsUploading(false);
        pendingTypeRef.current = FALLBACK_DOCUMENT_TYPE;
      }
    },
    [applicant.id, applicant.current_stage_id]
  );

  /** Open the file picker with the label this file will be filed under. */
  const chooseFileFor = useCallback((documentType: string) => {
    pendingTypeRef.current = documentType;
    fileInputRef.current?.click();
  }, []);

  const handleDelete = useCallback(
    async (document: ApplicantDocument) => {
      const agreed = await confirm({
        title: 'Remove this document?',
        message: `"${document.file_name}" is deleted from the applicant's record. The file itself cannot be recovered.`,
        confirmLabel: 'Remove document',
        cancelLabel: 'Keep it',
        variant: 'danger',
      });
      if (!agreed) return;
      try {
        await applicantService.deleteDocument(applicant.id, document.id);
        setDocuments((prev) => prev.filter((d) => d.id !== document.id));
        toast.success('Document removed');
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to remove the document'));
      }
    },
    [applicant.id, confirm]
  );

  return (
    <div className="border-theme-surface-border border-b p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-theme-text-muted flex items-center gap-1.5 text-xs font-medium tracking-wider uppercase">
          <FileText className="h-3.5 w-3.5" />
          Documents
        </h3>
        {applicant.status === ApplicantStatus.ACTIVE && (
          <>
            {requiredTypes.length === 0 && (
              <button
                onClick={() => chooseFileFor(FALLBACK_DOCUMENT_TYPE)}
                disabled={isUploading}
                className="flex items-center gap-1 text-xs text-red-500 transition-colors hover:text-red-800 disabled:opacity-50 dark:hover:text-red-400"
              >
                {isUploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                Upload
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept={FILE_UPLOAD_LIMITS.allowedExtensions.join(',')}
              aria-label="Upload a document for this applicant"
              onChange={(e) => {
                void handleUpload(e);
              }}
            />
          </>
        )}
      </div>

      {/*
        One button per configured label, so the type is chosen rather than
        typed. The stage grades on these exact labels, so a free-text box here
        would put an applicant one typo away from a requirement that can never
        be met and gives no clue why.
      */}
      {applicant.status === ApplicantStatus.ACTIVE && requiredTypes.length > 0 && (
        <div className="mb-3">
          <p className="text-theme-text-muted mb-2 text-xs">This step needs each of these before it can advance:</p>
          <div className="flex flex-wrap gap-2">
            {requiredTypes.map((documentType) => {
              const filed = filedTypes.has(normalizeType(documentType));
              return (
                <button
                  key={documentType}
                  type="button"
                  onClick={() => chooseFileFor(documentType)}
                  disabled={isUploading}
                  aria-label={filed ? `Replace the ${documentType} document` : `Upload the ${documentType} document`}
                  className={`mobile-touch-target focus:ring-theme-focus-ring flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-colors focus:ring-2 focus:outline-hidden disabled:opacity-50 ${
                    filed
                      ? 'border-green-600/40 text-green-700 dark:text-green-400'
                      : 'border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-hover'
                  }`}
                >
                  {filed ? (
                    <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  ) : (
                    <Upload className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  )}
                  {documentType}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-4" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-4 w-4 animate-spin" />
        </div>
      ) : documents.length === 0 ? (
        <p className="text-theme-text-muted text-xs">
          No documents yet. Up to {FILE_UPLOAD_LIMITS.maxSizeLabel} each —{' '}
          {FILE_UPLOAD_LIMITS.allowedExtensions.join(', ')}.
        </p>
      ) : (
        <ul className="space-y-2">
          {documents.map((document) => (
            <li
              key={document.id}
              className="bg-theme-surface-secondary flex items-center justify-between gap-2 rounded-lg px-3 py-2"
            >
              <div className="min-w-0">
                <a
                  href={document.file_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-theme-text-primary flex items-center gap-1.5 truncate text-sm hover:underline"
                >
                  <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {document.file_name}
                </a>
                <p className="text-theme-text-muted mt-0.5 text-xs">
                  {enumLabel(document.document_type)}
                  {document.file_size ? ` · ${fileSize(document.file_size)}` : ''}
                  {document.uploaded_at ? ` · ${formatDate(document.uploaded_at, tz)}` : ''}
                </p>
              </div>
              {applicant.status === ApplicantStatus.ACTIVE && (
                <button
                  onClick={() => {
                    void handleDelete(document);
                  }}
                  aria-label={`Remove ${document.file_name}`}
                  className="text-theme-text-muted shrink-0 transition-colors hover:text-red-500"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default ApplicantDocumentsSection;
