import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

const mockExportItems = vi.fn();
const mockExportLots = vi.fn();
const mockTemplate = vi.fn();
const mockImport = vi.fn();
const mockToastError = vi.fn();
const mockToastSuccess = vi.fn();

vi.mock('../../../services/medicalSuppliesService', () => ({
  medicalSuppliesService: {
    exportItemsCsv: (...args: unknown[]) => mockExportItems(...args) as unknown,
    exportLotsCsv: (...args: unknown[]) => mockExportLots(...args) as unknown,
    downloadImportTemplate: (...args: unknown[]) => mockTemplate(...args) as unknown,
    importItemsCsv: (...args: unknown[]) => mockImport(...args) as unknown,
  },
}));

vi.mock('../../../stores/authStore', () => {
  const state = { user: { timezone: 'America/New_York' } };
  return {
    useAuthStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state),
  };
});

vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => mockToastSuccess(...args) as unknown,
    error: (...args: unknown[]) => mockToastError(...args) as unknown,
  },
}));

import { MedicalImportExportModal } from './MedicalImportExportModal';

const csvFile = (name = 'supplies.csv') => new File(['Name,Category\nGauze,Airway\n'], name, { type: 'text/csv' });

const importResult = (overrides: Record<string, unknown> = {}) => ({
  imported: 1,
  failed: 0,
  total_rows: 1,
  errors: [],
  warnings: [],
  categories_created: [],
  ...overrides,
});

describe('MedicalImportExportModal', () => {
  const onClose = vi.fn();
  const onImported = vi.fn();

  beforeEach(() => {
    [
      mockExportItems,
      mockExportLots,
      mockTemplate,
      mockImport,
      mockToastError,
      mockToastSuccess,
      onClose,
      onImported,
    ].forEach((mock) => mock.mockReset());
    const blob = new Blob(['a,b\n'], { type: 'text/csv' });
    mockExportItems.mockResolvedValue(blob);
    mockExportLots.mockResolvedValue(blob);
    mockTemplate.mockResolvedValue(blob);
    mockImport.mockResolvedValue(importResult());
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    // jsdom cannot follow a download link and logs a navigation error for it.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  const renderModal = (filters = {}) =>
    renderWithRouter(<MedicalImportExportModal onClose={onClose} onImported={onImported} filters={filters} />);

  it("exports the supply list with the page's filters", async () => {
    renderModal({ search: 'gauze', category_id: 'cat-1' });

    await userEvent.click(screen.getByRole('button', { name: /export supply list/i }));

    await waitFor(() => expect(mockExportItems).toHaveBeenCalledWith({ search: 'gauze', category_id: 'cat-1' }));
    expect(screen.getByText(/uses the search and category filter/i)).toBeInTheDocument();
  });

  it('exports the lot list', async () => {
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: /export lot list/i }));

    await waitFor(() => expect(mockExportLots).toHaveBeenCalled());
  });

  it('downloads the template', async () => {
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: /download template/i }));

    await waitFor(() => expect(mockTemplate).toHaveBeenCalled());
  });

  it('reports a failed export rather than staying silent', async () => {
    mockExportLots.mockRejectedValue(new Error('Server unavailable'));
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: /export lot list/i }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Server unavailable'));
  });

  it('keeps Import disabled until a file is chosen', () => {
    renderModal();

    expect(screen.getByRole('button', { name: /^import$/i })).toBeDisabled();
  });

  it('imports the chosen file and shows created categories and row errors', async () => {
    mockImport.mockResolvedValue(
      importResult({
        imported: 1,
        failed: 1,
        total_rows: 2,
        categories_created: ['Trauma'],
        warnings: ['Created 1 new medical supply category: "Trauma".'],
        errors: [{ row: 3, error: 'Category is required' }],
      })
    );
    renderModal();

    const file = csvFile();
    await userEvent.upload(screen.getByLabelText(/csv file to import/i), file);
    await userEvent.click(screen.getByRole('button', { name: /^import$/i }));

    await waitFor(() => expect(mockImport).toHaveBeenCalledWith(file));
    expect(await screen.findByText(/1 of 2 rows imported, 1 failed/i)).toBeInTheDocument();
    expect(screen.getByText(/Created 1 new medical supply category/)).toBeInTheDocument();
    expect(screen.getByText('Row 3: Category is required')).toBeInTheDocument();
    // Cleared so a second tap cannot import (and duplicate) the same rows.
    expect(screen.getByRole('button', { name: /^import$/i })).toBeDisabled();
  });

  it('refreshes the page on close only when the import wrote something', async () => {
    renderModal();

    await userEvent.upload(screen.getByLabelText(/csv file to import/i), csvFile());
    await userEvent.click(screen.getByRole('button', { name: /^import$/i }));
    await screen.findByText(/1 of 1 row imported/i);
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(onImported).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes without a refresh when nothing was imported', async () => {
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(onImported).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('refuses a file that is not a CSV', async () => {
    renderModal();

    await userEvent.upload(screen.getByLabelText(/csv file to import/i), csvFile('supplies.xlsx'), {
      applyAccept: false,
    });

    expect(mockToastError).toHaveBeenCalledWith('Choose a .csv file');
    expect(screen.getByRole('button', { name: /^import$/i })).toBeDisabled();
  });
});
