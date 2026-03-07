import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import ImportInventory from './ImportInventory';

// Mock the api module
const mockImportItemsCsv = vi.fn();
const mockDownloadImportTemplate = vi.fn();

vi.mock('../services/api', () => ({
  inventoryService: {
    importItemsCsv: (...args: unknown[]) => mockImportItemsCsv(...args) as unknown,
    downloadImportTemplate: (...args: unknown[]) => mockDownloadImportTemplate(...args) as unknown,
  },
}));

// Mock react-hot-toast
vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('ImportInventory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the page header and instructions', () => {
    renderWithRouter(<ImportInventory />);

    expect(screen.getByText('Import Inventory from CSV')).toBeInTheDocument();
    expect(screen.getByText('How to Import Inventory')).toBeInTheDocument();
    expect(screen.getByText('Download CSV Template')).toBeInTheDocument();
  });

  it('renders the file upload area', () => {
    renderWithRouter(<ImportInventory />);

    expect(screen.getByText('Click to upload CSV file')).toBeInTheDocument();
    expect(screen.getByText('or drag and drop')).toBeInTheDocument();
  });

  it('renders back to inventory link', () => {
    renderWithRouter(<ImportInventory />);

    const backLink = screen.getByText('← Back to Inventory');
    expect(backLink).toBeInTheDocument();
  });

  it('renders the step instructions in order', () => {
    renderWithRouter(<ImportInventory />);

    expect(screen.getByText('Download the CSV template below')).toBeInTheDocument();
    expect(screen.getByText(/Categories are matched by name/)).toBeInTheDocument();
    expect(screen.getByText(/Barcodes are auto-generated/)).toBeInTheDocument();
  });

  it('renders file input with csv accept', () => {
    renderWithRouter(<ImportInventory />);

    const input = document.querySelector('input[type="file"][accept=".csv"]');
    expect(input).toBeInTheDocument();
  });

  it('calls downloadImportTemplate when template button clicked', async () => {
    const user = userEvent.setup();
    const mockBlob = new Blob(['csv data'], { type: 'text/csv' });
    mockDownloadImportTemplate.mockResolvedValue(mockBlob);

    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();

    renderWithRouter(<ImportInventory />);

    const templateButton = screen.getByText('Download CSV Template');
    await user.click(templateButton);

    // Wait for the async call
    await vi.waitFor(() => {
      expect(mockDownloadImportTemplate).toHaveBeenCalledTimes(1);
    });

    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it('shows file name and remove button after selecting a file', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ImportInventory />);

    const csvContent = 'Name,Category,Status\nTest Item,Tools,available\n';
    const file = new File([csvContent], 'test-import.csv', { type: 'text/csv' });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    await vi.waitFor(() => {
      expect(screen.getByText('test-import.csv')).toBeInTheDocument();
      expect(screen.getByText('Remove file')).toBeInTheDocument();
    });
  });

  it('clears file when remove button is clicked', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ImportInventory />);

    const csvContent = 'Name\nItem\n';
    const file = new File([csvContent], 'items.csv', { type: 'text/csv' });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    await vi.waitFor(() => {
      expect(screen.getByText('items.csv')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Remove file'));

    await vi.waitFor(() => {
      expect(screen.getByText('Click to upload CSV file')).toBeInTheDocument();
    });
  });
});
