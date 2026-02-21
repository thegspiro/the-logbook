import React, { useState, useRef } from 'react';
import {
  Upload,
  Download,
  FileText,
  CheckCircle,
  AlertTriangle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { trainingService } from '../services/api';
import { getErrorMessage } from '@/utils/errorHandling';

interface CSVTrainingRow {
  memberEmail: string;
  courseName: string;
  trainingType: string;
  completionDate: string;
  hoursCompleted: string;
  courseCode?: string;
  instructor?: string;
  location?: string;
  certificationNumber?: string;
  issuingAgency?: string;
  expirationDate?: string;
  creditHours?: string;
  score?: string;
  status?: string;
  notes?: string;
}

interface ImportResult {
  success: number;
  failed: number;
  errors: Array<{ row: number; error: string }>;
}

const REQUIRED_HEADERS = [
  'memberemail',
  'coursename',
  'trainingtype',
  'completiondate',
  'hourscompleted',
];

const VALID_TRAINING_TYPES = [
  'certification',
  'continuing_education',
  'skills_practice',
  'orientation',
  'refresher',
  'specialty',
];

const ImportTrainingPage: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [validating, setValidating] = useState(false);
  const [previewData, setPreviewData] = useState<CSVTrainingRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

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
    validateFile(selectedFile);
  };

  const validateFile = async (file: File) => {
    setValidating(true);
    try {
      const text = await file.text();
      const rows = text.split('\n').map((row) => row.split(','));

      const headers = rows[0].map((h) => h.trim().toLowerCase());
      const missingHeaders = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
      if (missingHeaders.length > 0) {
        toast.error(`Missing required columns: ${missingHeaders.join(', ')}`);
        setValidating(false);
        return;
      }

      // Parse preview (first 5 data rows)
      const preview: CSVTrainingRow[] = [];
      let dataRowCount = 0;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i].length < 2) continue;
        dataRowCount++;

        if (preview.length < 5) {
          const row = rows[i];
          preview.push({
            memberEmail: row[headers.indexOf('memberemail')]?.trim() || '',
            courseName: row[headers.indexOf('coursename')]?.trim() || '',
            trainingType: row[headers.indexOf('trainingtype')]?.trim() || '',
            completionDate: row[headers.indexOf('completiondate')]?.trim() || '',
            hoursCompleted: row[headers.indexOf('hourscompleted')]?.trim() || '',
            courseCode: row[headers.indexOf('coursecode')]?.trim(),
            instructor: row[headers.indexOf('instructor')]?.trim(),
            location: row[headers.indexOf('location')]?.trim(),
            certificationNumber: row[headers.indexOf('certificationnumber')]?.trim(),
            issuingAgency: row[headers.indexOf('issuingagency')]?.trim(),
            expirationDate: row[headers.indexOf('expirationdate')]?.trim(),
            creditHours: row[headers.indexOf('credithours')]?.trim(),
            score: row[headers.indexOf('score')]?.trim(),
            status: row[headers.indexOf('status')]?.trim(),
            notes: row[headers.indexOf('notes')]?.trim(),
          });
        }
      }

      setPreviewData(preview);
      setTotalRows(dataRowCount);
      toast.success(`File validated! Found ${dataRowCount} training records.`);
    } catch (_error) {
      toast.error('Failed to parse CSV file. Please check the format.');
    }
    setValidating(false);
  };

  const handleImport = async () => {
    if (!file) return;

    setImporting(true);
    try {
      const result = await trainingService.importCSV(file);
      setImportResult(result);
      if (result.success > 0) {
        toast.success(`Successfully imported ${result.success} training records!`);
      }
      if (result.failed > 0) {
        toast.error(`Failed to import ${result.failed} records. See details below.`);
      }
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to import training records'));
    }
    setImporting(false);
  };

  const downloadTemplate = () => {
    const headers = [
      'memberEmail',
      'courseName',
      'trainingType',
      'completionDate',
      'hoursCompleted',
      'courseCode',
      'instructor',
      'location',
      'certificationNumber',
      'issuingAgency',
      'expirationDate',
      'creditHours',
      'score',
      'status',
      'notes',
    ];

    const exampleRows = [
      [
        'john.doe@example.com',
        'Wildland Firefighting S-130/S-190',
        'certification',
        '2024-01-15',
        '40',
        'WF-S130',
        'Chief Johnson',
        'State Training Center',
        'WF-2024-001',
        'State Fire Academy',
        '2026-01-15',
        '40',
        '95',
        'completed',
        'Completed with honors',
      ],
      [
        'jane.smith@example.com',
        'EMS Refresher Course',
        'continuing_education',
        '2024-03-20',
        '16',
        'EMS-REF',
        'Dr. Williams',
        'County Hospital',
        '',
        '',
        '',
        '16',
        '',
        'completed',
        '',
      ],
      [
        'bob.jones@example.com',
        'Pump Operations Skills',
        'skills_practice',
        '2024-02-10',
        '8',
        '',
        'Lt. Davis',
        'Station 1',
        '',
        '',
        '',
        '8',
        '',
        'completed',
        'Annual pump ops drill',
      ],
    ];

    const csv = [headers.join(','), ...exampleRows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'training-import-template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast.success('Template downloaded!');
  };

  return (
    <div>
      {/* Instructions */}
      <div className="bg-blue-500/10 border border-blue-500/50 rounded-lg p-6 mb-8">
        <h2 className="text-theme-text-primary font-bold mb-3 flex items-center space-x-2">
          <FileText className="w-5 h-5 text-blue-700 dark:text-blue-400" />
          <span>How to Import Historical Training</span>
        </h2>
        <ol className="text-theme-text-secondary text-sm space-y-2 ml-6 list-decimal">
          <li>Download the CSV template below</li>
          <li>Fill in training records — use member emails to match records to members</li>
          <li>Upload your completed CSV file</li>
          <li>Review the preview and import</li>
        </ol>

        <div className="mt-3 text-xs text-theme-text-muted">
          <p className="font-medium mb-1">Required columns:</p>
          <p>memberEmail, courseName, trainingType, completionDate, hoursCompleted</p>
          <p className="font-medium mt-2 mb-1">Valid training types:</p>
          <p>{VALID_TRAINING_TYPES.join(', ')}</p>
          <p className="font-medium mt-2 mb-1">Date format:</p>
          <p>YYYY-MM-DD (e.g., 2024-06-15)</p>
        </div>

        <div className="mt-4 pt-4 border-t border-blue-500/30">
          <button
            onClick={downloadTemplate}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            <Download className="w-4 h-4" />
            <span>Download CSV Template</span>
          </button>
        </div>
      </div>

      {/* File Upload */}
      <div className="bg-theme-surface rounded-lg p-8 border border-theme-surface-border mb-8">
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
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-current"></div>
            <span>Validating file...</span>
          </div>
        )}
      </div>

      {/* Preview */}
      {previewData.length > 0 && !importResult && (
        <div className="bg-theme-surface rounded-lg p-8 border border-theme-surface-border mb-8">
          <h2 className="text-theme-text-primary font-bold mb-4">Step 2: Preview Data</h2>
          <p className="text-theme-text-secondary text-sm mb-4">
            Showing first {previewData.length} of {totalRows} training records
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-theme-input-bg border-b border-theme-surface-border">
                <tr>
                  <th className="px-4 py-2 text-left text-theme-text-secondary">Member Email</th>
                  <th className="px-4 py-2 text-left text-theme-text-secondary">Course</th>
                  <th className="px-4 py-2 text-left text-theme-text-secondary">Type</th>
                  <th className="px-4 py-2 text-left text-theme-text-secondary">Date</th>
                  <th className="px-4 py-2 text-left text-theme-text-secondary">Hours</th>
                  <th className="px-4 py-2 text-left text-theme-text-secondary">Instructor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-theme-surface-border">
                {previewData.map((row, index) => (
                  <tr key={index} className="hover:bg-theme-surface-secondary">
                    <td className="px-4 py-2 text-theme-text-primary font-mono text-xs">{row.memberEmail}</td>
                    <td className="px-4 py-2 text-theme-text-primary">{row.courseName}</td>
                    <td className="px-4 py-2 text-theme-text-secondary">{row.trainingType}</td>
                    <td className="px-4 py-2 text-theme-text-secondary">{row.completionDate}</td>
                    <td className="px-4 py-2 text-theme-text-secondary">{row.hoursCompleted}</td>
                    <td className="px-4 py-2 text-theme-text-secondary">{row.instructor || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 flex items-center justify-end">
            <button
              onClick={handleImport}
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
                  <span>Import {totalRows} Training Records</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Import Results */}
      {importResult && (
        <div className="bg-theme-surface rounded-lg p-8 border border-theme-surface-border">
          <div className="text-center mb-6">
            <CheckCircle className="w-16 h-16 text-green-700 dark:text-green-400 mx-auto mb-4" />
            <h2 className="text-theme-text-primary text-2xl font-bold mb-2">Import Complete!</h2>
            <p className="text-theme-text-secondary">
              Successfully imported {importResult.success} training records
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 text-center">
              <p className="text-green-700 dark:text-green-400 text-2xl font-bold">{importResult.success}</p>
              <p className="text-green-700 dark:text-green-300 text-sm">Successful</p>
            </div>
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-center">
              <p className="text-red-700 dark:text-red-400 text-2xl font-bold">{importResult.failed}</p>
              <p className="text-red-700 dark:text-red-300 text-sm">Failed</p>
            </div>
          </div>

          {importResult.errors.length > 0 && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-6">
              <h3 className="text-red-700 dark:text-red-300 font-bold mb-2 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Errors
              </h3>
              <div className="space-y-1 text-sm max-h-60 overflow-y-auto">
                {importResult.errors.map((error, index) => (
                  <p key={index} className="text-red-700 dark:text-red-300">
                    Row {error.row}: {error.error}
                  </p>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-center">
            <button
              onClick={() => {
                setFile(null);
                setPreviewData([]);
                setTotalRows(0);
                setImportResult(null);
              }}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              Import More Records
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImportTrainingPage;
