/**
 * Bulk entry of the qualifications members already hold — the licences and
 * cards a department arrives with — from a CSV file.
 *
 * Checked first, written second. The file goes up as a dry run, every row
 * that fails is listed by its spreadsheet line with the reason, and only then
 * does the officer write the rows that passed. A rejected row is shown rather
 * than dropped because a missing licence is a member the scheduler will not
 * clear for a seat they are certified for.
 */

import React, { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import { memberQualificationService } from '../services/api';
import type { QualificationImportResult } from '../types/user';
import { useTimezone } from '../hooks/useTimezone';
import { formatDate } from '../utils/dateFormatting';
import { getErrorMessage } from '../utils/errorHandling';

const TEMPLATE = [
  'membership_number,email,qualification,granted_on,expires_on,notes',
  '1042,,emt,2019-05-01,2027-03-31,State EMT #12345',
  ',jane.doe@example.org,Paramedic,2016-09-15,2026-12-31,',
].join('\n');

const QualificationImport: React.FC = () => {
  const tz = useTimezone();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<QualificationImportResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);

  const reset = () => {
    setFile(null);
    setPreview(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const check = async (chosen: File) => {
    setFile(chosen);
    setPreview(null);
    setChecking(true);
    try {
      setPreview(await memberQualificationService.importCsv(chosen, true));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not read that file'));
      setFile(null);
    } finally {
      setChecking(false);
    }
  };

  const runImport = async () => {
    if (!file) return;
    setImporting(true);
    try {
      const result = await memberQualificationService.importCsv(file, false);
      toast.success(`Recorded ${result.imported} qualification${result.imported === 1 ? '' : 's'}`);
      reset();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Import failed'));
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'qualifications_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 py-6">
      <section className="card space-y-3 p-5">
        <h2 className="text-theme-text-primary text-lg font-semibold">Import qualifications</h2>
        <p className="text-theme-text-secondary text-sm">
          Record the certifications members already hold — an EMT card, a Paramedic licence, Driver/Operator — without
          inventing a training record for each. Shift eligibility reads these as of the shift date, so a member is
          offered the seats their qualifications clear them for.
        </p>
        <p className="text-theme-text-muted text-sm">
          Columns: <code>membership_number</code> or <code>email</code> to find the member, <code>qualification</code>{' '}
          (code or name), and optionally <code>granted_on</code>, <code>expires_on</code> (YYYY-MM-DD) and{' '}
          <code>notes</code>. A member who already holds the qualification has its dates replaced.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            className="hidden"
            aria-label="Qualifications CSV file"
            onChange={(e) => {
              const chosen = e.target.files?.[0];
              if (chosen) void check(chosen);
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={checking || importing}
            className="btn-primary inline-flex items-center gap-2"
          >
            {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {checking ? 'Checking…' : 'Choose CSV file'}
          </button>
          <button type="button" onClick={downloadTemplate} className="btn-secondary">
            Download template
          </button>
        </div>
      </section>

      {preview && (
        <section className="card space-y-4 p-5" aria-label="Import check">
          <h3 className="text-theme-text-primary font-semibold">
            {file?.name}: {preview.valid_rows} of {preview.total_rows} row{preview.total_rows === 1 ? '' : 's'} ready
          </h3>

          {preview.errors.length > 0 && (
            <div className="alert-warning space-y-2">
              <p className="flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                {preview.errors.length} row{preview.errors.length === 1 ? '' : 's'} will not be imported
              </p>
              <ul className="space-y-1 text-sm" aria-label="Rejected rows">
                {preview.errors.map((error) => (
                  <li key={error.row}>
                    Line {error.row}: {error.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preview.rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="rwd-table w-full text-sm">
                <thead>
                  <tr className="text-theme-text-muted text-left">
                    <th className="py-2 pr-3">Line</th>
                    <th className="py-2 pr-3">Member</th>
                    <th className="py-2 pr-3">Qualification</th>
                    <th className="py-2 pr-3">Granted</th>
                    <th className="py-2 pr-3">Expires</th>
                    <th className="py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.row} className="border-theme-surface-border border-t">
                      <td data-label="Line" className="py-2 pr-3">
                        {row.row}
                      </td>
                      <td data-label="Member" className="py-2 pr-3">
                        {row.member_name}
                      </td>
                      <td data-label="Qualification" className="py-2 pr-3">
                        {row.label}
                      </td>
                      <td data-label="Granted" className="py-2 pr-3">
                        {row.granted_on ? formatDate(row.granted_on, tz) : '—'}
                      </td>
                      <td data-label="Expires" className="py-2 pr-3">
                        {row.expires_on ? formatDate(row.expires_on, tz) : 'Does not expire'}
                      </td>
                      <td data-label="Action" className="py-2">
                        {row.action === 'update' ? 'Replace dates' : 'Add'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={reset} disabled={importing} className="btn-secondary">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void runImport()}
              disabled={importing || preview.valid_rows === 0}
              className="btn-primary inline-flex items-center gap-2"
            >
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Import {preview.valid_rows} row{preview.valid_rows === 1 ? '' : 's'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
};

export default QualificationImport;
