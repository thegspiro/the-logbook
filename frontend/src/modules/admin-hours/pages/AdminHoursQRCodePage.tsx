/**
 * Admin Hours QR Code Page
 *
 * Displays a printable QR code for an admin hours category.
 * Scanning this QR code takes users to the clock-in page.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router';
import { QRCodeSVG } from 'qrcode.react';
import { adminHoursCategoryService } from '../services/api';
import type { AdminHoursQRData } from '../types';
import { getErrorMessage } from '../../../utils/errorHandling';

const AdminHoursQRCodePage: React.FC = () => {
  const { categoryId } = useParams<{ categoryId: string }>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qrData, setQrData] = useState<AdminHoursQRData | null>(null);

  const fetchData = useCallback(async () => {
    if (!categoryId) {
      // Without a category there is nothing to fetch — surface an error rather
      // than leaving the page stuck on the loading spinner forever.
      setError('No category specified.');
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const data = await adminHoursCategoryService.getQRData(categoryId);
      setQrData(data);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load category'));
    } finally {
      setLoading(false);
    }
  }, [categoryId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const getClockInUrl = () => {
    if (!categoryId) return '';
    return `${window.location.origin}/admin-hours/${categoryId}/clock-in`;
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-theme-text-secondary">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
          <p className="text-red-700 dark:text-red-400">{error}</p>
        </div>
        <Link to="/admin-hours/manage" className="text-blue-600 hover:text-blue-800 dark:hover:text-blue-400">
          &larr; Back to Admin Hours
        </Link>
      </div>
    );
  }

  if (!qrData) return null;

  const clockInUrl = getClockInUrl();

  return (
    <div className="mx-auto min-h-screen max-w-4xl p-6">
      {/* Header */}
      <div className="mb-6 print:hidden">
        <Link
          to="/admin-hours/manage"
          className="mb-4 inline-block text-blue-600 hover:text-blue-800 dark:hover:text-blue-400"
        >
          &larr; Back to Admin Hours Management
        </Link>
        <h1 className="text-theme-text-primary text-3xl font-bold">Admin Hours QR Code</h1>
      </div>

      {/* Category Info */}
      <div className="bg-theme-surface mb-6 rounded-lg p-6 shadow-md backdrop-blur-xs">
        <div className="mb-2 flex items-center gap-3">
          <div className="h-5 w-5 rounded-full" style={{ backgroundColor: qrData.categoryColor ?? '#6B7280' }} />
          <h2 className="text-theme-text-primary text-2xl font-semibold">{qrData.categoryName}</h2>
        </div>
        {qrData.categoryDescription && <p className="text-theme-text-secondary">{qrData.categoryDescription}</p>}
        {qrData.organizationName && <p className="text-theme-text-muted mt-1 text-sm">{qrData.organizationName}</p>}
      </div>

      {/* QR Code */}
      <div className="bg-theme-surface rounded-lg p-8 shadow-md backdrop-blur-xs">
        <div className="text-center">
          <h3 className="text-theme-text-primary mb-2 text-xl font-semibold">Scan to Clock In / Clock Out</h3>
          <p className="text-theme-text-secondary mb-6">
            Members scan this QR code to start or stop tracking hours for <strong>{qrData.categoryName}</strong>
          </p>

          {clockInUrl && (
            <div className="mb-6 flex justify-center">
              <div className="qr-container">
                <QRCodeSVG value={clockInUrl} size={300} level="H" includeMargin={true} className="h-auto max-w-full" />
              </div>
            </div>
          )}

          {/* Category label under QR for print */}
          <div
            className="mb-6 inline-flex items-center gap-2 rounded-full px-4 py-2"
            style={{ backgroundColor: (qrData.categoryColor ?? '#6B7280') + '20' }}
          >
            <div className="h-3 w-3 rounded-full" style={{ backgroundColor: qrData.categoryColor ?? '#6B7280' }} />
            <span className="font-semibold" style={{ color: qrData.categoryColor ?? '#6B7280' }}>
              {qrData.categoryName}
            </span>
          </div>

          {/* Instructions */}
          <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-4 text-left print:hidden">
            <h4 className="mb-2 font-semibold text-blue-700 dark:text-blue-300">Instructions:</h4>
            <ol className="list-inside list-decimal space-y-1 text-blue-700 dark:text-blue-300">
              <li>Print and post this QR code at the relevant work area</li>
              <li>Members scan with their phone camera when starting work</li>
              <li>Log in if prompted, then tap &quot;Clock In&quot;</li>
              <li>Scan the same QR code again when done to clock out</li>
            </ol>
          </div>
        </div>
      </div>

      {/* Print Button */}
      <div className="mt-6 text-center print:hidden">
        <button onClick={() => window.print()} className="btn-info px-6 transition">
          Print QR Code
        </button>
      </div>
    </div>
  );
};

export default AdminHoursQRCodePage;
