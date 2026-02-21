import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Upload,
  Download,
  FileText,
  CheckCircle,
  ArrowRight,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { CSVMemberRow } from '../types/member';
import { userService } from '../services/api';
import { getErrorMessage } from '@/utils/errorHandling';

interface ImportResult {
  success: number;
  failed: number;
  errors: Array<{ row: number; error: string; data: any }>;
}

const ImportMembers: React.FC = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [validating, setValidating] = useState(false);
  const [previewData, setPreviewData] = useState<CSVMemberRow[]>([]);
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

      if (!rows[0] || rows[0].length === 0) {
        toast.error('The file is empty or has no header row.');
        setValidating(false);
        return;
      }

      // Check headers
      const headers = rows[0].map((h) => h.trim().toLowerCase());
      const requiredHeaders = [
        'firstname',
        'lastname',
        'departmentid',
        'street',
        'city',
        'state',
        'zipcode',
        'primaryphone',
        'email',
        'joindate',
        'emergencyname1',
        'emergencyrelationship1',
        'emergencyphone1',
      ];

      const missingHeaders = requiredHeaders.filter((h) => !headers.includes(h));
      if (missingHeaders.length > 0) {
        toast.error(`Missing required columns: ${missingHeaders.join(', ')}`);
        setValidating(false);
        return;
      }

      // Parse preview (first 5 rows)
      const preview: CSVMemberRow[] = [];
      for (let i = 1; i < Math.min(6, rows.length); i++) {
        if (rows[i].length < 2) continue; // Skip empty rows

        const row = rows[i];
        preview.push({
          firstName: row[headers.indexOf('firstname')]?.trim() || '',
          lastName: row[headers.indexOf('lastname')]?.trim() || '',
          middleName: row[headers.indexOf('middlename')]?.trim(),
          departmentId: row[headers.indexOf('departmentid')]?.trim() || '',
          dateOfBirth: row[headers.indexOf('dateofbirth')]?.trim(),
          street: row[headers.indexOf('street')]?.trim() || '',
          city: row[headers.indexOf('city')]?.trim() || '',
          state: row[headers.indexOf('state')]?.trim() || '',
          zipCode: row[headers.indexOf('zipcode')]?.trim() || '',
          primaryPhone: row[headers.indexOf('primaryphone')]?.trim() || '',
          secondaryPhone: row[headers.indexOf('secondaryphone')]?.trim(),
          email: row[headers.indexOf('email')]?.trim() || '',
          joinDate: row[headers.indexOf('joindate')]?.trim() || '',
          status: row[headers.indexOf('status')]?.trim(),
          rank: row[headers.indexOf('rank')]?.trim(),
          role: row[headers.indexOf('role')]?.trim(),
          station: row[headers.indexOf('station')]?.trim(),
          emergencyName1: row[headers.indexOf('emergencyname1')]?.trim() || '',
          emergencyRelationship1: row[headers.indexOf('emergencyrelationship1')]?.trim() || '',
          emergencyPhone1: row[headers.indexOf('emergencyphone1')]?.trim() || '',
          emergencyEmail1: row[headers.indexOf('emergencyemail1')]?.trim(),
          emergencyName2: row[headers.indexOf('emergencyname2')]?.trim(),
          emergencyRelationship2: row[headers.indexOf('emergencyrelationship2')]?.trim(),
          emergencyPhone2: row[headers.indexOf('emergencyphone2')]?.trim(),
          emergencyEmail2: row[headers.indexOf('emergencyemail2')]?.trim(),
        });
      }

      setPreviewData(preview);
      toast.success(`File validated successfully! Found ${rows.length - 1} members to import.`);
    } catch (_error) {
      toast.error('Failed to parse CSV file. Please check the format.');
    }
    setValidating(false);
  };

  const handleImport = async () => {
    if (!file) return;

    setImporting(true);
    const result: ImportResult = {
      success: 0,
      failed: 0,
      errors: [],
    };

    try {
      const text = await file.text();
      const rows = text.split('\n').map((row) => row.split(','));

      if (!rows[0] || rows[0].length === 0) {
        result.errors.push({ row: 0, error: 'The file is empty or has no header row.', data: null });
        setImportResult(result);
        setImporting(false);
        return;
      }

      const headers = rows[0].map((h) => h.trim().toLowerCase());

      // Process each row (skip header)
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row.length < 2) continue; // Skip empty rows

        const rowData: CSVMemberRow = {
          firstName: row[headers.indexOf('firstname')]?.trim() || '',
          lastName: row[headers.indexOf('lastname')]?.trim() || '',
          middleName: row[headers.indexOf('middlename')]?.trim(),
          departmentId: row[headers.indexOf('departmentid')]?.trim() || '',
          dateOfBirth: row[headers.indexOf('dateofbirth')]?.trim(),
          street: row[headers.indexOf('street')]?.trim() || '',
          city: row[headers.indexOf('city')]?.trim() || '',
          state: row[headers.indexOf('state')]?.trim() || '',
          zipCode: row[headers.indexOf('zipcode')]?.trim() || '',
          primaryPhone: row[headers.indexOf('primaryphone')]?.trim() || '',
          secondaryPhone: row[headers.indexOf('secondaryphone')]?.trim(),
          email: row[headers.indexOf('email')]?.trim() || '',
          joinDate: row[headers.indexOf('joindate')]?.trim() || '',
          status: row[headers.indexOf('status')]?.trim(),
          rank: row[headers.indexOf('rank')]?.trim(),
          role: row[headers.indexOf('role')]?.trim(),
          station: row[headers.indexOf('station')]?.trim(),
          emergencyName1: row[headers.indexOf('emergencyname1')]?.trim() || '',
          emergencyRelationship1: row[headers.indexOf('emergencyrelationship1')]?.trim() || '',
          emergencyPhone1: row[headers.indexOf('emergencyphone1')]?.trim() || '',
          emergencyEmail1: row[headers.indexOf('emergencyemail1')]?.trim(),
          emergencyName2: row[headers.indexOf('emergencyname2')]?.trim(),
          emergencyRelationship2: row[headers.indexOf('emergencyrelationship2')]?.trim(),
          emergencyPhone2: row[headers.indexOf('emergencyphone2')]?.trim(),
          emergencyEmail2: row[headers.indexOf('emergencyemail2')]?.trim(),
        };

        // Skip rows without required fields
        if (!rowData.firstName || !rowData.lastName || !rowData.email) {
          result.failed++;
          result.errors.push({
            row: i + 1,
            error: 'Missing required fields (firstName, lastName, or email)',
            data: rowData,
          });
          continue;
        }

        try {
          // Generate username from email
          const username = rowData.email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '_');

          // Build emergency contacts array
          const emergencyContacts: Array<{
            name: string;
            relationship: string;
            phone: string;
            email?: string;
            is_primary: boolean;
          }> = [];

          if (rowData.emergencyName1) {
            emergencyContacts.push({
              name: rowData.emergencyName1,
              relationship: rowData.emergencyRelationship1,
              phone: rowData.emergencyPhone1,
              email: rowData.emergencyEmail1 || undefined,
              is_primary: true,
            });
          }

          if (rowData.emergencyName2) {
            emergencyContacts.push({
              name: rowData.emergencyName2,
              relationship: rowData.emergencyRelationship2 || '',
              phone: rowData.emergencyPhone2 || '',
              email: rowData.emergencyEmail2 || undefined,
              is_primary: false,
            });
          }

          // Call the API
          await userService.createMember({
            username,
            email: rowData.email,
            first_name: rowData.firstName,
            middle_name: rowData.middleName || undefined,
            last_name: rowData.lastName,
            badge_number: rowData.departmentId || undefined,
            phone: rowData.primaryPhone || undefined,
            mobile: rowData.secondaryPhone || undefined,
            date_of_birth: rowData.dateOfBirth || undefined,
            hire_date: rowData.joinDate || undefined,
            rank: rowData.rank || undefined,
            station: rowData.station || undefined,
            address_street: rowData.street || undefined,
            address_city: rowData.city || undefined,
            address_state: rowData.state || undefined,
            address_zip: rowData.zipCode || undefined,
            address_country: 'USA',
            emergency_contacts: emergencyContacts,
            send_welcome_email: true,
          });

          result.success++;
        } catch (error: unknown) {
          result.failed++;
          const errorMessage = getErrorMessage(error, 'Unknown error');
          result.errors.push({
            row: i + 1,
            error: errorMessage,
            data: rowData,
          });
        }
      }

      setImportResult(result);
      if (result.success > 0) {
        toast.success(`Successfully imported ${result.success} members!`);
      }
      if (result.failed > 0) {
        toast.error(`Failed to import ${result.failed} members. Check the error details below.`);
      }
    } catch (_error) {
      toast.error('Failed to process CSV file. Please try again.');
    }
    setImporting(false);
  };

  const downloadTemplate = () => {
    const headers = [
      'firstName',
      'lastName',
      'middleName',
      'departmentId',
      'dateOfBirth',
      'street',
      'city',
      'state',
      'zipCode',
      'primaryPhone',
      'secondaryPhone',
      'email',
      'joinDate',
      'status',
      'rank',
      'role',
      'station',
      'emergencyName1',
      'emergencyRelationship1',
      'emergencyPhone1',
      'emergencyEmail1',
      'emergencyName2',
      'emergencyRelationship2',
      'emergencyPhone2',
      'emergencyEmail2',
    ];

    const exampleRow = [
      'John',
      'Doe',
      'Michael',
      'FF-001',
      '1985-03-15',
      '123 Main Street',
      'Springfield',
      'IL',
      '62701',
      '(555) 123-4567',
      '(555) 987-6543',
      'john.doe@example.com',
      '2020-01-15',
      'active',
      'Firefighter',
      'Engine Operator',
      'Station 1',
      'Jane Doe',
      'Spouse',
      '(555) 234-5678',
      'jane.doe@example.com',
      'Bob Doe',
      'Parent',
      '(555) 345-6789',
      'bob.doe@example.com',
    ];

    const csv = [headers.join(','), exampleRow.join(',')].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'member-import-template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast.success('Template downloaded!');
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-theme-input-bg backdrop-blur-sm border-b border-theme-surface-border px-6 py-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="bg-purple-600 rounded-lg p-2">
                <Upload className="w-6 h-6 text-theme-text-primary" />
              </div>
              <div>
                <h1 className="text-theme-text-primary text-xl font-bold">Import Members from CSV</h1>
                <p className="text-theme-text-muted text-sm">Bulk import member records</p>
              </div>
            </div>
            <button
              onClick={() => navigate('/members')}
              className="text-theme-text-secondary hover:text-theme-text-primary transition-colors text-sm"
            >
              ← Back to Members
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Instructions */}
        <div className="bg-blue-500/10 border border-blue-500/50 rounded-lg p-6 mb-8">
          <h2 className="text-theme-text-primary font-bold mb-3 flex items-center space-x-2">
            <FileText className="w-5 h-5 text-blue-700 dark:text-blue-400" />
            <span>How to Import Members</span>
          </h2>
          <ol className="text-blue-200 text-sm space-y-2 ml-6 list-decimal">
            <li>Download the CSV template below</li>
            <li>Fill in member information in the template</li>
            <li>Upload your completed CSV file</li>
            <li>Review the preview and import</li>
          </ol>

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
        <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-8 border border-theme-surface-border mb-8">
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

        {/* Preview */}
        {previewData.length > 0 && !importResult && (
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-8 border border-theme-surface-border mb-8">
            <h2 className="text-theme-text-primary font-bold mb-4">Step 2: Preview Data</h2>
            <p className="text-theme-text-secondary text-sm mb-4">
              Showing first {previewData.length} members from the file
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-theme-input-bg border-b border-theme-surface-border">
                  <tr>
                    <th className="px-4 py-2 text-left text-theme-text-secondary">Name</th>
                    <th className="px-4 py-2 text-left text-theme-text-secondary">Dept ID</th>
                    <th className="px-4 py-2 text-left text-theme-text-secondary">Email</th>
                    <th className="px-4 py-2 text-left text-theme-text-secondary">Phone</th>
                    <th className="px-4 py-2 text-left text-theme-text-secondary">Emergency Contact</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {previewData.map((row, index) => (
                    <tr key={index} className="hover:bg-theme-surface-secondary">
                      <td className="px-4 py-2 text-theme-text-primary">
                        {row.firstName} {row.lastName}
                      </td>
                      <td className="px-4 py-2 text-theme-text-secondary font-mono">{row.departmentId}</td>
                      <td className="px-4 py-2 text-theme-text-secondary">{row.email}</td>
                      <td className="px-4 py-2 text-theme-text-secondary">{row.primaryPhone}</td>
                      <td className="px-4 py-2 text-theme-text-secondary">
                        {row.emergencyName1} ({row.emergencyRelationship1})
                      </td>
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
                    <span>Import All Members</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Import Results */}
        {importResult && (
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-8 border border-theme-surface-border">
            <div className="text-center mb-6">
              <CheckCircle className="w-16 h-16 text-green-700 dark:text-green-400 mx-auto mb-4" />
              <h2 className="text-theme-text-primary text-2xl font-bold mb-2">Import Complete!</h2>
              <p className="text-theme-text-secondary">
                Successfully imported {importResult.success} members
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
                <h3 className="text-red-700 dark:text-red-300 font-bold mb-2">Errors:</h3>
                <div className="space-y-1 text-sm">
                  {importResult.errors.map((error, index) => (
                    <p key={index} className="text-red-200">
                      Row {error.row}: {error.error}
                    </p>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-center space-x-3">
              <button
                onClick={() => navigate('/members')}
                className="flex items-center space-x-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                <span>View Members</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default ImportMembers;
