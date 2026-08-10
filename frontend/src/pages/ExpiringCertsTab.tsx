/**
 * Expiring Certifications Tab (DT3)
 *
 * Shows certifications expiring within a configurable window.
 * Lazy-loaded as a tab in TrainingAdminPage.
 */

import React, { useState, useEffect } from 'react';
import { Loader2, AlertTriangle, Clock, Shield } from 'lucide-react';
import { trainingService } from '../services/api';
import type { ExpiringCertification } from '../services/api';
import { useTimezone } from '../hooks/useTimezone';
import { formatDate } from '../utils/dateFormatting';

const ExpiringCertsTab: React.FC = () => {
  const tz = useTimezone();
  const [certs, setCerts] = useState<ExpiringCertification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [daysWindow, setDaysWindow] = useState(90);

  useEffect(() => {
    void loadCerts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daysWindow]);

  const loadCerts = async () => {
    try {
      setLoading(true);
      const data = await trainingService.getExpiringCertificationsDetailed(daysWindow);
      setCerts(data);
    } catch {
      setError('Failed to load expiring certifications');
    } finally {
      setLoading(false);
    }
  };

  const getUrgencyClass = (days: number) => {
    if (days < 0) return 'text-red-700 dark:text-red-400 bg-red-500/10 border-red-500/20';
    if (days <= 7) return 'text-red-700 dark:text-red-400 bg-red-500/10 border-red-500/20';
    if (days <= 30) return 'text-orange-700 dark:text-orange-400 bg-orange-500/10 border-orange-500/20';
    if (days <= 60) return 'text-yellow-700 dark:text-yellow-400 bg-yellow-500/10 border-yellow-500/20';
    return 'text-blue-700 dark:text-blue-400 bg-blue-500/10 border-blue-500/20';
  };

  const getUrgencyLabel = (days: number) => {
    if (days < 0) return `Expired ${Math.abs(days)}d ago`;
    if (days === 0) return 'Expires today';
    return `${days}d remaining`;
  };

  const expired = certs.filter((c) => c.days_until_expiry < 0).length;
  const critical = certs.filter((c) => c.days_until_expiry >= 0 && c.days_until_expiry <= 30).length;
  const warning = certs.filter((c) => c.days_until_expiry > 30 && c.days_until_expiry <= 90).length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-theme-text-primary flex items-center gap-2 text-lg font-semibold">
            <Shield className="h-5 w-5 text-red-700 dark:text-red-400" />
            Expiring Certifications
          </h2>
          <p className="text-theme-text-muted mt-1 text-sm">
            Certifications expiring within the next {daysWindow} days
          </p>
        </div>
        <select value={daysWindow} onChange={(e) => setDaysWindow(Number(e.target.value))} className="form-input-sm">
          <option value={30}>30 days</option>
          <option value={60}>60 days</option>
          <option value={90}>90 days</option>
          <option value={180}>180 days</option>
          <option value={365}>1 year</option>
        </select>
      </div>

      {/* Summary Cards */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4">
          <p className="text-sm text-red-700 dark:text-red-300">Expired</p>
          <p className="text-2xl font-bold text-red-700 dark:text-red-400">{expired}</p>
        </div>
        <div className="rounded-lg border border-orange-500/20 bg-orange-500/10 p-4">
          <p className="text-sm text-orange-700 dark:text-orange-300">Critical (&le;30d)</p>
          <p className="text-2xl font-bold text-orange-700 dark:text-orange-400">{critical}</p>
        </div>
        <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-4">
          <p className="text-sm text-yellow-700 dark:text-yellow-300">Warning (31-90d)</p>
          <p className="text-2xl font-bold text-yellow-700 dark:text-yellow-400">{warning}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-red-700 dark:text-red-400">
          {error}
        </div>
      ) : certs.length === 0 ? (
        <div className="text-theme-text-muted py-12 text-center">
          <Shield className="mx-auto mb-3 h-12 w-12 opacity-50" />
          <p>No certifications expiring within {daysWindow} days</p>
        </div>
      ) : (
        <div className="card-secondary overflow-hidden overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-theme-surface-border border-b">
                <th scope="col" className="text-theme-text-secondary px-4 py-3 text-left text-xs font-medium uppercase">
                  Member
                </th>
                <th scope="col" className="text-theme-text-secondary px-4 py-3 text-left text-xs font-medium uppercase">
                  Certification
                </th>
                <th scope="col" className="text-theme-text-secondary px-4 py-3 text-left text-xs font-medium uppercase">
                  Expiry Date
                </th>
                <th scope="col" className="text-theme-text-secondary px-4 py-3 text-left text-xs font-medium uppercase">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {certs.map((cert, idx) => (
                <tr key={idx} className="border-theme-surface-border hover:bg-theme-surface-hover border-b">
                  <td className="text-theme-text-primary px-4 py-3 font-medium">{cert.member_name}</td>
                  <td className="text-theme-text-secondary px-4 py-3">{cert.requirement_name}</td>
                  <td className="text-theme-text-secondary px-4 py-3">{formatDate(cert.expiry_date, tz)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-xs font-medium ${getUrgencyClass(cert.days_until_expiry)}`}
                    >
                      {cert.days_until_expiry < 0 ? (
                        <AlertTriangle className="h-3 w-3" />
                      ) : (
                        <Clock className="h-3 w-3" />
                      )}
                      {getUrgencyLabel(cert.days_until_expiry)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default ExpiringCertsTab;
