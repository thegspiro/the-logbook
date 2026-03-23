/**
 * Equipment Tab Component
 *
 * Displays equipment assigned to an apparatus in a grid layout.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Package, MapPin } from 'lucide-react';
import type { ApparatusEquipment } from '../types';

interface EquipmentTabProps {
  id: string;
  equipment: ApparatusEquipment[];
  loadingTab: boolean;
}

export const EquipmentTab: React.FC<EquipmentTabProps> = ({
  id,
  equipment,
  loadingTab,
}) => {
  const navigate = useNavigate();

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-theme-text-primary font-bold flex items-center gap-2">
          <Package className="w-5 h-5" />
          Equipment
        </h2>
        <button
          onClick={() => navigate(`/apparatus/${id}/equipment/new`)}
          className="btn-primary text-sm"
        >
          Add Equipment
        </button>
      </div>
      {loadingTab ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-theme-text-primary mx-auto"></div>
        </div>
      ) : equipment.length === 0 ? (
        <p className="text-theme-text-muted text-center py-8">No equipment assigned.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {equipment.map((item) => (
            <div
              key={item.id}
              className="card-secondary p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-theme-text-primary font-medium">{item.name}</p>
                <span className="text-theme-text-muted text-sm">Qty: {item.quantity}</span>
              </div>
              {item.locationOnApparatus && (
                <p className="text-theme-text-muted text-sm flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {item.locationOnApparatus}
                </p>
              )}
              <div className="flex gap-2 mt-2">
                {item.isRequired && (
                  <span className="px-2 py-0.5 bg-red-500/10 text-red-700 dark:text-red-400 text-xs rounded-sm">Required</span>
                )}
                {item.isMounted && (
                  <span className="px-2 py-0.5 bg-blue-500/10 text-blue-700 dark:text-blue-400 text-xs rounded-sm">Mounted</span>
                )}
                <span
                  className={`px-2 py-0.5 text-xs rounded ${
                    item.isPresent ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400'
                  }`}
                >
                  {item.isPresent ? 'Present' : 'Missing'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default EquipmentTab;
