import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FilesSection from './FilesSection';
import { facilitiesService } from '@/services/facilitiesServices';

vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => ({ confirm: vi.fn() }) }));
vi.mock('@/services/documentsService', () => ({ documentsService: { uploadDocument: vi.fn() } }));
vi.mock('@/services/facilitiesServices', () => ({
  facilitiesService: {
    getPhotos: vi.fn(),
    getFacilityDocuments: vi.fn(),
    createPhoto: vi.fn(),
    createFacilityDocument: vi.fn(),
    updatePhoto: vi.fn(),
    updateFacilityDocument: vi.fn(),
    deletePhoto: vi.fn(),
    deleteFacilityDocument: vi.fn(),
  },
}));

const photo = { id: 'p1', facilityId: 'f1', fileName: 'station.jpg', filePath: '', uploadedAt: '2026-01-01' };

describe('FilesSection permissions', () => {
  beforeEach(() => {
    // The service mocks are module-level, created once by the factory above,
    // so their call counters accumulate across this file. The first test
    // asserts `getFacilityDocuments` was *never* called — the only check that
    // a member without `canViewSensitive` does not request sensitive facility
    // documents — and it passed solely because it is declared first. Run the
    // file shuffled and it fails.
    vi.clearAllMocks();
    vi.mocked(facilitiesService.getPhotos).mockResolvedValue([photo]);
    vi.mocked(facilitiesService.getFacilityDocuments).mockResolvedValue([]);
  });

  it('shows baseline photos without requesting sensitive documents or mutation controls', async () => {
    render(
      <FilesSection facilityId="f1" canCreate={false} canEdit={false} canDelete={false} canViewSensitive={false} />
    );
    expect(await screen.findByText('station.jpg')).toBeInTheDocument();
    expect(facilitiesService.getFacilityDocuments).not.toHaveBeenCalled();
    expect(screen.queryByText(/Documents \(/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit station/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete station/ })).not.toBeInTheDocument();
  });

  it('applies create, edit, delete and sensitive-read grants independently', async () => {
    render(<FilesSection facilityId="f1" canCreate canEdit canDelete canViewSensitive />);
    expect(await screen.findByRole('button', { name: 'Upload a facility file' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit station.jpg' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete station.jpg' })).toBeInTheDocument();
    await waitFor(() => expect(facilitiesService.getFacilityDocuments).toHaveBeenCalledWith({ facility_id: 'f1' }));
    expect(screen.getByText(/Documents \(0\)/)).toBeInTheDocument();
  });
});
