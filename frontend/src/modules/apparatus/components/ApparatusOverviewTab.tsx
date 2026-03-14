/**
 * Apparatus Overview Tab Component
 *
 * Displays the overview tab with Vehicle Details, Specifications,
 * Financial Info, Quick Stats, Important Dates, NFPA Compliance, and Notes cards.
 */

import React from 'react';
import {
  Truck,
  Gauge,
  DollarSign,
  Clock,
  Calendar,
  Shield,
} from 'lucide-react';
import { ApparatusTypeBadge } from './ApparatusTypeBadge';
import type { Apparatus, ApparatusType } from '../types';
import { formatCurrency } from '@/utils/currencyFormatting';
import { formatDate, formatNumber } from '../../../utils/dateFormatting';

interface ApparatusOverviewTabProps {
  currentApparatus: Apparatus;
  apparatusType: ApparatusType | undefined;
  timezone: string;
}

export const ApparatusOverviewTab: React.FC<ApparatusOverviewTabProps> = ({
  currentApparatus,
  apparatusType,
  timezone,
}) => {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Main Info Card */}
      <div className="lg:col-span-2 space-y-6">
        {/* Vehicle Details */}
        <div className="card p-6">
          <h2 className="text-theme-text-primary font-bold mb-4 flex items-center gap-2">
            <Truck className="w-5 h-5" />
            Vehicle Details
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <p className="text-theme-text-muted text-xs uppercase">Type</p>
              {apparatusType && <ApparatusTypeBadge type={apparatusType} />}
            </div>
            <div>
              <p className="text-theme-text-muted text-xs uppercase">Year</p>
              <p className="text-theme-text-primary">{currentApparatus.year || '-'}</p>
            </div>
            <div>
              <p className="text-theme-text-muted text-xs uppercase">Make</p>
              <p className="text-theme-text-primary">{currentApparatus.make || '-'}</p>
            </div>
            <div>
              <p className="text-theme-text-muted text-xs uppercase">Model</p>
              <p className="text-theme-text-primary">{currentApparatus.model || '-'}</p>
            </div>
            <div>
              <p className="text-theme-text-muted text-xs uppercase">Body Manufacturer</p>
              <p className="text-theme-text-primary">{currentApparatus.bodyManufacturer || '-'}</p>
            </div>
            <div>
              <p className="text-theme-text-muted text-xs uppercase">VIN</p>
              <p className="text-theme-text-primary font-mono text-sm">{currentApparatus.vin || '-'}</p>
            </div>
            <div>
              <p className="text-theme-text-muted text-xs uppercase">License Plate</p>
              <p className="text-theme-text-primary">{currentApparatus.licensePlate || '-'}</p>
            </div>
            <div>
              <p className="text-theme-text-muted text-xs uppercase">Radio ID</p>
              <p className="text-theme-text-primary">{currentApparatus.radioId || '-'}</p>
            </div>
            <div>
              <p className="text-theme-text-muted text-xs uppercase">Asset Tag</p>
              <p className="text-theme-text-primary">{currentApparatus.assetTag || '-'}</p>
            </div>
          </div>
        </div>

        {/* Specifications */}
        <div className="card p-6">
          <h2 className="text-theme-text-primary font-bold mb-4 flex items-center gap-2">
            <Gauge className="w-5 h-5" />
            Specifications
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-theme-text-muted text-xs uppercase">Minimum Staffing</p>
              <p className="text-theme-text-primary">{currentApparatus.minStaffing} crew</p>
            </div>
            <div>
              <p className="text-theme-text-muted text-xs uppercase">Fuel Type</p>
              <p className="text-theme-text-primary capitalize">{currentApparatus.fuelType?.replace('_', ' ') || '-'}</p>
            </div>
            <div>
              <p className="text-theme-text-muted text-xs uppercase">Fuel Capacity</p>
              <p className="text-theme-text-primary">{currentApparatus.fuelCapacityGallons ? `${currentApparatus.fuelCapacityGallons} gal` : '-'}</p>
            </div>
            <div>
              <p className="text-theme-text-muted text-xs uppercase">Seating Capacity</p>
              <p className="text-theme-text-primary">{currentApparatus.seatingCapacity || '-'}</p>
            </div>
            <div>
              <p className="text-theme-text-muted text-xs uppercase">GVWR</p>
              <p className="text-theme-text-primary">{currentApparatus.gvwr ? `${formatNumber(currentApparatus.gvwr)} lbs` : '-'}</p>
            </div>
            {currentApparatus.pumpCapacityGpm && (
              <div>
                <p className="text-theme-text-muted text-xs uppercase">Pump Capacity</p>
                <p className="text-theme-text-primary">{currentApparatus.pumpCapacityGpm} GPM</p>
              </div>
            )}
            {currentApparatus.tankCapacityGallons && (
              <div>
                <p className="text-theme-text-muted text-xs uppercase">Tank Capacity</p>
                <p className="text-theme-text-primary">{currentApparatus.tankCapacityGallons} gal</p>
              </div>
            )}
            {currentApparatus.foamCapacityGallons && (
              <div>
                <p className="text-theme-text-muted text-xs uppercase">Foam Capacity</p>
                <p className="text-theme-text-primary">{currentApparatus.foamCapacityGallons} gal</p>
              </div>
            )}
            {currentApparatus.ladderLengthFeet && (
              <div>
                <p className="text-theme-text-muted text-xs uppercase">Ladder Length</p>
                <p className="text-theme-text-primary">{currentApparatus.ladderLengthFeet} ft</p>
              </div>
            )}
          </div>
        </div>

        {/* Financial Info */}
        <div className="card p-6">
          <h2 className="text-theme-text-primary font-bold mb-4 flex items-center gap-2">
            <DollarSign className="w-5 h-5" />
            Financial Information
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-theme-text-muted text-xs uppercase">Purchase Date</p>
              <p className="text-theme-text-primary">{formatDate(currentApparatus.purchaseDate, timezone)}</p>
            </div>
            <div>
              <p className="text-theme-text-muted text-xs uppercase">Purchase Price</p>
              <p className="text-theme-text-primary">{formatCurrency(currentApparatus.purchasePrice)}</p>
            </div>
            <div>
              <p className="text-theme-text-muted text-xs uppercase">Current Value</p>
              <p className="text-theme-text-primary">{formatCurrency(currentApparatus.currentValue)}</p>
            </div>
            <div>
              <p className="text-theme-text-muted text-xs uppercase">In Service Date</p>
              <p className="text-theme-text-primary">{formatDate(currentApparatus.inServiceDate, timezone)}</p>
            </div>
            {currentApparatus.isFinanced && (
              <>
                <div>
                  <p className="text-theme-text-muted text-xs uppercase">Financing Company</p>
                  <p className="text-theme-text-primary">{currentApparatus.financingCompany || '-'}</p>
                </div>
                <div>
                  <p className="text-theme-text-muted text-xs uppercase">Monthly Payment</p>
                  <p className="text-theme-text-primary">{formatCurrency(currentApparatus.monthlyPayment)}</p>
                </div>
                <div>
                  <p className="text-theme-text-muted text-xs uppercase">Financing Ends</p>
                  <p className="text-theme-text-primary">{formatDate(currentApparatus.financingEndDate, timezone)}</p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Sidebar */}
      <div className="space-y-6">
        {/* Quick Stats */}
        <div className="card p-6">
          <h2 className="text-theme-text-primary font-bold mb-4">Quick Stats</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-theme-text-muted">
                <Gauge className="w-4 h-4" />
                <span>Mileage</span>
              </div>
              <span className="text-theme-text-primary font-semibold">
                {currentApparatus.currentMileage != null ? formatNumber(currentApparatus.currentMileage) : '-'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-theme-text-muted">
                <Clock className="w-4 h-4" />
                <span>Hours</span>
              </div>
              <span className="text-theme-text-primary font-semibold">
                {currentApparatus.currentHours != null ? formatNumber(currentApparatus.currentHours) : '-'}
              </span>
            </div>
          </div>
        </div>

        {/* Important Dates */}
        <div className="card p-6">
          <h2 className="text-theme-text-primary font-bold mb-4 flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Important Dates
          </h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-theme-text-muted text-sm">Registration</span>
              <span className="text-theme-text-primary text-sm">
                {formatDate(currentApparatus.registrationExpiration, timezone)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-theme-text-muted text-sm">Inspection</span>
              <span className="text-theme-text-primary text-sm">
                {formatDate(currentApparatus.inspectionExpiration, timezone)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-theme-text-muted text-sm">Insurance</span>
              <span className="text-theme-text-primary text-sm">
                {formatDate(currentApparatus.insuranceExpiration, timezone)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-theme-text-muted text-sm">Warranty</span>
              <span className="text-theme-text-primary text-sm">
                {formatDate(currentApparatus.warrantyExpiration, timezone)}
              </span>
            </div>
          </div>
        </div>

        {/* NFPA Compliance */}
        {currentApparatus.nfpaTrackingEnabled && (
          <div className="card p-6">
            <h2 className="text-theme-text-primary font-bold mb-4 flex items-center gap-2">
              <Shield className="w-5 h-5" />
              NFPA Compliance
            </h2>
            <p className="text-green-400 text-sm">Tracking Enabled</p>
          </div>
        )}

        {/* Notes */}
        {currentApparatus.notes && (
          <div className="card p-6">
            <h2 className="text-theme-text-primary font-bold mb-4">Notes</h2>
            <p className="text-theme-text-secondary text-sm whitespace-pre-wrap">
              {currentApparatus.notes}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ApparatusOverviewTab;
