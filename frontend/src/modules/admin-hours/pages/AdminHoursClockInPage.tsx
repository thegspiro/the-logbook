/**
 * Admin Hours Clock-In Page
 *
 * Landing page when a member scans the QR code. Handles:
 * 1. Clock in (first scan)
 * 2. Clock out (second scan, when already clocked in)
 */

import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router';
import { adminHoursCategoryService, adminHoursClockService } from '../services/api';
import type { AdminHoursQRData, AdminHoursActiveSession, AdminHoursClockOutResponse } from '../types';
import { toAppError } from '../../../utils/errorHandling';
import { formatTime } from '../../../utils/dateFormatting';
import { useTimezone } from '../../../hooks/useTimezone';

const AdminHoursClockInPage: React.FC = () => {
  const tz = useTimezone();
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
      <div className="bg-theme-surface-secondary flex min-h-screen items-center justify-center">
        <div className="text-theme-text-secondary">Loading...</div>
      </div>
    );
  }

  if (error && !qrData) {
    return (
      <div className="bg-theme-surface-secondary mx-auto min-h-screen max-w-2xl p-6">
        <div className="bg-theme-surface rounded-lg p-8 shadow-md">
          <div className="mb-6 text-center">
            <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-500/20">
              <svg className="h-8 w-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h2 className="text-theme-text-primary mb-2 text-2xl font-bold">Unable to Load</h2>
            <p className="text-theme-text-secondary mb-6">{error}</p>
            <Link to="/admin-hours" className="btn-info inline-block px-6 transition">
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
      <div className="bg-theme-surface-secondary mx-auto min-h-screen max-w-2xl p-6">
        <div className="bg-theme-surface rounded-lg p-8 shadow-md">
          <div className="text-center">
            <div className="mb-6 inline-flex h-20 w-20 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-500/20">
              <svg className="h-12 w-12 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>

            <h2 className="text-theme-text-primary mb-2 text-3xl font-bold">Already Clocked In</h2>
            <p className="text-theme-text-secondary mb-8 text-xl">
              You&apos;re currently logged in to {activeSession.categoryName}
            </p>

            <div className="mb-8 rounded-lg border border-blue-200 bg-blue-50 p-6 text-left dark:border-blue-500/30 dark:bg-blue-500/10">
              <div className="mb-3 flex items-center gap-3">
                <div
                  className="h-4 w-4 rounded-full"
                  style={{ backgroundColor: activeSession.categoryColor ?? '#6B7280' }}
                />
                <h3 className="text-xl font-semibold text-blue-900 dark:text-blue-300">{activeSession.categoryName}</h3>
              </div>
              <p className="text-blue-800 dark:text-blue-300">
                <span className="font-medium">Clocked In At:</span> {formatTime(activeSession.clockInAt, tz)}
              </p>
              <p className="text-blue-800 dark:text-blue-300">
                <span className="font-medium">Elapsed:</span> {formatDuration(activeSession.elapsedMinutes)}
              </p>
            </div>

            {error && (
              <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-500/30 dark:bg-red-500/10">
                <p className="text-red-800 dark:text-red-400">{error}</p>
              </div>
            )}

            <div className="space-y-3">
              <button
                onClick={() => {
                  void handleClockOut();
                }}
                disabled={processing}
                className="btn-primary w-full px-8 py-4 text-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-50"
              >
                {processing ? 'Clocking Out...' : 'Clock Out'}
              </button>
              <Link
                to="/admin-hours"
                className="bg-theme-surface-secondary text-theme-text-secondary hover:bg-theme-surface-hover block w-full rounded-lg px-6 py-3 text-center font-medium transition"
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
      <div className="bg-theme-surface-secondary mx-auto min-h-screen max-w-2xl p-6">
        <div className="bg-theme-surface rounded-lg p-8 shadow-md">
          <div className="text-center">
            <div className="mb-6 inline-flex h-20 w-20 items-center justify-center rounded-full bg-green-100 dark:bg-green-500/20">
              <svg className="h-12 w-12 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>

            <h2 className="text-theme-text-primary mb-2 text-3xl font-bold">Clocked Out!</h2>
            <p className="text-theme-text-secondary mb-8 text-xl">{clockOutData.message}</p>

            <div className="mb-8 rounded-lg border border-green-200 bg-green-50 p-6 text-left dark:border-green-500/30 dark:bg-green-500/10">
              <h3 className="mb-3 text-xl font-semibold text-green-900 dark:text-green-300">
                {clockOutData.categoryName}
              </h3>
              <div className="space-y-1 text-green-800 dark:text-green-300">
                <p>
                  <span className="font-medium">Duration:</span> {formatDuration(clockOutData.durationMinutes)}
                </p>
                <p>
                  <span className="font-medium">Status:</span> <span className="capitalize">{clockOutData.status}</span>
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <Link to="/admin-hours" className="btn-info block w-full px-6 py-3 font-medium transition">
                View My Hours
              </Link>
              <Link
                to="/dashboard"
                className="bg-theme-surface-secondary text-theme-text-secondary hover:bg-theme-surface-hover block w-full rounded-lg px-6 py-3 font-medium transition"
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
      <div className="bg-theme-surface-secondary mx-auto min-h-screen max-w-2xl p-6">
        <div className="bg-theme-surface rounded-lg p-8 shadow-md">
          <div className="text-center">
            <div className="mb-6 inline-flex h-20 w-20 items-center justify-center rounded-full bg-green-100 dark:bg-green-500/20">
              <svg className="h-12 w-12 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>

            <h2 className="text-theme-text-primary mb-2 text-3xl font-bold">Clocked In!</h2>
            <p className="text-theme-text-secondary mb-8 text-xl">
              You&apos;re now logging hours for {qrData?.categoryName}
            </p>

            <div className="mb-8 rounded-lg border border-blue-200 bg-blue-50 p-6 text-left dark:border-blue-500/30 dark:bg-blue-500/10">
              <div className="mb-3 flex items-center gap-3">
                <div className="h-4 w-4 rounded-full" style={{ backgroundColor: qrData?.categoryColor ?? '#6B7280' }} />
                <h3 className="text-xl font-semibold text-blue-900 dark:text-blue-300">{qrData?.categoryName}</h3>
              </div>
              <p className="text-blue-800 dark:text-blue-300">
                <span className="font-medium">Started At:</span> {formatTime(new Date(), tz)}
              </p>
              <p className="mt-2 text-sm text-blue-700 dark:text-blue-400">
                Scan the same QR code when you&apos;re done to clock out
              </p>
            </div>

            <div className="space-y-3">
              <Link to="/admin-hours" className="btn-info block w-full px-6 py-3 font-medium transition">
                View My Hours
              </Link>
              <Link
                to="/dashboard"
                className="bg-theme-surface-secondary text-theme-text-secondary hover:bg-theme-surface-hover block w-full rounded-lg px-6 py-3 font-medium transition"
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
    <div className="bg-theme-surface-secondary mx-auto min-h-screen max-w-2xl p-6">
      <div className="bg-theme-surface rounded-lg p-8 shadow-md">
        <div className="mb-8 text-center">
          <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-500/20">
            <svg className="h-8 w-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h2 className="text-theme-text-primary mb-2 text-3xl font-bold">Admin Hours Clock-In</h2>
        </div>

        {/* Category Details */}
        <div className="bg-theme-surface-secondary mb-8 rounded-lg p-6">
          <div className="mb-2 flex items-center gap-3">
            <div className="h-4 w-4 rounded-full" style={{ backgroundColor: qrData?.categoryColor ?? '#6B7280' }} />
            <h3 className="text-theme-text-primary text-2xl font-semibold">{qrData?.categoryName}</h3>
          </div>
          {qrData?.categoryDescription && <p className="text-theme-text-secondary">{qrData.categoryDescription}</p>}
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-500/30 dark:bg-red-500/10">
            <p className="text-red-800 dark:text-red-400">{error}</p>
          </div>
        )}

        <button
          onClick={() => {
            void handleClockIn();
          }}
          disabled={processing}
          className="btn-success w-full px-8 py-4 text-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-50"
        >
          {processing ? 'Clocking In...' : 'Clock In'}
        </button>

        <p className="text-theme-text-muted mt-4 text-center text-sm">
          Scan the same QR code when you&apos;re done to clock out
        </p>

        <div className="mt-8 text-center">
          <Link
            to="/admin-hours"
            className="font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
          >
            View My Hours
          </Link>
          <span className="text-theme-text-muted mx-3">|</span>
          <Link
            to="/dashboard"
            className="font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
          >
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
};

export default AdminHoursClockInPage;
