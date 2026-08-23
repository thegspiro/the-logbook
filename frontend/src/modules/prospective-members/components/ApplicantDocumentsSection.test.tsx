import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import ApplicantDocumentsSection from './ApplicantDocumentsSection';
import type { Applicant } from '../types';

const mockGetDocuments = vi.fn();
const mockUploadDocument = vi.fn();
const mockDeleteDocument = vi.fn();

vi.mock('../services/api', () => ({
  applicantService: {
    getDocuments: (...a: unknown[]) => mockGetDocuments(...a) as unknown,
    uploadDocument: (...a: unknown[]) => mockUploadDocument(...a) as unknown,
    deleteDocument: (...a: unknown[]) => mockDeleteDocument(...a) as unknown,
  },
}));

const applicant = {
  id: 'app-1',
  first_name: 'Riley',
  last_name: 'Bishop',
  status: 'active',
  current_stage_id: 'stage-4',
} as unknown as Applicant;

const document = {
  id: 'doc-1',
  applicant_id: 'app-1',
  stage_id: 'stage-4',
  document_type: 'background_check',
  file_name: 'Membership Application.pdf',
  file_url: '/api/v1/prospective-members/prospects/app-1/documents/doc-1/download',
  file_size: 1536,
  mime_type: 'application/pdf',
  uploaded_by: 'user-1',
  uploaded_at: '2026-08-09T14:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetDocuments.mockResolvedValue([document]);
  mockDeleteDocument.mockResolvedValue(undefined);
  mockUploadDocument.mockImplementation((_id: string, _stage: string, _type: string, file: File) =>
    Promise.resolve({ ...document, id: 'doc-2', file_name: file.name })
  );
});

describe('ApplicantDocumentsSection', () => {
  // The API and the client method existed from the start; nothing rendered
  // them, so a file could be uploaded only by calling the endpoint directly and
  // could never be read back.
  it('lists a document with a link that downloads it', async () => {
    renderWithRouter(<ApplicantDocumentsSection applicant={applicant} tz="America/New_York" />);

    const link = await screen.findByRole('link', { name: /Membership Application\.pdf/ });
    expect(link).toHaveAttribute('href', '/api/v1/prospective-members/prospects/app-1/documents/doc-1/download');
  });

  it('names the document type rather than printing the stored value', async () => {
    renderWithRouter(<ApplicantDocumentsSection applicant={applicant} tz="America/New_York" />);

    expect(await screen.findByText(/Background Check/)).toBeInTheDocument();
  });

  it('says what may be uploaded when there is nothing yet', async () => {
    mockGetDocuments.mockResolvedValue([]);
    renderWithRouter(<ApplicantDocumentsSection applicant={applicant} tz="America/New_York" />);

    expect(await screen.findByText(/No documents yet\. Up to 50 MB each/)).toBeInTheDocument();
  });

  it('uploads a chosen file and shows it without a reload', async () => {
    renderWithRouter(<ApplicantDocumentsSection applicant={applicant} tz="America/New_York" />);
    await screen.findByRole('link', { name: /Membership Application\.pdf/ });

    const input = screen.getByLabelText('Upload a document for this applicant');
    await userEvent.upload(input, new File(['x'], "Driver's License.pdf", { type: 'application/pdf' }));

    await waitFor(() =>
      expect(mockUploadDocument).toHaveBeenCalledWith(
        'app-1',
        'stage-4',
        'application',
        expect.objectContaining({ name: "Driver's License.pdf" })
      )
    );
    expect(await screen.findByRole('link', { name: /Driver's License\.pdf/ })).toBeInTheDocument();
  });

  it('asks before removing one, and removes it when told to', async () => {
    renderWithRouter(<ApplicantDocumentsSection applicant={applicant} tz="America/New_York" />);

    await userEvent.click(await screen.findByRole('button', { name: /Remove Membership Application\.pdf/ }));
    await userEvent.click(await screen.findByRole('button', { name: /^Remove document$/ }));

    await waitFor(() => expect(mockDeleteDocument).toHaveBeenCalledWith('app-1', 'doc-1'));
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: /Membership Application\.pdf/ })).not.toBeInTheDocument()
    );
  });

  /**
   * A document-upload stage advances only when a document exists for each of
   * its configured type labels. Every upload used to be stored as
   * 'application', so a stage naming anything else could never be satisfied
   * from this screen — and no free-text box can be, since one typo produces a
   * requirement that silently stays unmet.
   */
  describe('a stage that names required document types', () => {
    const onDocumentStage = {
      ...applicant,
      current_stage_type: 'document_upload',
      current_stage_config: {
        required_document_types: ['Background Check', 'Photo ID', '   '],
        allow_multiple: true,
      },
    } as unknown as Applicant;

    it('offers each configured label as its own control', async () => {
      mockGetDocuments.mockResolvedValue([]);
      renderWithRouter(<ApplicantDocumentsSection applicant={onDocumentStage} tz="America/New_York" />);

      expect(await screen.findByRole('button', { name: /Upload the Background Check document/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Upload the Photo ID document/ })).toBeInTheDocument();
    });

    // The stage builder seeds the list with one blank row.
    it('ignores a blank row rather than offering a document called nothing', async () => {
      mockGetDocuments.mockResolvedValue([]);
      renderWithRouter(<ApplicantDocumentsSection applicant={onDocumentStage} tz="America/New_York" />);

      await screen.findByRole('button', { name: /Upload the Background Check document/ });
      expect(screen.getAllByRole('button', { name: /^Upload the .* document$/ })).toHaveLength(2);
    });

    it('files the upload under the label whose control was used', async () => {
      mockGetDocuments.mockResolvedValue([]);
      renderWithRouter(<ApplicantDocumentsSection applicant={onDocumentStage} tz="America/New_York" />);

      await userEvent.click(await screen.findByRole('button', { name: /Upload the Photo ID document/ }));
      const input = screen.getByLabelText('Upload a document for this applicant');
      await userEvent.upload(input, new File(['x'], 'id.pdf', { type: 'application/pdf' }));

      await waitFor(() =>
        expect(mockUploadDocument).toHaveBeenCalledWith(
          'app-1',
          'stage-4',
          'Photo ID',
          expect.objectContaining({ name: 'id.pdf' })
        )
      );
    });

    // Graded the way the server grades it: NFKC + strip + casefold on both
    // sides, so the tick cannot claim a requirement the stage still refuses.
    it('marks a requirement met when a document of that type is already filed', async () => {
      mockGetDocuments.mockResolvedValue([{ ...document, document_type: 'background check' }]);
      renderWithRouter(<ApplicantDocumentsSection applicant={onDocumentStage} tz="America/New_York" />);

      expect(await screen.findByRole('button', { name: /Replace the Background Check document/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Upload the Photo ID document/ })).toBeInTheDocument();
    });

    it('keeps the single generic control on a stage that names no types', async () => {
      mockGetDocuments.mockResolvedValue([]);
      renderWithRouter(<ApplicantDocumentsSection applicant={applicant} tz="America/New_York" />);

      expect(await screen.findByRole('button', { name: /^Upload$/ })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Upload the .* document$/ })).not.toBeInTheDocument();
    });
  });

  it('offers no upload or delete on an applicant who is no longer active', async () => {
    renderWithRouter(
      <ApplicantDocumentsSection
        applicant={{ ...applicant, status: 'withdrawn' } as unknown as Applicant}
        tz="America/New_York"
      />
    );

    await screen.findByRole('link', { name: /Membership Application\.pdf/ });
    expect(screen.queryByLabelText('Upload a document for this applicant')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove Membership Application\.pdf/ })).not.toBeInTheDocument();
  });
});
