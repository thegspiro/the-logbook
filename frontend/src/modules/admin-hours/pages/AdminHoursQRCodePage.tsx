/**
 * Admin Hours QR Code Page
 *
 * Displays a printable QR code for an admin hours category.
 * Scanning this QR code takes users to the clock-in page.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
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
    if (!categoryId) return;
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
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-theme-text-secondary">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-4">
          <p className="text-red-400">{error}</p>
        </div>
        <Link to="/admin-hours/manage" className="text-blue-600 hover:text-blue-400">
          &larr; Back to Admin Hours
        </Link>
      </div>
    );
  }

  if (!qrData) return null;

  const clockInUrl = getClockInUrl();

  return (
    <div className="min-h-screen max-w-4xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6 print:hidden">
        <Link to="/admin-hours/manage" className="text-blue-600 hover:text-blue-400 mb-4 inline-block">
          &larr; Back to Admin Hours Management
        </Link>
        <h1 className="text-3xl font-bold text-theme-text-primary">Admin Hours QR Code</h1>
      </div>

      {/* Category Info */}
      <div className="bg-theme-surface backdrop-blur-sm rounded-lg shadow-md p-6 mb-6">
        <div className="flex items-center gap-3 mb-2">
          <div
            className="w-5 h-5 rounded-full"
            style={{ backgroundColor: qrData.categoryColor ?? '#6B7280' }}
          />
          <h2 className="text-2xl font-semibold text-theme-text-primary">{qrData.categoryName}</h2>
        </div>
        {qrData.categoryDescription && (
          <p className="text-theme-text-secondary">{qrData.categoryDescription}</p>
        )}
        {qrData.organizationName && (
          <p className="text-sm text-theme-text-muted mt-1">{qrData.organizationName}</p>
        )}
      </div>

      {/* QR Code */}
      <div className="bg-theme-surface backdrop-blur-sm rounded-lg shadow-md p-8">
        <div className="text-center">
          <h3 className="text-xl font-semibold text-theme-text-primary mb-2">
            Scan to Clock In / Clock Out
          </h3>
          <p className="text-theme-text-secondary mb-6">
            Members scan this QR code to start or stop tracking hours for <strong>{qrData.categoryName}</strong>
          </p>

          {clockInUrl && (
            <div className="flex justify-center mb-6">
              <div className="qr-container">
                <QRCodeSVG
                  value={clockInUrl}
                  size={300}
                  level="H"
                  includeMargin={true}
                />
              </div>
            </div>
          )}

          {/* Category label under QR for print */}
          <div
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full mb-6"
            style={{ backgroundColor: (qrData.categoryColor ?? '#6B7280') + '20' }}
          >
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: qrData.categoryColor ?? '#6B7280' }}
            />
            <span className="font-semibold" style={{ color: qrData.categoryColor ?? '#6B7280' }}>
              {qrData.categoryName}
            </span>
          </div>

          {/* Instructions */}
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 text-left print:hidden">
            <h4 className="font-semibold text-blue-300 mb-2">Instructions:</h4>
            <ol className="list-decimal list-inside space-y-1 text-blue-300">
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
        <button
          onClick={() => window.print()}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
        >
          Print QR Code
        </button>
      </div>
    </div>
  );
};

export default AdminHoursQRCodePage;
