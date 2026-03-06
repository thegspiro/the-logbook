/**
 * Facilities Dashboard — Landing page for the facilities module.
 *
 * Shows summary cards (total facilities, operational, overdue maintenance,
 * upcoming inspections), an action-items list, and a quick-access facility grid.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2,
  Plus,
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Wrench,
  ArrowRight,
  Loader2,
  MapPin,
  Activity,
  Calendar,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useFacilitiesStore } from '../store/facilitiesStore';
import type { Facility } from '../types';
import CreateFacilityModal from '../components/CreateFacilityModal';
import { formatDate } from '../../../utils/dateFormatting';

export default function FacilitiesDashboard() {
  const navigate = useNavigate();
  const {
    facilities,
    facilityTypes,
    facilityStatuses,
    dashboardStats,
    isLoadingDashboard,
    error,
    loadDashboardStats,
    loadLookupData,
  } = useFacilitiesStore();

  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    void loadDashboardStats();
    void loadLookupData();
  }, [loadDashboardStats, loadLookupData]);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  const handleFacilityClick = (facility: Facility) => {
    navigate(`/facilities/${facility.id}`);
  };

  const stats = dashboardStats;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-theme-text-primary">Facilities</h1>
          <p className="text-theme-text-secondary mt-1">
            Manage stations, buildings, maintenance, and inspections
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="btn-primary flex gap-2 items-center py-2.5"
        >
          <Plus className="w-4 h-4" />
          Add Facility
        </button>
      </div>

      {/* Loading */}
      {isLoadingDashboard && !stats ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-theme-text-muted" />
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <SummaryCard
              icon={Building2}
              label="Total Facilities"
              value={stats?.totalFacilities ?? 0}
              subtext={`${stats?.operationalCount ?? 0} operational`}
              color="blue"
            />
            <SummaryCard
              icon={CheckCircle2}
              label="Operational"
              value={stats?.operationalCount ?? 0}
              subtext={stats?.totalFacilities ? `${Math.round(((stats.operationalCount) / stats.totalFacilities) * 100)}% of total` : 'No facilities'}
              color="emerald"
            />
            <SummaryCard
              icon={AlertTriangle}
              label="Overdue Maintenance"
              value={stats?.overdueMaintenanceCount ?? 0}
              subtext={stats?.overdueMaintenanceCount ? 'Action required' : 'All caught up'}
              color={stats?.overdueMaintenanceCount ? 'red' : 'emerald'}
              onClick={() => navigate('/facilities/maintenance?status=overdue')}
            />
            <SummaryCard
              icon={ClipboardCheck}
              label="Upcoming Inspections"
              value={stats?.upcomingInspections.length ?? 0}
              subtext="Next 30 days"
              color="amber"
              onClick={() => navigate('/facilities/inspections')}
            />
          </div>

          {/* Action Items & Recent Activity */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Overdue Maintenance */}
            <div className="bg-theme-surface border border-theme-surface-border rounded-xl">
              <div className="flex items-center justify-between p-5 border-b border-theme-surface-border">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-500" />
                  <h2 className="text-sm font-semibold text-theme-text-primary">Overdue Maintenance</h2>
                </div>
                <button
                  onClick={() => navigate('/facilities/maintenance?status=overdue')}
                  className="text-xs text-theme-text-muted hover:text-theme-text-primary flex items-center gap-1 transition-colors"
                >
                  View all <ArrowRight className="w-3 h-3" />
                </button>
              </div>
              <div className="p-5">
                {!stats?.overdueMaintenanceRecords.length ? (
                  <div className="text-center py-6">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                    <p className="text-sm text-theme-text-muted">No overdue maintenance items</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {stats.overdueMaintenanceRecords.slice(0, 5).map((record) => {
                      const facilityName = facilities.find((f) => f.id === record.facilityId)?.name || 'Unknown';
                      return (
                        <div
                          key={record.id}
                          className="flex items-start gap-3 p-3 rounded-lg bg-red-500/5 border border-red-500/10"
                        >
                          <Wrench className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-theme-text-primary truncate">
                              {record.description || 'Untitled maintenance'}
                            </p>
                            <div className="flex items-center gap-2 text-xs text-theme-text-muted mt-0.5">
                              <span>{facilityName}</span>
                              {record.dueDate && (
                                <span className="text-red-500 font-medium">
                                  Due: {formatDate(record.dueDate)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Upcoming Inspections */}
            <div className="bg-theme-surface border border-theme-surface-border rounded-xl">
              <div className="flex items-center justify-between p-5 border-b border-theme-surface-border">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-amber-500" />
                  <h2 className="text-sm font-semibold text-theme-text-primary">Upcoming Inspections</h2>
                </div>
                <button
                  onClick={() => navigate('/facilities/inspections')}
                  className="text-xs text-theme-text-muted hover:text-theme-text-primary flex items-center gap-1 transition-colors"
                >
                  View all <ArrowRight className="w-3 h-3" />
                </button>
              </div>
              <div className="p-5">
                {!stats?.upcomingInspections.length ? (
                  <div className="text-center py-6">
                    <ClipboardCheck className="w-8 h-8 text-theme-text-muted mx-auto mb-2" />
                    <p className="text-sm text-theme-text-muted">No inspections in the next 30 days</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {stats.upcomingInspections.slice(0, 5).map((insp) => {
                      const facilityName = facilities.find((f) => f.id === insp.facilityId)?.name || 'Unknown';
                      return (
                        <div
                          key={insp.id}
                          className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/10"
                        >
                          <ClipboardCheck className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-theme-text-primary truncate">
                              {insp.title}
                            </p>
                            <div className="flex items-center gap-2 text-xs text-theme-text-muted mt-0.5">
                              <span>{facilityName}</span>
                              {insp.nextInspectionDate && (
                                <span className="font-medium">
                                  {formatDate(insp.nextInspectionDate)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Recent Activity */}
          {stats?.recentActivity && stats.recentActivity.length > 0 && (
            <div className="bg-theme-surface border border-theme-surface-border rounded-xl">
              <div className="flex items-center gap-2 p-5 border-b border-theme-surface-border">
                <Activity className="w-4 h-4 text-theme-text-muted" />
                <h2 className="text-sm font-semibold text-theme-text-primary">Recent Activity</h2>
              </div>
              <div className="divide-y divide-theme-surface-border">
                {stats.recentActivity.map((record) => {
                  const facilityName = facilities.find((f) => f.id === record.facilityId)?.name || 'Unknown';
                  return (
                    <div key={record.id} className="flex items-center gap-3 px-5 py-3">
                      <div className="w-7 h-7 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-theme-text-primary truncate">
                          {record.description || 'Maintenance completed'}
                        </p>
                        <p className="text-xs text-theme-text-muted">{facilityName}</p>
                      </div>
                      <span className="text-xs text-theme-text-muted shrink-0">
                        {record.completedDate ? formatDate(record.completedDate) : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Facility Grid */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-theme-text-primary">All Facilities</h2>
              <button
                onClick={() => setShowCreateModal(true)}
                className="text-sm text-theme-text-muted hover:text-theme-text-primary flex items-center gap-1 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Add Facility
              </button>
            </div>

            {facilities.length === 0 ? (
              <div className="text-center py-16 bg-theme-surface border border-theme-surface-border rounded-xl">
                <Building2 className="w-12 h-12 text-theme-text-muted mx-auto mb-3" />
                <p className="text-theme-text-muted mb-4">
                  No facilities yet. Add your first facility to get started.
                </p>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="btn-primary inline-flex gap-2 items-center"
                >
                  <Plus className="w-4 h-4" /> Add Facility
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {facilities.map((facility) => (
                  <FacilityCard
                    key={facility.id}
                    facility={facility}
                    onClick={handleFacilityClick}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <CreateFacilityModal
          facilityTypes={facilityTypes}
          facilityStatuses={facilityStatuses}
          onClose={() => setShowCreateModal(false)}
          onCreated={(facility) => {
            setShowCreateModal(false);
            navigate(`/facilities/${facility.id}`);
          }}
        />
      )}
    </div>
  );
}

/* ---------- Sub-components ---------- */

interface SummaryCardProps {
  icon: React.ElementType;
  label: string;
  value: number;
  subtext: string;
  color: 'blue' | 'emerald' | 'red' | 'amber';
  onClick?: () => void;
}

const COLOR_MAP: Record<string, { bg: string; icon: string }> = {
  blue: { bg: 'bg-blue-500/10', icon: 'text-blue-500' },
  emerald: { bg: 'bg-emerald-500/10', icon: 'text-emerald-500' },
  red: { bg: 'bg-red-500/10', icon: 'text-red-500' },
  amber: { bg: 'bg-amber-500/10', icon: 'text-amber-500' },
};

function SummaryCard({ icon: Icon, label, value, subtext, color, onClick }: SummaryCardProps) {
  const colors = COLOR_MAP[color] ?? { bg: 'bg-blue-500/10', icon: 'text-blue-500' };
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      onClick={onClick}
      className={`bg-theme-surface border border-theme-surface-border rounded-xl p-5 text-left transition-all ${
        onClick ? 'hover:shadow-md hover:border-theme-surface-border cursor-pointer' : ''
      }`}
    >
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-9 h-9 rounded-lg ${colors.bg} flex items-center justify-center`}>
          <Icon className={`w-4.5 h-4.5 ${colors.icon}`} />
        </div>
        <span className="text-xs font-medium text-theme-text-muted uppercase tracking-wide">
          {label}
        </span>
      </div>
      <p className="text-2xl font-bold text-theme-text-primary">{value}</p>
      <p className="text-xs text-theme-text-muted mt-1">{subtext}</p>
    </Wrapper>
  );
}

interface FacilityCardProps {
  facility: Facility;
  onClick: (facility: Facility) => void;
}

function FacilityCard({ facility, onClick }: FacilityCardProps) {
  const address = [facility.addressLine1, facility.city, facility.state]
    .filter(Boolean)
    .join(', ');

  return (
    <button
      onClick={() => onClick(facility)}
      className={`text-left p-5 rounded-xl border transition-all hover:shadow-md bg-theme-surface hover:border-theme-surface-border ${
        facility.isArchived
          ? 'border-amber-500/20 opacity-60'
          : 'border-theme-surface-border'
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-red-500/10 flex items-center justify-center shrink-0">
            <Building2 className="w-4.5 h-4.5 text-red-500" />
          </div>
          <div>
            <h3 className="font-semibold text-theme-text-primary">{facility.name}</h3>
            {facility.facilityNumber && (
              <p className="text-xs text-theme-text-muted">{facility.facilityNumber}</p>
            )}
          </div>
        </div>
        {facility.isArchived && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400">
            Archived
          </span>
        )}
      </div>

      {address && (
        <div className="flex items-center gap-1.5 text-sm text-theme-text-secondary mb-3">
          <MapPin className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{address}</span>
        </div>
      )}

      <div className="flex items-center justify-between">
        {facility.facilityType && (
          <span className="text-xs px-2.5 py-1 rounded-full bg-theme-surface-hover text-theme-text-muted">
            {facility.facilityType.name}
          </span>
        )}
        {facility.statusRecord && (
          <span
            className="text-xs px-2.5 py-1 rounded-full font-medium"
            style={{
              backgroundColor: facility.statusRecord.color
                ? `${facility.statusRecord.color}20`
                : undefined,
              color: facility.statusRecord.color || undefined,
            }}
          >
            {facility.statusRecord.name}
          </span>
        )}
      </div>
    </button>
  );
}
