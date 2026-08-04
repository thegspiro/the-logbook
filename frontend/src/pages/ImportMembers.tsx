import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router';
import {
  Upload,
  Download,
  FileText,
  CheckCircle,
  ArrowRight,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { CSVMemberRow } from '../types/member';
import { userService, roleService } from '../services/api';
import { getErrorMessage } from '@/utils/errorHandling';

interface ImportResult {
  success: number;
  failed: number;
  errors: Array<{ row: number; error: string; data: unknown }>;
}

/**
 * Columns emitted by the downloadable template, in display order.
 *
 * The validator below derives its required/recommended sets from this list, so
 * the template can never again ship a file that its own validator rejects.
 * `status` is deliberately absent: POST /users always creates members as
 * Active and has no field to override it, so a status column would silently
 * discard whatever the department typed.
 */
const TEMPLATE_HEADERS = [
  'firstName',
  'lastName',
  'middleName',
  'membershipNumber',
  'username',
  'dateOfBirth',
  'street',
  'city',
  'state',
  'zipCode',
  'primaryPhone',
  'secondaryPhone',
  'email',
  'joinDate',
  'rank',
  'role',
  'station',
  'platoon',
  'emergencyName1',
  'emergencyRelationship1',
  'emergencyPhone1',
  'emergencyEmail1',
  'emergencyName2',
  'emergencyRelationship2',
  'emergencyPhone2',
  'emergencyEmail2',
] as const;

/**
 * Only these three are enforced as hard requirements, because they are the only
 * fields `AdminUserCreate` rejects a request without. Membership numbers are
 * auto-assigned server-side when omitted, and every other column maps to an
 * Optional backend field — blocking the upload on them turns a partial roster
 * into an unimportable one.
 */
const REQUIRED_HEADERS = ['firstname', 'lastname', 'email'] as const;

/**
 * `departmentId` is the legacy spelling of `membershipNumber` from earlier
 * versions of this template. Accept either so rosters built from an older
 * download still import.
 */
const MEMBERSHIP_NUMBER_HEADERS = ['membershipnumber', 'departmentid'] as const;

const OPTIONAL_HEADERS = TEMPLATE_HEADERS.filter(
  (h) => !(REQUIRED_HEADERS as readonly string[]).includes(h.toLowerCase())
);

/**
 * Minimal RFC 4180 parser. A plain `split(',')` shifts every column right of a
 * quoted address ("123 Main St, Apt 4") — which surfaces as bogus "missing
 * required field" errors on rows that are actually well-formed.
 */
const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      // Treat CRLF as a single terminator.
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
};

const isBlankRow = (row: string[]): boolean => row.every((cell) => cell.trim() === '');

const cell = (row: string[], headers: string[], name: string): string | undefined => {
  const index = headers.indexOf(name);
  if (index === -1) return undefined;
  return row[index]?.trim();
};

const buildRow = (row: string[], headers: string[]): CSVMemberRow => ({
  firstName: cell(row, headers, 'firstname') || '',
  lastName: cell(row, headers, 'lastname') || '',
  middleName: cell(row, headers, 'middlename'),
  membershipNumber:
    MEMBERSHIP_NUMBER_HEADERS.map((h) => cell(row, headers, h)).find((v) => v) || '',
  username: cell(row, headers, 'username'),
  dateOfBirth: cell(row, headers, 'dateofbirth'),
  street: cell(row, headers, 'street') || '',
  city: cell(row, headers, 'city') || '',
  state: cell(row, headers, 'state') || '',
  zipCode: cell(row, headers, 'zipcode') || '',
  primaryPhone: cell(row, headers, 'primaryphone') || '',
  secondaryPhone: cell(row, headers, 'secondaryphone'),
  email: cell(row, headers, 'email') || '',
  joinDate: cell(row, headers, 'joindate') || '',
  status: cell(row, headers, 'status'),
  rank: cell(row, headers, 'rank'),
  role: cell(row, headers, 'role'),
  station: cell(row, headers, 'station'),
  platoon: cell(row, headers, 'platoon'),
  emergencyName1: cell(row, headers, 'emergencyname1') || '',
  emergencyRelationship1: cell(row, headers, 'emergencyrelationship1') || '',
  emergencyPhone1: cell(row, headers, 'emergencyphone1') || '',
  emergencyEmail1: cell(row, headers, 'emergencyemail1'),
  emergencyName2: cell(row, headers, 'emergencyname2'),
  emergencyRelationship2: cell(row, headers, 'emergencyrelationship2'),
  emergencyPhone2: cell(row, headers, 'emergencyphone2'),
  emergencyEmail2: cell(row, headers, 'emergencyemail2'),
});

/**
 * Row-level checks that mirror the backend's own constraints, so a bad cell is
 * reported against its row number here instead of coming back as an opaque 422.
 */
const validateRow = (data: CSVMemberRow): string | null => {
  const missing: string[] = [];
  if (!data.firstName) missing.push('firstName');
  if (!data.lastName) missing.push('lastName');
  if (!data.email) missing.push('email');
  if (missing.length > 0) {
    return `Missing required fields: ${missing.join(', ')}`;
  }

  // EmergencyContact requires name, relationship and phone together; a partial
  // contact is rejected by the API rather than saved with blanks.
  if (data.emergencyName1 && (!data.emergencyRelationship1 || !data.emergencyPhone1)) {
    return 'Emergency contact 1 needs both emergencyRelationship1 and emergencyPhone1';
  }
  if (data.emergencyName2 && (!data.emergencyRelationship2 || !data.emergencyPhone2)) {
    return 'Emergency contact 2 needs both emergencyRelationship2 and emergencyPhone2';
  }

  return null;
};

const usernameFromEmail = (email: string): string =>
  (email.split('@')[0] ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '_');

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
    void validateFile(selectedFile);
  };

  const validateFile = async (file: File) => {
    setValidating(true);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      const headerRow = rows[0];

      if (!headerRow || isBlankRow(headerRow)) {
        toast.error('The file is empty or has no header row.');
        setValidating(false);
        return;
      }

      const headers = headerRow.map((h) => h.trim().toLowerCase());

      const missingHeaders = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
      if (missingHeaders.length > 0) {
        toast.error(`Missing required columns: ${missingHeaders.join(', ')}`);
        setValidating(false);
        return;
      }

      const dataRows = rows.slice(1).filter((row) => !isBlankRow(row));
      if (dataRows.length === 0) {
        toast.error('The file has a header row but no member data.');
        setValidating(false);
        return;
      }

      const missingOptional = OPTIONAL_HEADERS.filter((h) => {
        const key = h.toLowerCase();
        // Either spelling of the membership number column satisfies this one.
        if (key === 'membershipnumber') {
          return !MEMBERSHIP_NUMBER_HEADERS.some((alias) => headers.includes(alias));
        }
        return !headers.includes(key);
      });
      if (missingOptional.length > 0) {
        const shown = missingOptional.slice(0, 4).join(', ');
        const rest = missingOptional.length - 4;
        toast(
          `Importing without ${missingOptional.length} optional column(s): ${shown}` +
            (rest > 0 ? ` and ${rest} more` : ''),
          { icon: '⚠️' }
        );
      }

      setPreviewData(dataRows.slice(0, 5).map((row) => buildRow(row, headers)));
      toast.success(`File validated successfully! Found ${dataRows.length} members to import.`);
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
      const rows = parseCsv(text);
      const headerRow = rows[0];

      if (!headerRow || isBlankRow(headerRow)) {
        result.errors.push({ row: 0, error: 'The file is empty or has no header row.', data: null });
        setImportResult(result);
        setImporting(false);
        return;
      }

      const headers = headerRow.map((h) => h.trim().toLowerCase());

      // Roles are named in the CSV but the API assigns them by id, so resolve
      // the org's roles once up front rather than per row.
      const rolesByName = new Map<string, string>();
      if (headers.includes('role')) {
        try {
          const roles = await roleService.getRoles();
          roles.forEach((role) => rolesByName.set(role.name.trim().toLowerCase(), role.id));
        } catch (_error) {
          toast.error('Could not load roles; the role column will be skipped.');
        }
      }

      // Process each row (skip header)
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || isBlankRow(row)) continue; // Skip empty rows

        const rowData = buildRow(row, headers);

        const validationError = validateRow(rowData);
        if (validationError) {
          result.failed++;
          result.errors.push({
            row: i + 1,
            error: validationError,
            data: rowData,
          });
          continue;
        }

        const roleId = rowData.role ? rolesByName.get(rowData.role.toLowerCase()) : undefined;
        if (rowData.role && rolesByName.size > 0 && !roleId) {
          result.failed++;
          result.errors.push({
            row: i + 1,
            error: `Unknown role "${rowData.role}". Create it under Roles first, or clear the column.`,
            data: rowData,
          });
          continue;
        }

        try {
          const username = rowData.username || usernameFromEmail(rowData.email);

          // Build emergency contacts array
          const emergencyContacts: Array<{
            name: string;
            relationship: string;
            phone: string;
            email?: string | undefined;
            is_primary: boolean;
          }> = [];

          if (rowData.emergencyName1) {
            emergencyContacts.push({
              name: rowData.emergencyName1,
              relationship: rowData.emergencyRelationship1,
              phone: rowData.emergencyPhone1,
              ...(rowData.emergencyEmail1 ? { email: rowData.emergencyEmail1 } : {}),
              is_primary: true,
            });
          }

          if (rowData.emergencyName2) {
            emergencyContacts.push({
              name: rowData.emergencyName2,
              relationship: rowData.emergencyRelationship2 || '',
              phone: rowData.emergencyPhone2 || '',
              ...(rowData.emergencyEmail2 ? { email: rowData.emergencyEmail2 } : {}),
              is_primary: false,
            });
          }

          // Call the API
          await userService.createMember({
            username,
            email: rowData.email,
            first_name: rowData.firstName,
            last_name: rowData.lastName,
            address_country: 'USA',
            emergency_contacts: emergencyContacts,
            send_welcome_email: true,
            ...(rowData.middleName ? { middle_name: rowData.middleName } : {}),
            ...(rowData.membershipNumber ? { membership_number: rowData.membershipNumber } : {}),
            ...(rowData.primaryPhone ? { phone: rowData.primaryPhone } : {}),
            ...(rowData.secondaryPhone ? { mobile: rowData.secondaryPhone } : {}),
            ...(rowData.dateOfBirth ? { date_of_birth: rowData.dateOfBirth } : {}),
            ...(rowData.joinDate ? { hire_date: rowData.joinDate } : {}),
            ...(rowData.rank ? { rank: rowData.rank } : {}),
            ...(rowData.station ? { station: rowData.station } : {}),
            ...(rowData.platoon ? { platoon: rowData.platoon } : {}),
            ...(rowData.street ? { address_street: rowData.street } : {}),
            ...(rowData.city ? { address_city: rowData.city } : {}),
            ...(rowData.state ? { address_state: rowData.state } : {}),
            ...(rowData.zipCode ? { address_zip: rowData.zipCode } : {}),
            ...(roleId ? { role_ids: [roleId] } : {}),
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
    const exampleValues: Record<(typeof TEMPLATE_HEADERS)[number], string> = {
      firstName: 'John',
      lastName: 'Doe',
      middleName: 'Michael',
      membershipNumber: 'FF-001',
      username: 'john.doe',
      dateOfBirth: '1985-03-15',
      street: '123 Main Street, Apt 4',
      city: 'Springfield',
      state: 'IL',
      zipCode: '62701',
      primaryPhone: '(555) 123-4567',
      secondaryPhone: '(555) 987-6543',
      email: 'john.doe@example.com',
      joinDate: '2020-01-15',
      rank: 'Firefighter',
      role: 'Member',
      station: 'Station 1',
      platoon: 'A',
      emergencyName1: 'Jane Doe',
      emergencyRelationship1: 'Spouse',
      emergencyPhone1: '(555) 234-5678',
      emergencyEmail1: 'jane.doe@example.com',
      emergencyName2: 'Bob Doe',
      emergencyRelationship2: 'Parent',
      emergencyPhone2: '(555) 345-6789',
      emergencyEmail2: 'bob.doe@example.com',
    };

    const escapeCell = (value: string): string =>
      /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

    const exampleRow = TEMPLATE_HEADERS.map((h) => escapeCell(exampleValues[h]));

    const csv = [TEMPLATE_HEADERS.join(','), exampleRow.join(',')].join('\n');
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
      <header className="bg-theme-input-bg backdrop-blur-xs border-b border-theme-surface-border px-6 py-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="bg-purple-600 rounded-lg p-2">
                <Upload className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-theme-text-primary text-xl font-bold">Import Members from CSV</h1>
                <p className="text-theme-text-muted text-sm">Bulk import member records</p>
              </div>
            </div>
            <button
              onClick={() => void navigate('/members')}
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
            <li>
              Fill in member information — <strong>firstName</strong>, <strong>lastName</strong> and{' '}
              <strong>email</strong> are required on every row; the rest are optional
            </li>
            <li>Leave membershipNumber blank to have the system assign one</li>
            <li>Role must match a role name configured under Roles</li>
            <li>Upload your completed CSV file</li>
            <li>Review the preview and import</li>
          </ol>

          <div className="mt-4 pt-4 border-t border-blue-500/30">
            <button
              onClick={downloadTemplate}
              className="btn-info flex items-center space-x-2"
            >
              <Download className="w-4 h-4" />
              <span>Download CSV Template</span>
            </button>
          </div>
        </div>

        {/* File Upload */}
        <div className="card mb-8 p-8">
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
            data-testid="csv-file-input"
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
          <div className="card mb-8 p-8">
            <h2 className="text-theme-text-primary font-bold mb-4">Step 2: Preview Data</h2>
            <p className="text-theme-text-secondary text-sm mb-4">
              Showing first {previewData.length} members from the file
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-theme-input-bg border-b border-theme-surface-border">
                  <tr>
                    <th scope="col" className="px-4 py-2 text-left text-theme-text-secondary">Name</th>
                    <th scope="col" className="px-4 py-2 text-left text-theme-text-secondary">Member #</th>
                    <th scope="col" className="px-4 py-2 text-left text-theme-text-secondary">Email</th>
                    <th scope="col" className="px-4 py-2 text-left text-theme-text-secondary">Phone</th>
                    <th scope="col" className="px-4 py-2 text-left text-theme-text-secondary">Emergency Contact</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {previewData.map((row, index) => (
                    <tr key={index} className="hover:bg-theme-surface-secondary">
                      <td className="px-4 py-2 text-theme-text-primary">
                        {row.firstName} {row.lastName}
                      </td>
                      <td className="px-4 py-2 text-theme-text-secondary font-mono">{row.membershipNumber}</td>
                      <td className="px-4 py-2 text-theme-text-secondary">{row.email}</td>
                      <td className="px-4 py-2 text-theme-text-secondary">{row.primaryPhone}</td>
                      <td className="px-4 py-2 text-theme-text-secondary">
                        {row.emergencyName1
                          ? `${row.emergencyName1}${row.emergencyRelationship1 ? ` (${row.emergencyRelationship1})` : ''}`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-6 flex items-center justify-end">
              <button
                onClick={() => { void handleImport(); }}
                disabled={importing}
                className="flex items-center space-x-2 px-6 py-3 bg-linear-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white rounded-lg transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
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
          <div className="card p-8">
            <div className="text-center mb-6">
              <CheckCircle className="w-16 h-16 text-green-700 dark:text-green-400 mx-auto mb-4" />
              <h2 className="text-theme-text-primary text-2xl font-bold mb-2">Import Complete!</h2>
              <p className="text-theme-text-secondary">
                Successfully imported {importResult.success} members
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
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
                onClick={() => void navigate('/members')}
                className="btn-info flex items-center px-6 py-3 space-x-2"
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
