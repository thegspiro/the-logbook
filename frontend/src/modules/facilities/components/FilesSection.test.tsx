import { fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/contexts/ConfirmContext';
import FilesSection from './FilesSection';
import { facilitiesService } from '@/services/facilitiesServices';

// The real provider, as the app shell mounts it: the caption dialog asks before
// discarding typed text, which needs one.
const render = (ui: ReactElement) => rtlRender(<ConfirmProvider>{ui}</ConfirmProvider>);
vi.mock('@/services/facilitiesServices', () => ({
  facilitiesService: {
    getPhotos: vi.fn(),
    getFacilityDocuments: vi.fn(),
    uploadPhoto: vi.fn(),
    uploadFacilityDocument: vi.fn(),
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
    expect(await screen.findByRole('button', { name: /^Upload a photo or document/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit station.jpg' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete station.jpg' })).toBeInTheDocument();
    await waitFor(() => expect(facilitiesService.getFacilityDocuments).toHaveBeenCalledWith({ facility_id: 'f1' }));
    expect(screen.getByText(/Documents \(0\)/)).toBeInTheDocument();
  });
});

describe('FilesSection upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(facilitiesService.getPhotos).mockReset();
    vi.mocked(facilitiesService.getPhotos).mockResolvedValue([]);
    vi.mocked(facilitiesService.getFacilityDocuments).mockReset();
    vi.mocked(facilitiesService.getFacilityDocuments).mockResolvedValue([]);
    vi.mocked(facilitiesService.uploadPhoto).mockReset();
    vi.mocked(facilitiesService.uploadPhoto).mockResolvedValue(photo);
    vi.mocked(facilitiesService.uploadFacilityDocument).mockReset();
    vi.mocked(facilitiesService.uploadFacilityDocument).mockResolvedValue({
      id: 'd1',
      facilityId: 'f1',
      fileName: 'lease.pdf',
      filePath: '',
      uploadedAt: '2026-01-01',
    });
  });

  const choose = async (file: File) => {
    render(<FilesSection facilityId="f1" canCreate canEdit canDelete canViewSensitive />);
    const zone = await screen.findByRole('button', { name: /^Upload a photo or document/ });
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
  };

  it('uploads an image through the facility photo endpoint', async () => {
    const file = new File(['png'], 'front.png', { type: 'image/png' });
    await choose(file);
    await waitFor(() => expect(facilitiesService.uploadPhoto).toHaveBeenCalledWith('f1', file));
    expect(facilitiesService.uploadFacilityDocument).not.toHaveBeenCalled();
  });

  it('uploads anything else through the facility document endpoint', async () => {
    const file = new File(['%PDF'], 'lease.pdf', { type: 'application/pdf' });
    await choose(file);
    await waitFor(() =>
      expect(facilitiesService.uploadFacilityDocument).toHaveBeenCalledWith('f1', file, 'facility_record')
    );
    expect(facilitiesService.uploadPhoto).not.toHaveBeenCalled();
  });
});

describe('FilesSection caption dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(facilitiesService.getPhotos).mockReset();
    vi.mocked(facilitiesService.getPhotos).mockResolvedValue([{ ...photo, caption: 'Front' }]);
    vi.mocked(facilitiesService.getFacilityDocuments).mockReset();
    vi.mocked(facilitiesService.getFacilityDocuments).mockResolvedValue([]);
    vi.mocked(facilitiesService.updatePhoto).mockReset();
  });

  // Forms review F-2: a refused caption was a toast, and nothing on the field
  // said which value was refused.
  it('shows a refused caption on the field and keeps what was typed', async () => {
    vi.mocked(facilitiesService.updatePhoto).mockRejectedValueOnce({
      response: { status: 422, data: { detail: 'Caption is too long.' } },
    });
    const user = userEvent.setup();
    render(<FilesSection facilityId="f1" canCreate canEdit canDelete canViewSensitive />);
    await user.click(await screen.findByRole('button', { name: 'Edit station.jpg' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit photo caption' });
    const field = within(dialog).getByRole('textbox', { name: /Caption/ });
    await user.clear(field);
    await user.type(field, 'Front bay');

    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Caption is too long.');
    expect(field).toHaveValue('Front bay');
    expect(field).toHaveAttribute('aria-invalid', 'true');
  });

  // Forms review F-6: Cancel, Escape and the X threw a typed caption away.
  it('asks before Cancel throws a typed caption away', async () => {
    const user = userEvent.setup();
    render(<FilesSection facilityId="f1" canCreate canEdit canDelete canViewSensitive />);
    await user.click(await screen.findByRole('button', { name: 'Edit station.jpg' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit photo caption' });
    await user.type(within(dialog).getByRole('textbox', { name: /Caption/ }), ' at dusk');

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(within(dialog).getByRole('textbox', { name: /Caption/ })).toHaveValue('Front at dusk');
  });
});
