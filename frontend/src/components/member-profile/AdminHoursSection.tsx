import React from "react";
import { Link } from "react-router-dom";
import type { AdminHoursSummary } from "../../modules/admin-hours/types";
import type { AdminHoursComplianceItem } from "../../modules/admin-hours/types";

interface AdminHoursSectionProps {
  adminHoursSummary: AdminHoursSummary;
  adminHoursCompliance: AdminHoursComplianceItem[];
}

const AdminHoursSection: React.FC<AdminHoursSectionProps> = ({
  adminHoursSummary,
  adminHoursCompliance,
}) => {
  return (
    <div className="bg-theme-surface backdrop-blur-xs shadow-sm rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-theme-text-primary">
          Administrative Hours
        </h2>
        <Link
          to="/admin-hours"
          className="text-sm text-blue-700 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium"
        >
          View Details
        </Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div className="bg-theme-surface-secondary rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-theme-text-primary">
            {adminHoursSummary.totalHours.toFixed(1)}
          </p>
          <p className="text-xs text-theme-text-muted">Total Hours</p>
        </div>
        <div className="bg-theme-surface-secondary rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-theme-text-primary">
            {adminHoursSummary.totalEntries}
          </p>
          <p className="text-xs text-theme-text-muted">Entries</p>
        </div>
      </div>
      {adminHoursSummary.byCategory.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-theme-text-muted uppercase font-medium">
            By Category
          </p>
          {adminHoursSummary.byCategory.map((cat) => (
            <div
              key={cat.categoryId}
              className="flex items-center justify-between text-sm"
            >
              <div className="flex items-center gap-2">
                {cat.categoryColor && (
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: cat.categoryColor }}
                  />
                )}
                <span className="text-theme-text-secondary">
                  {cat.categoryName}
                </span>
              </div>
              <span className="font-medium text-theme-text-primary">
                {cat.totalHours.toFixed(1)} hrs
              </span>
            </div>
          ))}
        </div>
      )}
      {adminHoursCompliance.length > 0 && (
        <div className="space-y-3 mt-4 pt-4 border-t border-theme-surface-border">
          <p className="text-xs text-theme-text-muted uppercase font-medium">
            Yearly Requirements
          </p>
          {adminHoursCompliance.map((req) => {
            const pct = req.requiredHours > 0
              ? Math.min(100, (req.loggedHours / req.requiredHours) * 100)
              : 0;
            const barColor =
              req.status === 'compliant'
                ? 'bg-green-500'
                : req.status === 'at_risk'
                  ? 'bg-yellow-500'
                  : 'bg-red-500';
            return (
              <div key={req.categoryId} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    {req.categoryColor && (
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: req.categoryColor }}
                      />
                    )}
                    <span className="text-theme-text-secondary">
                      {req.categoryName}
                    </span>
                  </div>
                  <span className="font-medium text-theme-text-primary">
                    {req.loggedHours} / {req.requiredHours} hrs
                  </span>
                </div>
                <div className="w-full h-2 bg-theme-surface-secondary rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${barColor}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-theme-text-muted capitalize">
                    {req.frequency}
                  </span>
                  <span className={`text-xs font-medium ${
                    req.status === 'compliant'
                      ? 'text-green-500'
                      : req.status === 'at_risk'
                        ? 'text-yellow-500'
                        : 'text-red-500'
                  }`}>
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
