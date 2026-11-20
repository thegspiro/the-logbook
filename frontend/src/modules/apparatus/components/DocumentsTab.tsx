/**
 * Documents Tab Component
 *
 * Manages photos and documents attached to an apparatus.
 *
 * Uploads are filed by the server as documents in the vehicle's folder under
 * Apparatus Files (photos in Photos, a registration in Registration &
 * Insurance, ...), malware-scanned and served back through the apparatus
 * endpoints. Links come from `fileUrl`, which the server sets only for a
 * stored file or a legacy HTTP(S) link, never from the raw `filePath`.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { FileText, Camera, Trash2, ExternalLink, Image, Download, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import { apparatusPhotoService, apparatusDocumentService } from '../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';
import { ConfirmDialog } from '../../../components/ux/ConfirmDialog';
import { FileDropzone } from '../../../components/ux/FileDropzone';
import { FIELD_ERROR_CLASS, FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { useFieldErrors, type FieldSpecs } from '../../../hooks/useFieldErrors';
import { formatDate } from '../../../utils/dateFormatting';
import { saveFile } from '../../../utils/fileDownload';
import { useTimezone } from '../../../hooks/useTimezone';
import { useAuthStore } from '../../../stores/authStore';
import { APPARATUS_DOCUMENT_TYPES, type ApparatusPhoto, type ApparatusDocument } from '../types';

const inputClass = 'form-input w-full min-w-0';

type DocumentField = 'title' | 'documentType' | 'expirationDate';
// The upload is multipart, so a refusal names the form field as sent.
const DOCUMENT_FIELDS: FieldSpecs<DocumentField> = {
  title: { id: 'apparatus-document-title', label: 'Title' },
  documentType: { id: 'apparatus-document-type', label: 'Type', apiKeys: ['document_type'] },
  expirationDate: { id: 'apparatus-document-expires', label: 'Expires', apiKeys: ['expiration_date'] },
};
// ApparatusDocumentBase.title max_length.
const TITLE_MAX = 200;
const DEFAULT_DOCUMENT_TYPE = 'registration';

function stem(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

interface DocumentsTabProps {
  id: string;
}

export const DocumentsTab: React.FC<DocumentsTabProps> = ({ id }) => {
  const [photos, setPhotos] = useState<ApparatusPhoto[]>([]);
  const [documents, setDocuments] = useState<ApparatusDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'photo' | 'document'; id: string; name: string } | null>(
    null
  );
  const [photoUploading, setPhotoUploading] = useState(false);
  const [pendingDocument, setPendingDocument] = useState<File | null>(null);
  const [documentTitle, setDocumentTitle] = useState('');
  const [documentType, setDocumentType] = useState<string>(DEFAULT_DOCUMENT_TYPE);
  const [documentExpires, setDocumentExpires] = useState('');
  const [documentUploading, setDocumentUploading] = useState(false);
  const documentErrors = useFieldErrors(DOCUMENT_FIELDS);
  const tz = useTimezone();
  const checkPermission = useAuthStore((state) => state.checkPermission);
  const canUpload = checkPermission('apparatus.edit') || checkPermission('apparatus.manage');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [photoData, docData] = await Promise.all([
        apparatusPhotoService.getPhotos(id),
        apparatusDocumentService.getDocuments(id),
      ]);
      setPhotos(photoData);
      setDocuments(docData);
    } catch {
      toast.error('Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handlePhotoSelected = async ([file]: File[]) => {
    if (!file) return;
    setPhotoUploading(true);
    try {
      await apparatusPhotoService.uploadPhoto(id, file, stem(file.name));
      toast.success('Photo uploaded');
      void loadData();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to upload photo'));
    } finally {
      setPhotoUploading(false);
    }
  };

  const handleDocumentSelected = ([file]: File[]) => {
    if (!file) return;
    setPendingDocument(file);
    setDocumentTitle(stem(file.name));
  };

  const cancelDocument = () => {
    setPendingDocument(null);
    setDocumentTitle('');
    setDocumentType(DEFAULT_DOCUMENT_TYPE);
    setDocumentExpires('');
    documentErrors.clear();
  };

  // The title starts as the file's name, so only what was typed over it, a
  // chosen type or an expiry date counts as something to lose (forms review F-6).
  const documentDirty =
    pendingDocument !== null &&
    (documentTitle !== stem(pendingDocument.name) || documentType !== DEFAULT_DOCUMENT_TYPE || documentExpires !== '');
  const requestCancelDocument = useDiscardGuard({
    isDirty: documentDirty,
    onClose: cancelDocument,
    message: 'The title, type and expiry you entered for this document have not been saved. Cancelling will lose them.',
  });

  const handleDocumentUpload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pendingDocument) return;
    const title = documentTitle.trim();
    documentErrors.clear();
    // A document is filed only once it has a title: said on the field, not in
    // a toast (forms review F-3), and nothing is uploaded until it is fixed.
    if (!title) {
      const problems = { title: 'Give the document a title.' };
      documentErrors.setErrors(problems);
      documentErrors.focusFirst(problems);
      return;
    }
    setDocumentUploading(true);
    try {
      await apparatusDocumentService.uploadDocument(id, {
        file: pendingDocument,
        title,
        documentType,
        expirationDate: documentExpires || undefined,
      });
      toast.success('Document uploaded');
      cancelDocument();
      void loadData();
    } catch (err) {
      // The file and what was typed stay in the form; a refusal lands on the
      // field it names, anything else above the buttons.
      documentErrors.focusFirst(documentErrors.setFromApiError(err, 'Failed to upload document'));
    } finally {
      setDocumentUploading(false);
    }
  };

  const handleDownload = async (doc: ApparatusDocument) => {
    try {
      saveFile(await apparatusDocumentService.downloadDocument(id, doc.id));
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to download document'));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.type === 'photo') {
        await apparatusPhotoService.deletePhoto(id, deleteTarget.id);
        toast.success('Photo deleted');
      } else {
        await apparatusDocumentService.deleteDocument(id, deleteTarget.id);
        toast.success('Document deleted');
      }
      setDeleteTarget(null);
      void loadData();
    } catch (err) {
      toast.error(getErrorMessage(err, `Failed to delete ${deleteTarget.type}`));
    }
  };

  if (loading) {
    return (
      <div className="card p-6">
        <div className="py-8 text-center">
          <div className="border-theme-text-primary mx-auto h-8 w-8 animate-spin rounded-full border-b-2"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Photos Section */}
      <div className="card p-6">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-theme-text-primary flex items-center gap-2 font-bold">
            <Camera className="h-5 w-5" />
            Photos ({photos.length})
          </h2>
        </div>

        {canUpload && (
          <FileDropzone
            onFilesSelected={(files) => void handlePhotoSelected(files)}
            accept="image/jpeg,image/png,image/gif,image/webp"
            maxSizeMB={20}
            label={photoUploading ? 'Uploading…' : 'Upload a photo'}
            className="mb-6"
          />
        )}

        {photos.length === 0 ? (
          <p className="text-theme-text-muted py-8 text-center">No photos on file for this apparatus.</p>
        ) : (
          <div className="card-grid gap-4 [--card-grid-min:18rem]">
            {photos.map((photo) => (
              <div key={photo.id} className="card-secondary overflow-hidden rounded-lg">
                <div className="bg-theme-surface-secondary flex aspect-video items-center justify-center">
                  {photo.fileUrl ? (
                    <img
                      src={photo.fileUrl}
                      alt={photo.title || photo.fileName}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Image className="text-theme-text-muted h-12 w-12" />
                  )}
                </div>
                <div className="p-3">
                  <p className="text-theme-text-primary truncate text-sm font-medium">
                    {photo.title || photo.fileName}
                  </p>
                  {photo.photoType && <p className="text-theme-text-muted text-xs capitalize">{photo.photoType}</p>}
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-theme-text-muted text-xs">{formatDate(photo.uploadedAt, tz)}</span>
                    <button
                      onClick={() =>
                        setDeleteTarget({ type: 'photo', id: photo.id, name: photo.title || photo.fileName })
                      }
                      className="text-theme-text-muted p-1 transition-colors hover:text-red-600"
                      title="Delete photo"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Documents Section */}
      <div className="card p-6">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-theme-text-primary flex items-center gap-2 font-bold">
            <FileText className="h-5 w-5" />
            Documents ({documents.length})
          </h2>
        </div>

        {canUpload && !pendingDocument && (
          <FileDropzone
            onFilesSelected={handleDocumentSelected}
            maxSizeMB={50}
            label="Upload a registration, manual, inspection or other document"
            className="mb-6"
          />
        )}

        {canUpload && pendingDocument && (
          <form noValidate onSubmit={(e) => void handleDocumentUpload(e)} className="card-secondary mb-6 space-y-4 p-4">
            <p className="text-theme-text-primary min-w-0 text-sm break-words">
              <Upload className="mr-1 inline h-4 w-4" aria-hidden="true" />
              {pendingDocument.name}
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField
                id={DOCUMENT_FIELDS.title.id}
                label="Title"
                required
                error={documentErrors.errors.title}
                maxLength={TITLE_MAX}
                count={documentTitle.length}
                className="min-w-0"
              >
                {(props) => (
                  <input
                    {...props}
                    className={inputClass}
                    value={documentTitle}
                    onChange={(e) => {
                      setDocumentTitle(e.target.value);
                      documentErrors.setError('title', null);
                    }}
                  />
                )}
              </FormField>
              <FormField
                id={DOCUMENT_FIELDS.documentType.id}
                label="Type"
                error={documentErrors.errors.documentType}
                className="min-w-0"
              >
                {(props) => (
                  <select
                    {...props}
                    className={inputClass}
                    value={documentType}
                    onChange={(e) => {
                      setDocumentType(e.target.value);
                      documentErrors.setError('documentType', null);
                    }}
                  >
                    {APPARATUS_DOCUMENT_TYPES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
              <FormField
                id={DOCUMENT_FIELDS.expirationDate.id}
                label="Expires"
                optional
                error={documentErrors.errors.expirationDate}
                className="min-w-0"
              >
                {(props) => (
                  <input
                    {...props}
                    type="date"
                    className={inputClass}
                    value={documentExpires}
                    onChange={(e) => {
                      setDocumentExpires(e.target.value);
                      documentErrors.setError('expirationDate', null);
                    }}
                  />
                )}
              </FormField>
            </div>
            {documentErrors.formError && (
              <p role="alert" className={`text-sm ${FIELD_ERROR_CLASS}`}>
                {documentErrors.formError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={requestCancelDocument}
                disabled={documentUploading}
              >
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={documentUploading}>
                {documentUploading ? 'Uploading…' : 'Upload document'}
              </button>
            </div>
          </form>
        )}

        {documents.length === 0 ? (
          <p className="text-theme-text-muted py-8 text-center">No documents on file for this apparatus.</p>
        ) : (
          <div className="space-y-3">
            {documents.map((doc) => (
              <div key={doc.id} className="card-secondary flex items-center justify-between p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="bg-theme-surface-secondary flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg">
                    <FileText className="text-theme-text-muted h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-theme-text-primary truncate font-medium">{doc.title}</p>
                    <div className="text-theme-text-muted flex items-center gap-2 text-xs">
                      <span className="capitalize">{doc.documentType}</span>
                      <span>&middot;</span>
                      <span>{formatDate(doc.uploadedAt, tz)}</span>
                      {doc.expirationDate && (
                        <>
                          <span>&middot;</span>
                          <span>Expires {formatDate(doc.expirationDate, tz)}</span>
                        </>
                      )}
                    </div>
                    {doc.description && (
                      <p className="text-theme-text-muted mt-1 truncate text-xs">{doc.description}</p>
                    )}
                  </div>
                </div>
                <div className="ml-4 flex flex-shrink-0 items-center gap-2">
                  {doc.documentId ? (
                    <button
                      type="button"
                      onClick={() => void handleDownload(doc)}
                      className="text-theme-text-muted hover:text-theme-text-primary touch:min-h-11 touch:min-w-11 p-1 transition-colors"
                      title="Download document"
                      aria-label={`Download ${doc.title}`}
                    >
                      <Download className="h-4 w-4" />
                    </button>
                  ) : (
                    doc.fileUrl && (
                      <a
                        href={doc.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-theme-text-muted hover:text-theme-text-primary p-1 transition-colors"
                        title="Open document"
                        aria-label={`Open ${doc.title}`}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )
                  )}
                  <button
                    onClick={() => setDeleteTarget({ type: 'document', id: doc.id, name: doc.title })}
                    className="text-theme-text-muted p-1 transition-colors hover:text-red-600"
                    title="Delete document"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void handleDelete()}
        title={`Delete ${deleteTarget?.type === 'photo' ? 'Photo' : 'Document'}`}
        message={`Delete "${deleteTarget?.name ?? ''}"? You can't undo this.`}
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
};

export default DocumentsTab;
