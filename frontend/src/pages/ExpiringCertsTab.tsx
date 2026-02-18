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

const ExpiringCertsTab: React.FC = () => {
  const [certs, setCerts] = useState<ExpiringCertification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [daysWindow, setDaysWindow] = useState(90);

  useEffect(() => {
    loadCerts();
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
    if (days < 0) return 'text-red-400 bg-red-500/10 border-red-500/20';
    if (days <= 7) return 'text-red-400 bg-red-500/10 border-red-500/20';
    if (days <= 30) return 'text-orange-400 bg-orange-500/10 border-orange-500/20';
    if (days <= 60) return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20';
    return 'text-blue-400 bg-blue-500/10 border-blue-500/20';
  };

  const getUrgencyLabel = (days: number) => {
    if (days < 0) return `Expired ${Math.abs(days)}d ago`;
    if (days === 0) return 'Expires today';
    return `${days}d remaining`;
  };

  const expired = certs.filter(c => c.days_until_expiry < 0).length;
  const critical = certs.filter(c => c.days_until_expiry >= 0 && c.days_until_expiry <= 30).length;
  const warning = certs.filter(c => c.days_until_expiry > 30 && c.days_until_expiry <= 90).length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Shield className="h-5 w-5 text-red-400" />
            Expiring Certifications
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Certifications expiring within the next {daysWindow} days
          </p>
        </div>
        <select
          value={daysWindow}
          onChange={e => setDaysWindow(Number(e.target.value))}
          className="bg-white/5 border border-white/10 rounded-md px-3 py-1.5 text-sm text-white"
        >
          <option value={30}>30 days</option>
          <option value={60}>60 days</option>
          <option value={90}>90 days</option>
          <option value={180}>180 days</option>
          <option value={365}>1 year</option>
        </select>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
          <p className="text-sm text-red-300">Expired</p>
          <p className="text-2xl font-bold text-red-400">{expired}</p>
        </div>
        <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-4">
          <p className="text-sm text-orange-300">Critical (≤30d)</p>
          <p className="text-2xl font-bold text-orange-400">{critical}</p>
        </div>
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
          <p className="text-sm text-yellow-300">Warning (31-90d)</p>
          <p className="text-2xl font-bold text-yellow-400">{warning}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 text-slate-400 animate-spin" />
        </div>
      ) : error ? (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400">
          {error}
        </div>
      ) : certs.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <Shield className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p>No certifications expiring within {daysWindow} days</p>
        </div>
      ) : (
        <div className="bg-white/5 border border-white/10 rounded-lg overflow-hidden">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-300 uppercase">Member</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-300 uppercase">Certification</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-300 uppercase">Expiry Date</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-300 uppercase">Status</th>
              </tr>
            </thead>
            <tbody>
              {certs.map((cert, idx) => (
                <tr key={idx} className="border-b border-white/5 hover:bg-white/[0.03]">
                  <td className="px-4 py-3 text-slate-200 font-medium">{cert.member_name}</td>
                  <td className="px-4 py-3 text-slate-300">{cert.requirement_name}</td>
                  <td className="px-4 py-3 text-slate-300">{new Date(cert.expiry_date).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${getUrgencyClass(cert.days_until_expiry)}`}>
                      {cert.days_until_expiry < 0 ? (
                        <AlertTriangle className="w-3 h-3" />
                      ) : (
                        <Clock className="w-3 h-3" />
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
