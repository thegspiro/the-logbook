import React from 'react';
import { Link } from 'react-router';
import type { AdminHoursSummary } from '../../modules/admin-hours/types';
import type { AdminHoursComplianceItem } from '../../modules/admin-hours/types';

interface AdminHoursSectionProps {
  adminHoursSummary: AdminHoursSummary;
  adminHoursCompliance: AdminHoursComplianceItem[];
}

const AdminHoursSection: React.FC<AdminHoursSectionProps> = ({ adminHoursSummary, adminHoursCompliance }) => {
  return (
    <div className="bg-theme-surface rounded-lg p-6 shadow-sm backdrop-blur-xs">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-theme-text-primary text-lg font-semibold">Administrative Hours</h2>
        <Link
          to="/admin-hours"
          className="text-sm font-medium text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
        >
          View Details
        </Link>
      </div>
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="bg-theme-surface-secondary rounded-lg p-3 text-center">
          <p className="text-theme-text-primary text-2xl font-bold">{adminHoursSummary.totalHours.toFixed(1)}</p>
          <p className="text-theme-text-muted text-xs">Total Hours</p>
        </div>
        <div className="bg-theme-surface-secondary rounded-lg p-3 text-center">
          <p className="text-theme-text-primary text-2xl font-bold">{adminHoursSummary.totalEntries}</p>
          <p className="text-theme-text-muted text-xs">Entries</p>
        </div>
      </div>
      {adminHoursSummary.byCategory.length > 0 && (
        <div className="space-y-2">
          <p className="text-theme-text-muted text-xs font-medium uppercase">By Category</p>
          {adminHoursSummary.byCategory.map((cat) => (
            <div key={cat.categoryId} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                {cat.categoryColor && (
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: cat.categoryColor }} />
                )}
                <span className="text-theme-text-secondary">{cat.categoryName}</span>
              </div>
              <span className="text-theme-text-primary font-medium">{cat.totalHours.toFixed(1)} hrs</span>
            </div>
          ))}
        </div>
      )}
      {adminHoursCompliance.length > 0 && (
        <div className="border-theme-surface-border mt-4 space-y-3 border-t pt-4">
          <p className="text-theme-text-muted text-xs font-medium uppercase">Yearly Requirements</p>
          {adminHoursCompliance.map((req) => {
            const pct = req.requiredHours > 0 ? Math.min(100, (req.loggedHours / req.requiredHours) * 100) : 0;
            const barColor =
              req.status === 'compliant' ? 'bg-green-500' : req.status === 'at_risk' ? 'bg-yellow-500' : 'bg-red-500';
            return (
              <div key={req.categoryId} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    {req.categoryColor && (
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: req.categoryColor }}
                      />
                    )}
                    <span className="text-theme-text-secondary">{req.categoryName}</span>
                  </div>
                  <span className="text-theme-text-primary font-medium">
                    {req.loggedHours} / {req.requiredHours} hrs
                  </span>
                </div>
                <div className="bg-theme-surface-secondary h-2 w-full overflow-hidden rounded-full">
                  <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-theme-text-muted text-xs capitalize">{req.frequency}</span>
                  <span
                    className={`text-xs font-medium ${
                      req.status === 'compliant'
                        ? 'text-green-500'
                        : req.status === 'at_risk'
                          ? 'text-yellow-500'
                          : 'text-red-500'
                    }`}
                  >
                    {req.status === 'compliant' ? 'Complete' : req.status === 'at_risk' ? 'At Risk' : 'Incomplete'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AdminHoursSection;
