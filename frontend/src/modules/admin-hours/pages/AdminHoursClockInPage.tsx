/**
 * Admin Hours Clock-In Page
 *
 * Landing page when a member scans the QR code. Handles:
 * 1. Clock in (first scan)
 * 2. Clock out (second scan, when already clocked in)
 */

import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { adminHoursCategoryService, adminHoursClockService } from '../services/api';
import type { AdminHoursQRData, AdminHoursActiveSession, AdminHoursClockOutResponse } from '../types';
import { toAppError } from '../../../utils/errorHandling';

const AdminHoursClockInPage: React.FC = () => {
  const { categoryId } = useParams<{ categoryId: string }>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qrData, setQrData] = useState<AdminHoursQRData | null>(null);
  const [processing, setProcessing] = useState(false);

  // States for the different views
  const [clockedIn, setClockedIn] = useState(false);
  const [clockedOut, setClockedOut] = useState(false);
  const [showClockOutPrompt, setShowClockOutPrompt] = useState(false);
  const [activeSession, setActiveSession] = useState<AdminHoursActiveSession | null>(null);
  const [clockOutData, setClockOutData] = useState<AdminHoursClockOutResponse | null>(null);

  useEffect(() => {
    if (!categoryId) return;
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  const loadData = async () => {
    if (!categoryId) return;
    try {
      setError(null);
      const [data, session] = await Promise.all([
        adminHoursCategoryService.getQRData(categoryId),
        adminHoursClockService.getActiveSession(),
      ]);
      setQrData(data);

      // If already clocked into THIS category, show clock-out prompt
      if (session && session.categoryId === categoryId) {
        setActiveSession(session);
        setShowClockOutPrompt(true);
      }
    } catch (err: unknown) {
      const appError = toAppError(err);
      setError(appError.message || 'Failed to load category');
    } finally {
      setLoading(false);
    }
  };

  const handleClockIn = async () => {
    if (!categoryId) return;
    try {
      setProcessing(true);
      setError(null);
      await adminHoursClockService.clockIn(categoryId);
      setClockedIn(true);
    } catch (err: unknown) {
      const appError = toAppError(err);
      // If already clocked in to this category, show clock-out
      if (appError.status === 409) {
        const session = await adminHoursClockService.getActiveSession();
        if (session) {
          setActiveSession(session);
          setShowClockOutPrompt(true);
        }
      } else {
        setError(appError.message || 'Failed to clock in');
      }
    } finally {
      setProcessing(false);
    }
  };

  const handleClockOut = async () => {
    if (!categoryId) return;
    try {
      setProcessing(true);
      setError(null);
      const result = await adminHoursClockService.clockOutByCategory(categoryId);
      setClockOutData(result);
      setClockedOut(true);
      setShowClockOutPrompt(false);
    } catch (err: unknown) {
      const appError = toAppError(err);
      setError(appError.message || 'Failed to clock out');
    } finally {
      setProcessing(false);
    }
  };

  const formatDuration = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-theme-surface-secondary">
        <div className="text-theme-text-secondary">Loading...</div>
      </div>
    );
  }

  if (error && !qrData) {
    return (
      <div className="max-w-2xl mx-auto p-6 min-h-screen bg-theme-surface-secondary">
        <div className="bg-theme-surface rounded-lg shadow-md p-8">
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-red-100 rounded-full mb-4">
              <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-theme-text-primary mb-2">Unable to Load</h2>
            <p className="text-theme-text-secondary mb-6">{error}</p>
            <Link to="/admin-hours" className="inline-block px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
              View My Hours
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Clock-out prompt (already clocked in to this category)
  if (showClockOutPrompt && activeSession) {
    return (
      <div className="max-w-2xl mx-auto p-6 min-h-screen bg-theme-surface-secondary">
        <div className="bg-theme-surface rounded-lg shadow-md p-8">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-blue-100 rounded-full mb-6">
              <svg className="w-12 h-12 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>

            <h2 className="text-3xl font-bold text-theme-text-primary mb-2">Already Clocked In</h2>
            <p className="text-xl text-theme-text-secondary mb-8">
              You&apos;re currently logged in to {activeSession.categoryName}
            </p>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 text-left mb-8">
              <div className="flex items-center gap-3 mb-3">
                <div
                  className="w-4 h-4 rounded-full"
                  style={{ backgroundColor: activeSession.categoryColor ?? '#6B7280' }}
                />
                <h3 className="text-xl font-semibold text-blue-900">{activeSession.categoryName}</h3>
              </div>
              <p className="text-blue-800">
                <span className="font-medium">Clocked In At:</span>{' '}
                {new Date(activeSession.clockInAt).toLocaleTimeString()}
              </p>
              <p className="text-blue-800">
                <span className="font-medium">Elapsed:</span>{' '}
                {formatDuration(activeSession.elapsedMinutes)}
              </p>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
                <p className="text-red-800">{error}</p>
              </div>
            )}

            <div className="space-y-3">
              <button
                onClick={() => { void handleClockOut(); }}
                disabled={processing}
                className="w-full px-8 py-4 bg-red-600 text-white text-lg font-semibold rounded-lg hover:bg-red-700 transition focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {processing ? 'Clocking Out...' : 'Clock Out'}
              </button>
              <Link
                to="/admin-hours"
                className="block w-full px-6 py-3 bg-theme-surface-secondary text-theme-text-secondary rounded-lg hover:bg-theme-surface-hover transition font-medium text-center"
              >
                View My Hours
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Success: clocked out
  if (clockedOut && clockOutData) {
    return (
      <div className="max-w-2xl mx-auto p-6 min-h-screen bg-theme-surface-secondary">
        <div className="bg-theme-surface rounded-lg shadow-md p-8">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-green-100 rounded-full mb-6">
              <svg className="w-12 h-12 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>

            <h2 className="text-3xl font-bold text-theme-text-primary mb-2">Clocked Out!</h2>
            <p className="text-xl text-theme-text-secondary mb-8">{clockOutData.message}</p>

            <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-left mb-8">
              <h3 className="text-xl font-semibold text-green-900 mb-3">{clockOutData.categoryName}</h3>
              <div className="space-y-1 text-green-800">
                <p>
                  <span className="font-medium">Duration:</span>{' '}
                  {formatDuration(clockOutData.durationMinutes)}
                </p>
                <p>
                  <span className="font-medium">Status:</span>{' '}
                  <span className="capitalize">{clockOutData.status}</span>
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <Link
                to="/admin-hours"
                className="block w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium"
              >
                View My Hours
              </Link>
              <Link
                to="/dashboard"
                className="block w-full px-6 py-3 bg-theme-surface-secondary text-theme-text-secondary rounded-lg hover:bg-theme-surface-hover transition font-medium"
              >
                Go to Dashboard
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Success: clocked in
  if (clockedIn) {
    return (
      <div className="max-w-2xl mx-auto p-6 min-h-screen bg-theme-surface-secondary">
        <div className="bg-theme-surface rounded-lg shadow-md p-8">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-green-100 rounded-full mb-6">
              <svg className="w-12 h-12 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>

            <h2 className="text-3xl font-bold text-theme-text-primary mb-2">Clocked In!</h2>
            <p className="text-xl text-theme-text-secondary mb-8">
              You&apos;re now logging hours for {qrData?.categoryName}
            </p>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 text-left mb-8">
              <div className="flex items-center gap-3 mb-3">
                <div
                  className="w-4 h-4 rounded-full"
                  style={{ backgroundColor: qrData?.categoryColor ?? '#6B7280' }}
                />
                <h3 className="text-xl font-semibold text-blue-900">{qrData?.categoryName}</h3>
              </div>
              <p className="text-blue-800">
                <span className="font-medium">Started At:</span>{' '}
                {new Date().toLocaleTimeString()}
              </p>
              <p className="text-sm text-blue-700 mt-2">
                Scan the same QR code when you&apos;re done to clock out
              </p>
            </div>

            <div className="space-y-3">
              <Link
                to="/admin-hours"
                className="block w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium"
              >
                View My Hours
              </Link>
              <Link
                to="/dashboard"
                className="block w-full px-6 py-3 bg-theme-surface-secondary text-theme-text-secondary rounded-lg hover:bg-theme-surface-hover transition font-medium"
              >
                Go to Dashboard
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Default: clock-in prompt
  return (
    <div className="max-w-2xl mx-auto p-6 min-h-screen bg-theme-surface-secondary">
      <div className="bg-theme-surface rounded-lg shadow-md p-8">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
            <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-3xl font-bold text-theme-text-primary mb-2">Admin Hours Clock-In</h2>
        </div>

        {/* Category Details */}
        <div className="bg-theme-surface-secondary rounded-lg p-6 mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div
              className="w-4 h-4 rounded-full"
              style={{ backgroundColor: qrData?.categoryColor ?? '#6B7280' }}
            />
            <h3 className="text-2xl font-semibold text-theme-text-primary">{qrData?.categoryName}</h3>
          </div>
          {qrData?.categoryDescription && (
            <p className="text-theme-text-secondary">{qrData.categoryDescription}</p>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <p className="text-red-800">{error}</p>
          </div>
        )}

        <button
          onClick={() => { void handleClockIn(); }}
          disabled={processing}
          className="w-full px-8 py-4 bg-green-600 text-white text-lg font-semibold rounded-lg hover:bg-green-700 transition focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {processing ? 'Clocking In...' : 'Clock In'}
        </button>

        <p className="text-sm text-theme-text-muted text-center mt-4">
          Scan the same QR code when you&apos;re done to clock out
        </p>

        <div className="mt-8 text-center">
          <Link to="/admin-hours" className="text-blue-600 hover:text-blue-800 font-medium">
            View My Hours
          </Link>
          <span className="text-theme-text-muted mx-3">|</span>
          <Link to="/dashboard" className="text-blue-600 hover:text-blue-800 font-medium">
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
};

export default AdminHoursClockInPage;
