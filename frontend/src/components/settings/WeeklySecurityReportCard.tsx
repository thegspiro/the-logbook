/**
 * Admin control for the weekly security report emailed to the IT Manager.
 * The scheduler reads exactly these three values (see
 * backend/app/services/security_weekly_report.py); the report carries counts
 * only, so nothing here exposes member data.
 */

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, MailCheck } from 'lucide-react';
import { securityAlertsService, type WeeklySecurityReportSettings } from '../../services/securityAlertsService';
import { MEETING_WEEKDAYS } from '../../constants/enums';
import { useTimezone } from '../../hooks/useTimezone';
import { formatDateTime } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

const formatHour = (hour: number): string => `${String(hour).padStart(2, '0')}:00`;

export const WeeklySecurityReportCard: React.FC = () => {
  const tz = useTimezone();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<WeeklySecurityReportSettings | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [weekday, setWeekday] = useState(0);
  const [hour, setHour] = useState(7);

  const apply = (settings: WeeklySecurityReportSettings) => {
    setSaved(settings);
    setEnabled(settings.enabled);
    setWeekday(settings.weekday);
    setHour(settings.hour);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const settings = await securityAlertsService.getWeeklyReport();
        if (!cancelled) apply(settings);
      } catch (err) {
        if (!cancelled) toast.error(getErrorMessage(err, 'Failed to load the security report settings'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = saved !== null && (saved.enabled !== enabled || saved.weekday !== weekday || saved.hour !== hour);

  const save = async () => {
    setSaving(true);
    try {
      apply(await securityAlertsService.setWeeklyReport({ enabled, weekday, hour }));
      toast.success('Security report settings saved');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to save the security report settings'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="card p-5">
        <Loader2 className="text-theme-text-muted h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="card space-y-5 p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-theme-text-primary flex items-center gap-2 text-base font-semibold">
            <MailCheck className="h-4 w-4" /> Email a weekly security report
          </h3>
          <p className="text-theme-text-muted mt-1 text-sm">
            Counts of security alerts, application errors and audit log health for the past seven days. It carries no
            member names or event details; those stay in the application. A quiet week still sends a short all-clear, so
            a missing email means something is wrong.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Email a weekly security report"
          disabled={saving}
          onClick={() => setEnabled(!enabled)}
          className={`toggle-track-sm ${enabled ? 'bg-theme-accent-blue' : 'bg-theme-surface-hover'}`}
        >
          <span className={`toggle-knob-sm ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="security-report-weekday" className="form-label">
            Day
          </label>
          <select
            id="security-report-weekday"
            className="form-input"
            value={weekday}
            disabled={!enabled || saving}
            onChange={(event) => setWeekday(Number(event.target.value))}
          >
            {MEETING_WEEKDAYS.map((day) => (
              <option key={day.value} value={day.value}>
                {day.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="security-report-hour" className="form-label">
            Time ({saved?.timezone ?? tz})
          </label>
          <select
            id="security-report-hour"
            className="form-input"
            value={hour}
            disabled={!enabled || saving}
            onChange={(event) => setHour(Number(event.target.value))}
          >
            {HOURS.map((value) => (
              <option key={value} value={value}>
                {formatHour(value)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {saved && (
        <div className="text-theme-text-muted space-y-1 text-sm">
          <p>
            {saved.recipient_count === 0
              ? 'No one with an email address would receive this report right now.'
              : `Sent to ${saved.recipient_count} ${saved.recipient_count === 1 ? 'person' : 'people'}${
                  saved.recipients_are_fallback ? ' (administrators)' : ' holding the IT Manager position'
                }.`}
          </p>
          {saved.recipients_are_fallback && (
            <p role="note">
              No one holds the IT Manager position, so administrators receive the report. Assign the position to send it
              to IT instead.
            </p>
          )}
          <p>{saved.last_sent_at ? `Last sent ${formatDateTime(saved.last_sent_at, tz)}.` : 'Not sent yet.'}</p>
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          className="btn-primary"
          disabled={!dirty || saving}
          onClick={() => {
            void save();
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
};
