import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Upload,
  Download,
  FileText,
  CheckCircle,
  ArrowRight,
  AlertTriangle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { inventoryService } from '../services/api';
import type { InventoryImportResult } from '../services/api';
import { getErrorMessage } from '@/utils/errorHandling';

interface PreviewRow {
  name: string;
  category: string;
  itemType: string;
  serialNumber: string;
  status: string;
  condition: string;
  quantity: string;
  trackingType: string;
}

const ImportInventory: React.FC = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [validating, setValidating] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [importResult, setImportResult] = useState<InventoryImportResult | null>(null);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    if (!selectedFile.name.endsWith('.csv')) {
      toast.error('Please select a CSV file');
      return;
    }

    setFile(selectedFile);
    setPreviewData([]);
    setImportResult(null);
    void validateFile(selectedFile);
  };

  const validateFile = async (csvFile: File) => {
    setValidating(true);
    try {
      const text = await csvFile.text();
      const rows = text.split('\n').map((row) => row.split(','));

      if (!rows[0] || rows[0].length === 0) {
        toast.error('The file is empty or has no header row.');
        setValidating(false);
        return;
      }

      const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/"/g, ''));
      const nameIdx = headers.findIndex((h) => h === 'name');

      if (nameIdx === -1) {
        toast.error('Missing required "Name" column. Download the template for the correct format.');
        setValidating(false);
        return;
      }

      const findCol = (names: string[]) => {
        for (const n of names) {
          const idx = headers.indexOf(n);
          if (idx !== -1) return idx;
        }
        return -1;
      };

      const catIdx = findCol(['category', 'category_name', 'categoryname']);
      const typeIdx = findCol(['item type', 'item_type', 'itemtype', 'type']);
      const snIdx = findCol(['serial number', 'serial_number', 'serialnumber']);
      const statusIdx = findCol(['status']);
      const condIdx = findCol(['condition']);
      const qtyIdx = findCol(['quantity']);
      const trackIdx = findCol(['tracking type', 'tracking_type', 'trackingtype']);

      // Count data rows (skip header, skip empty rows)
      let dataRowCount = 0;
      const preview: PreviewRow[] = [];

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.join('').trim() === '') continue;
        dataRowCount++;

        if (preview.length < 5) {
          const getValue = (idx: number) =>
            idx >= 0 ? (row[idx]?.trim().replace(/"/g, '') || '') : '';
          preview.push({
            name: getValue(nameIdx),
            category: getValue(catIdx),
            itemType: getValue(typeIdx),
            serialNumber: getValue(snIdx),
            status: getValue(statusIdx),
            condition: getValue(condIdx),
            quantity: getValue(qtyIdx),
            trackingType: getValue(trackIdx),
          });
        }
      }

      if (dataRowCount === 0) {
        toast.error('No data rows found in the file.');
        setValidating(false);
        return;
      }

      setTotalRows(dataRowCount);
      setPreviewData(preview);
      toast.success(`File validated! Found ${dataRowCount} item${dataRowCount === 1 ? '' : 's'} to import.`);
    } catch {
      toast.error('Failed to parse CSV file. Please check the format.');
    }
    setValidating(false);
  };

  const handleImport = async () => {
    if (!file) return;

    setImporting(true);
    try {
      const result = await inventoryService.importItemsCsv(file);
      setImportResult(result);

      if (result.imported > 0) {
        toast.success(`Successfully imported ${result.imported} item${result.imported === 1 ? '' : 's'}!`);
      }
      if (result.failed > 0) {
        toast.error(`${result.failed} item${result.failed === 1 ? '' : 's'} failed to import. Check the details below.`);
      }
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to import inventory items'));
    }
    setImporting(false);
  };

  const handleDownloadTemplate = async () => {
    try {
      const blob = await inventoryService.downloadImportTemplate();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'inventory_import_template.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Template downloaded!');
    } catch {
      toast.error('Failed to download template');
    }
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-theme-input-bg backdrop-blur-sm border-b border-theme-surface-border px-6 py-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="bg-blue-600 rounded-lg p-2">
                <Upload className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-theme-text-primary text-xl font-bold">Import Inventory from CSV</h1>
                <p className="text-theme-text-muted text-sm">Bulk import inventory items</p>
              </div>
            </div>
            <button
              onClick={() => navigate('/inventory')}
              className="text-theme-text-secondary hover:text-theme-text-primary transition-colors text-sm"
            >
              &larr; Back to Inventory
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Instructions */}
        <div className="bg-blue-500/10 border border-blue-500/50 rounded-lg p-6 mb-8">
          <h2 className="text-theme-text-primary font-bold mb-3 flex items-center space-x-2">
            <FileText className="w-5 h-5 text-blue-700 dark:text-blue-400" />
            <span>How to Import Inventory</span>
          </h2>
          <ol className="text-theme-text-secondary text-sm space-y-2 ml-6 list-decimal">
            <li>Download the CSV template below</li>
            <li>Fill in your inventory items (only <strong>Name</strong> is required)</li>
            <li>Categories are matched by name &mdash; create them first if needed</li>
            <li>Barcodes are auto-generated and should not be included</li>
            <li>Upload the completed CSV and review the preview</li>
          </ol>

          <div className="mt-4 pt-4 border-t border-blue-500/30">
            <button
              onClick={() => { void handleDownloadTemplate(); }}
              className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm font-medium"
            >
              <Download className="w-4 h-4" />
              <span>Download CSV Template</span>
            </button>
          </div>
        </div>

        {/* File Upload */}
        {!importResult && (
          <div className="bg-theme-surface border border-theme-surface-border rounded-lg mb-8 p-8">
            <h2 className="text-theme-text-primary font-bold mb-4">Step 1: Upload CSV File</h2>

            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-theme-input-border hover:border-blue-500 rounded-lg p-12 text-center cursor-pointer transition-colors"
            >
              <Upload className="w-16 h-16 text-theme-text-muted mx-auto mb-4" />
              {file ? (
                <>
                  <p className="text-theme-text-primary font-medium mb-1">{file.name}</p>
                  <p className="text-theme-text-muted text-sm">
                    {(file.size / 1024).toFixed(2)} KB
                  </p>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setFile(null);
                      setPreviewData([]);
                      setTotalRows(0);
                      setImportResult(null);
                    }}
                    className="mt-3 text-red-700 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-sm"
                  >
                    Remove file
                  </button>
                </>
              ) : (
                <>
                  <p className="text-theme-text-primary font-medium mb-1">Click to upload CSV file</p>
                  <p className="text-theme-text-muted text-sm">or drag and drop</p>
                </>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileSelect}
              className="hidden"
            />

            {validating && (
              <div className="mt-4 flex items-center justify-center space-x-2 text-blue-700 dark:text-blue-400">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-400"></div>
                <span>Validating file...</span>
              </div>
            )}
          </div>
        )}

        {/* Preview */}
        {previewData.length > 0 && !importResult && (
          <div className="bg-theme-surface border border-theme-surface-border rounded-lg mb-8 p-8">
            <h2 className="text-theme-text-primary font-bold mb-4">Step 2: Preview Data</h2>
            <p className="text-theme-text-secondary text-sm mb-4">
              Showing first {previewData.length} of {totalRows} item{totalRows === 1 ? '' : 's'} from the file
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-theme-input-bg border-b border-theme-surface-border">
                  <tr>
                    <th className="px-4 py-2 text-left text-theme-text-secondary">Name</th>
                    <th className="px-4 py-2 text-left text-theme-text-secondary">Category</th>
                    <th className="px-4 py-2 text-left text-theme-text-secondary">Type</th>
                    <th className="px-4 py-2 text-left text-theme-text-secondary">Serial #</th>
                    <th className="px-4 py-2 text-left text-theme-text-secondary">Status</th>
                    <th className="px-4 py-2 text-left text-theme-text-secondary">Qty</th>
                    <th className="px-4 py-2 text-left text-theme-text-secondary">Tracking</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-theme-surface-border">
                  {previewData.map((row, index) => (
                    <tr key={index} className="hover:bg-theme-surface-secondary">
                      <td className="px-4 py-2 text-theme-text-primary font-medium">{row.name}</td>
                      <td className="px-4 py-2 text-theme-text-secondary">{row.category || '—'}</td>
                      <td className="px-4 py-2 text-theme-text-secondary">{row.itemType || '—'}</td>
                      <td className="px-4 py-2 text-theme-text-secondary font-mono">{row.serialNumber || '—'}</td>
                      <td className="px-4 py-2 text-theme-text-secondary">{row.status || 'available'}</td>
                      <td className="px-4 py-2 text-theme-text-secondary">{row.quantity || '1'}</td>
                      <td className="px-4 py-2 text-theme-text-secondary">{row.trackingType || 'individual'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-6 flex items-center justify-end">
              <button
                onClick={() => { void handleImport(); }}
                disabled={importing}
                className="flex items-center space-x-2 px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white rounded-lg transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importing ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    <span>Importing...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-5 h-5" />
                    <span>Import {totalRows} Item{totalRows === 1 ? '' : 's'}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Import Results */}
        {importResult && (
          <div className="bg-theme-surface border border-theme-surface-border rounded-lg p-8">
            <div className="text-center mb-6">
              <CheckCircle className="w-16 h-16 text-green-700 dark:text-green-400 mx-auto mb-4" />
              <h2 className="text-theme-text-primary text-2xl font-bold mb-2">Import Complete!</h2>
              <p className="text-theme-text-secondary">
                Processed {importResult.total_rows} row{importResult.total_rows === 1 ? '' : 's'} from the CSV file
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 text-center">
                <p className="text-green-700 dark:text-green-400 text-2xl font-bold">{importResult.imported}</p>
                <p className="text-green-700 dark:text-green-300 text-sm">Successfully Imported</p>
              </div>
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-center">
                <p className="text-red-700 dark:text-red-400 text-2xl font-bold">{importResult.failed}</p>
                <p className="text-red-700 dark:text-red-300 text-sm">Failed</p>
              </div>
            </div>

            {importResult.warnings.length > 0 && (
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-4">
                <h3 className="text-yellow-700 dark:text-yellow-300 font-bold mb-2 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Warnings:
                </h3>
                <div className="space-y-1 text-sm">
                  {importResult.warnings.map((warning, index) => (
                    <p key={index} className="text-yellow-700 dark:text-yellow-200">
                      {warning}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {importResult.errors.length > 0 && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-6">
                <h3 className="text-red-700 dark:text-red-300 font-bold mb-2">Errors:</h3>
                <div className="space-y-1 text-sm">
                  {importResult.errors.map((error, index) => (
                    <p key={index} className="text-red-700 dark:text-red-200">
                      Row {error.row}: {error.error}
                    </p>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-center space-x-3">
              <button
                onClick={() => {
                  setFile(null);
                  setPreviewData([]);
                  setTotalRows(0);
                  setImportResult(null);
                }}
                className="flex items-center px-6 py-3 space-x-2 border border-theme-input-border text-theme-text-secondary hover:text-theme-text-primary rounded-lg transition-colors"
              >
                <Upload className="w-4 h-4" />
                <span>Import More</span>
              </button>
              <button
                onClick={() => navigate('/inventory')}
                className="flex items-center px-6 py-3 space-x-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                <span>View Inventory</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default ImportInventory;
