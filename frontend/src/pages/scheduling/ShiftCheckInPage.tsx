/**
 * Shift Check-In Landing Page
 *
 * Handles QR code scans for shift check-in/check-out.
 * URL: /scheduling/checkin?shift=<id>
 */

import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  LogIn,
  LogOut,
  Loader2,
  CheckCircle2,
  Clock,
  AlertCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { schedulingService } from '../../modules/scheduling/services/api';
import type { ShiftRecord } from '../../modules/scheduling/services/api';
import { useTimezone } from '../../hooks/useTimezone';
import { formatDate, formatTime } from '../../utils/dateFormatting';

const ShiftCheckInPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const tz = useTimezone();
  const paramShiftId = searchParams.get('shift') || '';
  const paramApparatusId = searchParams.get('apparatus') || '';

  const [resolvedShiftId, setResolvedShiftId] = useState(paramShiftId);
  const [shift, setShift] = useState<ShiftRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [noActiveShift, setNoActiveShift] = useState(false);
  const [attendance, setAttendance] = useState<{
    checked_in_at?: string;
    checked_out_at?: string;
    duration_minutes?: number;
  } | null>(null);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (!paramShiftId && !paramApparatusId) {
      setLoading(false);
      return;
    }
    const load = async () => {
      try {
        let sid = paramShiftId;
        if (!sid && paramApparatusId) {
          const activeShift = await schedulingService
            .getActiveShiftForApparatus(paramApparatusId)
            .catch(() => null);
          if (!activeShift) {
            setNoActiveShift(true);
            setLoading(false);
            return;
          }
          sid = activeShift.id;
        }
        setResolvedShiftId(sid);
        const [shiftData, attendanceData] = await Promise.all([
          schedulingService.getShift(sid),
          schedulingService.getMyAttendance(sid),
        ]);
        setShift(shiftData);
        setAttendance(attendanceData);
      } catch {
        toast.error('Unable to load shift');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [paramShiftId, paramApparatusId]);

  const handleCheckIn = async () => {
    setProcessing(true);
    try {
      const result = await schedulingService.checkIn(resolvedShiftId);
      setAttendance(result);
      toast.success('Checked in successfully');
    } catch {
      toast.error('Failed to check in');
    } finally {
      setProcessing(false);
    }
  };

  const handleCheckOut = async () => {
    setProcessing(true);
    try {
      const result = await schedulingService.checkOut(resolvedShiftId);
      setAttendance(result);
      const hrs = Math.round(
        ((result.duration_minutes ?? 0) / 60) * 10,
      ) / 10;
      toast.success(`Checked out - ${hrs} hours recorded`);
    } catch {
      toast.error('Failed to check out');
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-theme-text-muted" />
      </div>
    );
  }

  if (noActiveShift) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <Clock className="w-12 h-12 text-amber-500 mx-auto mb-3" />
          <h1 className="text-xl font-bold text-theme-text-primary mb-1">
            No Active Shift
          </h1>
          <p className="text-theme-text-muted text-sm mb-4">
            There is no active or upcoming shift for this
            apparatus right now. Check back closer to your
            shift start time.
          </p>
          <button
            onClick={() => navigate('/scheduling')}
            className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 transition-colors"
          >
            Go to Scheduling
          </button>
        </div>
      </div>
    );
  }

  if (!shift) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
          <h1 className="text-xl font-bold text-theme-text-primary mb-1">
            Shift Not Found
          </h1>
          <p className="text-theme-text-muted text-sm mb-4">
            This QR code may be invalid or you may not have
            access to this shift.
          </p>
          <button
            onClick={() => navigate('/scheduling')}
            className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 transition-colors"
          >
            Go to Scheduling
          </button>
        </div>
      </div>
    );
  }

  const hrs = attendance?.duration_minutes
    ? Math.round((attendance.duration_minutes / 60) * 10) / 10
    : null;

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-theme-surface rounded-2xl border border-theme-surface-border shadow-lg p-6 space-y-5">
        {/* Shift info */}
        <div className="text-center">
          <h1 className="text-xl font-bold text-theme-text-primary">
            Shift Check-In
          </h1>
          <p className="text-sm text-theme-text-muted mt-1">
            {shift.apparatus_name || 'Shift'} &mdash;{' '}
            {formatDate(shift.shift_date, tz)}
          </p>
          <p className="text-xs text-theme-text-muted">
            {formatTime(shift.start_time, tz)}
            {shift.end_time
              ? ` - ${formatTime(shift.end_time, tz)}`
              : ''}
          </p>
        </div>

        {/* Status and action */}
        {!attendance?.checked_in_at ? (
          <button
            onClick={() => { void handleCheckIn(); }}
            disabled={processing || shift.is_finalized}
            className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-green-600 text-white rounded-xl text-lg font-semibold hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {processing ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : (
              <LogIn className="w-6 h-6" />
            )}
            Check In
          </button>
        ) : !attendance?.checked_out_at ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 p-3 bg-green-500/10 rounded-lg">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              <div>
                <p className="text-sm font-medium text-green-700 dark:text-green-400">
                  Checked in
                </p>
                <p className="text-xs text-green-600/70 dark:text-green-400/70">
                  <Clock className="w-3 h-3 inline mr-1" />
                  {formatTime(attendance.checked_in_at, tz)}
                </p>
              </div>
            </div>
            <button
              onClick={() => { void handleCheckOut(); }}
              disabled={processing || shift.is_finalized}
              className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-red-600 text-white rounded-xl text-lg font-semibold hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              {processing ? (
                <Loader2 className="w-6 h-6 animate-spin" />
              ) : (
                <LogOut className="w-6 h-6" />
              )}
              Check Out
            </button>
          </div>
        ) : (
          <div className="text-center space-y-3">
            <div className="p-4 bg-theme-surface-hover rounded-lg">
              <CheckCircle2 className="w-10 h-10 text-green-600 mx-auto mb-2" />
              <p className="text-lg font-bold text-theme-text-primary">
                {hrs} hours
              </p>
              <p className="text-xs text-theme-text-muted">
                {formatTime(attendance.checked_in_at, tz)}{' '}
                &rarr;{' '}
                {formatTime(attendance.checked_out_at, tz)}
              </p>
            </div>
            <p className="text-sm text-theme-text-muted">
              Shift complete. Thank you!
            </p>
          </div>
        )}

        {shift.is_finalized && (
          <p className="text-center text-xs text-amber-600 dark:text-amber-400">
            This shift has been finalized. Check-in/out is
            closed.
          </p>
        )}

        <button
          onClick={() => navigate('/scheduling')}
          className="w-full text-center text-sm text-theme-text-muted hover:text-theme-text-primary transition-colors py-2"
        >
          Go to Scheduling
        </button>
      </div>
    </div>
  );
};

export default ShiftCheckInPage;
