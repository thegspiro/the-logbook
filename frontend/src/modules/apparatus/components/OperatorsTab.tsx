/**
 * Operators Tab Component
 *
 * Displays certified operators assigned to an apparatus.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Users } from 'lucide-react';
import type { ApparatusOperator } from '../types';
import { formatDate } from '../../../utils/dateFormatting';

interface OperatorsTabProps {
  id: string;
  operators: ApparatusOperator[];
  loadingTab: boolean;
  timezone: string;
}

export const OperatorsTab: React.FC<OperatorsTabProps> = ({
  id,
  operators,
  loadingTab,
  timezone,
}) => {
  const navigate = useNavigate();

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-theme-text-primary font-bold flex items-center gap-2">
          <Users className="w-5 h-5" />
          Certified Operators
        </h2>
        <button
          onClick={() => navigate(`/apparatus/${id}/operators/new`)}
          className="btn-primary text-sm"
        >
          Add Operator
        </button>
      </div>
      {loadingTab ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-theme-text-primary mx-auto"></div>
        </div>
      ) : operators.length === 0 ? (
        <p className="text-theme-text-muted text-center py-8">No operators assigned.</p>
      ) : (
        <div className="space-y-3">
          {operators.map((op) => (
            <div
              key={op.id}
              className="card-secondary flex items-center justify-between p-4"
            >
              <div>
                <p className="text-theme-text-primary font-medium">Operator ID: {op.userId}</p>
                <p className="text-theme-text-muted text-sm">
                  {op.isCertified ? 'Certified' : 'Not Certified'}
                  {op.certificationExpiration && ` • Expires ${formatDate(op.certificationExpiration, timezone)}`}
                </p>
                {op.hasRestrictions && (
                  <p className="text-yellow-400 text-sm mt-1">Has Restrictions</p>
                )}
              </div>
              <span
                className={`px-2 py-1 text-xs rounded ${
                  op.isActive ? 'bg-green-500/10 text-green-400' : 'bg-theme-surface-secondary text-theme-text-muted'
                }`}
              >
                {op.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default OperatorsTab;
