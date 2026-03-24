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
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'photo' | 'document'; id: string; name: string } | null>(null);
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
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-theme-text-primary mx-auto"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Photos Section */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-theme-text-primary font-bold flex items-center gap-2">
            <Camera className="w-5 h-5" />
            Photos ({photos.length})
          </h2>
        </div>

        {photos.length === 0 ? (
          <p className="text-theme-text-muted text-center py-8">No photos uploaded yet.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {photos.map((photo) => (
              <div key={photo.id} className="card-secondary rounded-lg overflow-hidden">
                <div className="aspect-video bg-theme-surface-secondary flex items-center justify-center">
                  {photo.filePath ? (
                    <img
                      src={photo.filePath}
                      alt={photo.title || photo.fileName}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Image className="w-12 h-12 text-theme-text-muted" />
                  )}
                </div>
                <div className="p-3">
                  <p className="text-theme-text-primary text-sm font-medium truncate">
                    {photo.title || photo.fileName}
                  </p>
                  {photo.photoType && (
                    <p className="text-theme-text-muted text-xs capitalize">{photo.photoType}</p>
                  )}
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-theme-text-muted text-xs">
                      {formatDate(photo.uploadedAt, tz)}
                    </span>
                    <button
                      onClick={() => setDeleteTarget({ type: 'photo', id: photo.id, name: photo.title || photo.fileName })}
                      className="p-1 text-theme-text-muted hover:text-red-600 transition-colors"
                      title="Delete photo"
                    >
                      <Trash2 className="w-4 h-4" />
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
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-theme-text-primary font-bold flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Documents ({documents.length})
          </h2>
        </div>

        {documents.length === 0 ? (
          <p className="text-theme-text-muted text-center py-8">No documents uploaded yet.</p>
        ) : (
          <div className="space-y-3">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="card-secondary flex items-center justify-between p-4"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex-shrink-0 w-10 h-10 bg-theme-surface-secondary rounded-lg flex items-center justify-center">
                    <FileText className="w-5 h-5 text-theme-text-muted" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-theme-text-primary font-medium truncate">{doc.title}</p>
                    <div className="flex items-center gap-2 text-xs text-theme-text-muted">
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
                      <p className="text-theme-text-muted text-xs mt-1 truncate">{doc.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                  {doc.filePath && (
                    <a
                      href={doc.filePath}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1 text-theme-text-muted hover:text-theme-text-primary transition-colors"
                      title="Open document"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                  <button
                    onClick={() => setDeleteTarget({ type: 'document', id: doc.id, name: doc.title })}
                    className="p-1 text-theme-text-muted hover:text-red-600 transition-colors"
                    title="Delete document"
                  >
                    <Trash2 className="w-4 h-4" />
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
