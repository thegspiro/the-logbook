/**
 * Apparatus photos and documents are uploaded here and filed by the server
 * as documents in the vehicle's folder. Links come only from the server's
 * `fileUrl`; a stored `filePath` (once a free-text field) never reaches an
 * `href` or `src`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { ApparatusDocument, ApparatusPhoto } from '../types';

let grantedPermissions = new Set<string>();

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (state: { checkPermission: (permission: string) => boolean }) => unknown) =>
    selector({ checkPermission: (permission) => grantedPermissions.has(permission) }),
}));

const getPhotos = vi.fn();
const getDocuments = vi.fn();
const uploadPhoto = vi.fn();
const uploadDocument = vi.fn();
const downloadDocument = vi.fn();

vi.mock('../services/api', () => ({
  apparatusPhotoService: {
    getPhotos: (...args: unknown[]) => getPhotos(...args) as unknown,
    uploadPhoto: (...args: unknown[]) => uploadPhoto(...args) as unknown,
    deletePhoto: vi.fn(),
  },
  apparatusDocumentService: {
    getDocuments: (...args: unknown[]) => getDocuments(...args) as unknown,
    uploadDocument: (...args: unknown[]) => uploadDocument(...args) as unknown,
    downloadDocument: (...args: unknown[]) => downloadDocument(...args) as unknown,
    deleteDocument: vi.fn(),
  },
}));

const saveFile = vi.fn();
vi.mock('../../../utils/fileDownload', () => ({
  saveFile: (...args: unknown[]) => saveFile(...args) as unknown,
}));

import { DocumentsTab } from './DocumentsTab';

const photo = (fields: Partial<ApparatusPhoto>): ApparatusPhoto => ({
  id: 'p1',
  organizationId: 'o1',
  apparatusId: 'a-1',
  filePath: 'document:d1',
  documentId: 'd1',
  fileUrl: '/api/v1/apparatus/a-1/photos/p1/file',
  fileName: 'IMG_2291.png',
  fileSize: 10,
  mimeType: 'image/png',
  title: 'Driver side',
  description: null,
  takenAt: null,
  photoType: null,
  isPrimary: false,
  uploadedBy: null,
  uploadedAt: '2026-10-08T12:00:00Z',
  ...fields,
});

const doc = (fields: Partial<ApparatusDocument>): ApparatusDocument => ({
  id: 'r1',
  organizationId: 'o1',
  apparatusId: 'a-1',
  filePath: 'document:d2',
  documentId: 'd2',
  fileUrl: '/api/v1/apparatus/a-1/documents/r1/file',
  fileName: 'scan.pdf',
  fileSize: 10,
  mimeType: 'application/pdf',
  title: '2026 Registration',
  description: null,
  documentType: 'registration',
  expirationDate: null,
  documentDate: null,
  uploadedBy: null,
  uploadedAt: '2026-10-08T12:00:00Z',
  ...fields,
});

describe('DocumentsTab', () => {
  beforeEach(() => {
    grantedPermissions = new Set(['apparatus.view']);
    getPhotos.mockReset();
    getPhotos.mockResolvedValue([]);
    getDocuments.mockReset();
    getDocuments.mockResolvedValue([]);
    uploadPhoto.mockReset();
    uploadPhoto.mockResolvedValue(photo({}));
    uploadDocument.mockReset();
    uploadDocument.mockResolvedValue(doc({}));
    downloadDocument.mockReset();
    downloadDocument.mockResolvedValue({ blob: new Blob(['x']), filename: '2026-10-08_Engine-1.pdf' });
    saveFile.mockReset();
  });

  it('shows a stored photo from the apparatus file endpoint', async () => {
    getPhotos.mockResolvedValue([photo({})]);
    renderWithRouter(<DocumentsTab id="a-1" />);
    expect(await screen.findByRole('img', { name: 'Driver side' })).toHaveAttribute(
      'src',
      '/api/v1/apparatus/a-1/photos/p1/file'
    );
  });

  it('never links a legacy value the server withheld', async () => {
    getPhotos.mockResolvedValue([photo({ documentId: null, fileUrl: null, filePath: 'javascript:alert(1)' })]);
    getDocuments.mockResolvedValue([doc({ documentId: null, fileUrl: null, filePath: 'javascript:alert(1)' })]);
    renderWithRouter(<DocumentsTab id="a-1" />);
    await screen.findByText('2026 Registration');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Download/ })).not.toBeInTheDocument();
  });

  it('opens a legacy HTTPS link in a new tab', async () => {
    getDocuments.mockResolvedValue([doc({ documentId: null, fileUrl: 'https://example.com/reg.pdf' })]);
    renderWithRouter(<DocumentsTab id="a-1" />);
    expect(await screen.findByRole('link', { name: 'Open 2026 Registration' })).toHaveAttribute(
      'href',
      'https://example.com/reg.pdf'
    );
  });

  it('downloads a stored document under the name the server gave it', async () => {
    const user = userEvent.setup();
    getDocuments.mockResolvedValue([doc({})]);
    renderWithRouter(<DocumentsTab id="a-1" />);
    await user.click(await screen.findByRole('button', { name: 'Download 2026 Registration' }));
    expect(downloadDocument).toHaveBeenCalledWith('a-1', 'r1');
    await waitFor(() =>
      expect(saveFile).toHaveBeenCalledWith({ blob: expect.any(Blob) as Blob, filename: '2026-10-08_Engine-1.pdf' })
    );
  });

  it('offers no upload to someone who cannot edit the apparatus', async () => {
    renderWithRouter(<DocumentsTab id="a-1" />);
    await screen.findByText(/No photos on file/);
    expect(screen.queryByText('Upload a photo')).not.toBeInTheDocument();
  });

  it('uploads a document with its title and type', async () => {
    grantedPermissions = new Set(['apparatus.view', 'apparatus.edit']);
    const user = userEvent.setup();
    renderWithRouter(<DocumentsTab id="a-1" />);
    const dropzone = await screen.findByRole('button', { name: /Upload a registration, manual/ });
    fireEvent.drop(dropzone, {
      dataTransfer: { files: [new File(['%PDF-1.4'], 'scan0003.pdf', { type: 'application/pdf' })] },
    });

    const title = await screen.findByLabelText('Title');
    expect(title).toHaveValue('scan0003');
    await user.clear(title);
    await user.type(title, 'Pump manual');
    await user.selectOptions(screen.getByLabelText('Type'), 'manual');
    await user.click(screen.getByRole('button', { name: 'Upload document' }));

    await waitFor(() =>
      expect(uploadDocument).toHaveBeenCalledWith('a-1', {
        file: expect.any(File) as File,
        title: 'Pump manual',
        documentType: 'manual',
        expirationDate: undefined,
      })
    );
  });
});
