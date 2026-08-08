/**
 * Documents Tab Component
 *
 * Manages photos and documents attached to an apparatus.
 * Supports listing, adding, and deleting both photos and documents.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { FileText, Camera, Trash2, ExternalLink, Image } from 'lucide-react';
import toast from 'react-hot-toast';
import { apparatusPhotoService, apparatusDocumentService } from '../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';
import { ConfirmDialog } from '../../../components/ux/ConfirmDialog';
import { formatDate } from '../../../utils/dateFormatting';
import { useTimezone } from '../../../hooks/useTimezone';
import type { ApparatusPhoto, ApparatusDocument } from '../types';

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
  const tz = useTimezone();

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
      toast.error(getErrorMessage(err, 'Failed to delete'));
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

        {photos.length === 0 ? (
          <p className="text-theme-text-muted py-8 text-center">No photos uploaded yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            {photos.map((photo) => (
              <div key={photo.id} className="card-secondary overflow-hidden rounded-lg">
                <div className="bg-theme-surface-secondary flex aspect-video items-center justify-center">
                  {photo.filePath ? (
                    <img
                      src={photo.filePath}
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

        {documents.length === 0 ? (
          <p className="text-theme-text-muted py-8 text-center">No documents uploaded yet.</p>
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
                  {doc.filePath && (
                    <a
                      href={doc.filePath}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-theme-text-muted hover:text-theme-text-primary p-1 transition-colors"
                      title="Open document"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
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
        message={`Are you sure you want to delete "${deleteTarget?.name ?? ''}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
};

export default DocumentsTab;
