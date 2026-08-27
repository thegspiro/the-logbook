import { useCallback, useEffect, useState } from 'react';
import { Camera, FileText, Loader2, Pencil, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { FileDropzone } from '@/components/ux/FileDropzone';
import { useConfirm } from '@/contexts/ConfirmContext';
import { documentsService } from '@/services/documentsService';
import { facilitiesService, type FacilityDocument, type FacilityPhoto } from '@/services/facilitiesServices';
import { getErrorMessage } from '@/utils/errorHandling';

interface FilesSectionProps {
  facilityId: string;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canViewSensitive: boolean;
}

/** Photos are baseline operational records; facility documents are sensitive. */
export default function FilesSection({
  facilityId,
  canCreate,
  canEdit,
  canDelete,
  canViewSensitive,
}: FilesSectionProps) {
  const [photos, setPhotos] = useState<FacilityPhoto[]>([]);
  const [documents, setDocuments] = useState<FacilityDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const { confirm } = useConfirm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextPhotos, nextDocuments] = await Promise.all([
        facilitiesService.getPhotos({ facility_id: facilityId }),
        canViewSensitive ? facilitiesService.getFacilityDocuments({ facility_id: facilityId }) : Promise.resolve([]),
      ]);
      setPhotos(nextPhotos);
      setDocuments(nextDocuments);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to load facility files'));
    } finally {
      setLoading(false);
    }
  }, [canViewSensitive, facilityId]);

  useEffect(() => void load(), [load]);

  const upload = async ([file]: File[]) => {
    if (!file) return;
    setUploading(true);
    try {
      // The Documents module owns bytes, retention and downloads. Facility
      // records only classify that shared document for the facility.
      const form = new FormData();
      form.append('file', file);
      form.append('name', file.name);
      const stored = await documentsService.uploadDocument(form);
      const common = {
        facility_id: facilityId,
        file_path: `document:${stored.id}`,
        file_name: file.name,
        ...(file.type ? { mime_type: file.type } : {}),
      };
      if (file.type.startsWith('image/')) await facilitiesService.createPhoto(common);
      else await facilitiesService.createFacilityDocument({ ...common, document_type: 'facility_record' });
      toast.success(`${file.name} uploaded`);
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to upload file'));
    } finally {
      setUploading(false);
    }
  };

  const edit = async (kind: 'photo' | 'document', item: FacilityPhoto | FacilityDocument) => {
    const current = kind === 'photo' ? (item as FacilityPhoto).caption : (item as FacilityDocument).description;
    const value = window.prompt(kind === 'photo' ? 'Photo caption' : 'Document description', current ?? '');
    if (value === null) return;
    if (kind === 'photo') await facilitiesService.updatePhoto(item.id, { caption: value });
    else await facilitiesService.updateFacilityDocument(item.id, { description: value });
    await load();
  };

  const remove = async (kind: 'photo' | 'document', item: FacilityPhoto | FacilityDocument) => {
    if (
      !(await confirm({
        title: `Delete ${kind}?`,
        message: `Remove “${item.fileName ?? 'file'}” from this facility?`,
        confirmLabel: 'Delete',
        variant: 'danger',
      }))
    )
      return;
    if (kind === 'photo') await facilitiesService.deletePhoto(item.id);
    else await facilitiesService.deleteFacilityDocument(item.id);
    await load();
  };

  if (loading)
    return (
      <div className="card flex justify-center p-10" role="status">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );

  const list = (kind: 'photo' | 'document', items: Array<FacilityPhoto | FacilityDocument>) => (
    <div className="card p-6">
      <h2 className="text-theme-text-primary mb-4 flex items-center gap-2 font-bold">
        {kind === 'photo' ? <Camera className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
        {kind === 'photo' ? 'Photos' : 'Documents'} ({items.length})
      </h2>
      {items.length === 0 ? (
        <p className="text-theme-text-muted py-6 text-center">
          No {kind === 'photo' ? 'photos' : 'documents'} uploaded.
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="card-secondary flex items-center justify-between p-3">
              <span className="text-theme-text-primary truncate">{item.fileName}</span>
              <div className="flex gap-1">
                {canEdit && (
                  <button aria-label={`Edit ${item.fileName}`} onClick={() => void edit(kind, item)} className="p-2">
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
                {canDelete && (
                  <button
                    aria-label={`Delete ${item.fileName}`}
                    onClick={() => void remove(kind, item)}
                    className="p-2 text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {canCreate && (
        <div className="card p-6">
          <FileDropzone
            onFilesSelected={(files) => void upload(files)}
            label={uploading ? 'Uploading…' : 'Upload a facility file'}
            maxSizeMB={25}
          />
        </div>
      )}
      {list('photo', photos)}
      {canViewSensitive && list('document', documents)}
    </div>
  );
}
