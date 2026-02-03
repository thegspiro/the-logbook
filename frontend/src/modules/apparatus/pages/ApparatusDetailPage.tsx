/**
 * Apparatus Detail Page
 *
 * Displays detailed information about a single piece of apparatus.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Truck,
  Edit,
  Archive,
  ArrowLeft,
  Wrench,
  Fuel,
  Users,
  Package,
  Camera,
  FileText,
  AlertTriangle,
  Calendar,
  Gauge,
  Clock,
  DollarSign,
  Shield,
  MapPin,
  Info,
} from 'lucide-react';
import { useApparatusStore } from '../store/apparatusStore';
import { StatusBadge } from '../components/StatusBadge';
import { ApparatusTypeBadge } from '../components/ApparatusTypeBadge';
import type {
  ApparatusMaintenance,
  ApparatusFuelLog,
  ApparatusOperator,
  ApparatusEquipment,
} from '../types';
import {
  apparatusMaintenanceService,
  apparatusFuelLogService,
  apparatusOperatorService,
  apparatusEquipmentService,
} from '../services/api';

type TabType = 'overview' | 'maintenance' | 'fuel' | 'operators' | 'equipment' | 'documents';

export const ApparatusDetailPage: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [maintenanceRecords, setMaintenanceRecords] = useState<ApparatusMaintenance[]>([]);
  const [fuelLogs, setFuelLogs] = useState<ApparatusFuelLog[]>([]);
  const [operators, setOperators] = useState<ApparatusOperator[]>([]);
  const [equipment, setEquipment] = useState<ApparatusEquipment[]>([]);
  const [loadingTab, setLoadingTab] = useState(false);

  const {
    currentApparatus,
    types,
    statuses,
    isLoading,
    error,
    fetchApparatus,
    fetchTypes,
    fetchStatuses,
    clearError,
  } = useApparatusStore();

  useEffect(() => {
    if (!id) return;

    const authToken = localStorage.getItem('access_token');
    if (!authToken) {
      navigate('/login');
      return;
    }

    fetchTypes();
    fetchStatuses();
    fetchApparatus(id);
  }, [id, navigate, fetchApparatus, fetchTypes, fetchStatuses]);

  // Load tab-specific data
  useEffect(() => {
    if (!id || !currentApparatus) return;

    const loadTabData = async () => {
      setLoadingTab(true);
      try {
        switch (activeTab) {
          case 'maintenance':
            const maint = await apparatusMaintenanceService.getMaintenanceRecords({ apparatusId: id });
            setMaintenanceRecords(maint);
            break;
          case 'fuel':
            const fuel = await apparatusFuelLogService.getFuelLogs({ apparatusId: id });
            setFuelLogs(fuel);
            break;
          case 'operators':
            const ops = await apparatusOperatorService.getOperators({ apparatusId: id });
            setOperators(ops);
            break;
          case 'equipment':
            const equip = await apparatusEquipmentService.getEquipment({ apparatusId: id });
            setEquipment(equip);
            break;
        }
      } catch (err) {
        console.error('Failed to load tab data:', err);
      } finally {
        setLoadingTab(false);
      }
    };

    if (activeTab !== 'overview' && activeTab !== 'documents') {
      loadTabData();
    }
  }, [id, activeTab, currentApparatus]);

  const getTypeById = (typeId: string) => types.find((t) => t.id === typeId);
  const getStatusById = (statusId: string) => statuses.find((s) => s.id === statusId);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString();
  };

  const formatCurrency = (amount: number | null) => {
    if (amount === null) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
          <p className="text-slate-300">Loading apparatus...</p>
        </div>
      </div>
    );
  }

  if (!currentApparatus) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <Truck className="w-16 h-16 text-slate-500 mx-auto mb-4" />
          <h2 className="text-white text-xl font-bold mb-2">Apparatus Not Found</h2>
          <p className="text-slate-400 mb-6">The apparatus you're looking for doesn't exist.</p>
          <button
            onClick={() => navigate('/apparatus')}
            className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
          >
            Back to Fleet
          </button>
        </div>
      </div>
    );
  }

  const apparatusType = currentApparatus.apparatusType || getTypeById(currentApparatus.apparatusTypeId);
  const status = currentApparatus.statusRecord || getStatusById(currentApparatus.statusId);

  const tabs: { id: TabType; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview', icon: <Info className="w-4 h-4" /> },
    { id: 'maintenance', label: 'Maintenance', icon: <Wrench className="w-4 h-4" /> },
    { id: 'fuel', label: 'Fuel Logs', icon: <Fuel className="w-4 h-4" /> },
    { id: 'operators', label: 'Operators', icon: <Users className="w-4 h-4" /> },
    { id: 'equipment', label: 'Equipment', icon: <Package className="w-4 h-4" /> },
    { id: 'documents', label: 'Documents', icon: <FileText className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900">
      {/* Header */}
      <header className="bg-slate-900/50 backdrop-blur-sm border-b border-white/10 px-6 py-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => navigate('/apparatus')}
                className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="w-12 h-12 bg-red-600 rounded-lg flex items-center justify-center text-white font-bold text-lg">
                {currentApparatus.unitNumber.substring(0, 2)}
              </div>
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-white text-xl font-bold">{currentApparatus.unitNumber}</h1>
                  {status && <StatusBadge status={status} />}
                  {currentApparatus.isArchived && (
                    <span className="px-2 py-1 bg-slate-500/20 text-slate-400 text-xs rounded border border-slate-500/30">
                      ARCHIVED
                    </span>
                  )}
                </div>
                <p className="text-slate-400 text-sm">
                  {currentApparatus.name && `${currentApparatus.name} • `}
                  {currentApparatus.year} {currentApparatus.make} {currentApparatus.model}
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => navigate(`/apparatus/${id}/edit`)}
                className="flex items-center space-x-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
              >
                <Edit className="w-4 h-4" />
                <span>Edit</span>
              </button>
              {!currentApparatus.isArchived && (
                <button
                  onClick={() => navigate(`/apparatus/${id}/archive`)}
                  className="flex items-center space-x-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
                >
                  <Archive className="w-4 h-4" />
                  <span>Archive</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Error Display */}
      {error && (
        <div className="max-w-7xl mx-auto px-6 pt-4">
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-red-400" />
              <span className="text-red-300">{error}</span>
            </div>
            <button onClick={clearError} className="text-red-400 hover:text-red-300">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="max-w-7xl mx-auto px-6 pt-6">
        <div className="flex space-x-1 bg-slate-900/50 rounded-lg p-1 border border-white/10">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center space-x-2 px-4 py-2 rounded-md transition-colors flex-1 justify-center ${
                activeTab === tab.id
                  ? 'bg-red-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <main className="max-w-7xl mx-auto px-6 py-6">
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Info Card */}
            <div className="lg:col-span-2 space-y-6">
              {/* Vehicle Details */}
              <div className="bg-white/10 backdrop-blur-sm rounded-lg border border-white/20 p-6">
                <h2 className="text-white font-bold mb-4 flex items-center gap-2">
                  <Truck className="w-5 h-5" />
                  Vehicle Details
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <p className="text-slate-400 text-xs uppercase">Type</p>
                    {apparatusType && <ApparatusTypeBadge type={apparatusType} />}
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs uppercase">Year</p>
                    <p className="text-white">{currentApparatus.year || '-'}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs uppercase">Make</p>
                    <p className="text-white">{currentApparatus.make || '-'}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs uppercase">Model</p>
                    <p className="text-white">{currentApparatus.model || '-'}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs uppercase">Body Manufacturer</p>
                    <p className="text-white">{currentApparatus.bodyManufacturer || '-'}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs uppercase">VIN</p>
                    <p className="text-white font-mono text-sm">{currentApparatus.vin || '-'}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs uppercase">License Plate</p>
                    <p className="text-white">{currentApparatus.licensePlate || '-'}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs uppercase">Radio ID</p>
                    <p className="text-white">{currentApparatus.radioId || '-'}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs uppercase">Asset Tag</p>
                    <p className="text-white">{currentApparatus.assetTag || '-'}</p>
                  </div>
                </div>
              </div>

              {/* Specifications */}
              <div className="bg-white/10 backdrop-blur-sm rounded-lg border border-white/20 p-6">
                <h2 className="text-white font-bold mb-4 flex items-center gap-2">
                  <Gauge className="w-5 h-5" />
                  Specifications
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-slate-400 text-xs uppercase">Fuel Type</p>
                    <p className="text-white capitalize">{currentApparatus.fuelType?.replace('_', ' ') || '-'}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs uppercase">Fuel Capacity</p>
                    <p className="text-white">{currentApparatus.fuelCapacityGallons ? `${currentApparatus.fuelCapacityGallons} gal` : '-'}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs uppercase">Seating Capacity</p>
                    <p className="text-white">{currentApparatus.seatingCapacity || '-'}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs uppercase">GVWR</p>
                    <p className="text-white">{currentApparatus.gvwr ? `${currentApparatus.gvwr.toLocaleString()} lbs` : '-'}</p>
                  </div>
                  {currentApparatus.pumpCapacityGpm && (
                    <div>
                      <p className="text-slate-400 text-xs uppercase">Pump Capacity</p>
                      <p className="text-white">{currentApparatus.pumpCapacityGpm} GPM</p>
                    </div>
                  )}
                  {currentApparatus.tankCapacityGallons && (
                    <div>
                      <p className="text-slate-400 text-xs uppercase">Tank Capacity</p>
                      <p className="text-white">{currentApparatus.tankCapacityGallons} gal</p>
                    </div>
                  )}
                  {currentApparatus.foamCapacityGallons && (
                    <div>
                      <p className="text-slate-400 text-xs uppercase">Foam Capacity</p>
                      <p className="text-white">{currentApparatus.foamCapacityGallons} gal</p>
                    </div>
                  )}
                  {currentApparatus.ladderLengthFeet && (
                    <div>
                      <p className="text-slate-400 text-xs uppercase">Ladder Length</p>
                      <p className="text-white">{currentApparatus.ladderLengthFeet} ft</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Financial Info */}
              <div className="bg-white/10 backdrop-blur-sm rounded-lg border border-white/20 p-6">
                <h2 className="text-white font-bold mb-4 flex items-center gap-2">
                  <DollarSign className="w-5 h-5" />
                  Financial Information
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-slate-400 text-xs uppercase">Purchase Date</p>
                    <p className="text-white">{formatDate(currentApparatus.purchaseDate)}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs uppercase">Purchase Price</p>
                    <p className="text-white">{formatCurrency(currentApparatus.purchasePrice)}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs uppercase">Current Value</p>
                    <p className="text-white">{formatCurrency(currentApparatus.currentValue)}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs uppercase">In Service Date</p>
                    <p className="text-white">{formatDate(currentApparatus.inServiceDate)}</p>
                  </div>
                  {currentApparatus.isFinanced && (
                    <>
                      <div>
                        <p className="text-slate-400 text-xs uppercase">Financing Company</p>
                        <p className="text-white">{currentApparatus.financingCompany || '-'}</p>
                      </div>
                      <div>
                        <p className="text-slate-400 text-xs uppercase">Monthly Payment</p>
                        <p className="text-white">{formatCurrency(currentApparatus.monthlyPayment)}</p>
                      </div>
                      <div>
                        <p className="text-slate-400 text-xs uppercase">Financing Ends</p>
                        <p className="text-white">{formatDate(currentApparatus.financingEndDate)}</p>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Quick Stats */}
              <div className="bg-white/10 backdrop-blur-sm rounded-lg border border-white/20 p-6">
                <h2 className="text-white font-bold mb-4">Quick Stats</h2>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-slate-400">
                      <Gauge className="w-4 h-4" />
                      <span>Mileage</span>
                    </div>
                    <span className="text-white font-semibold">
                      {currentApparatus.currentMileage?.toLocaleString() || '-'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-slate-400">
                      <Clock className="w-4 h-4" />
                      <span>Hours</span>
                    </div>
                    <span className="text-white font-semibold">
                      {currentApparatus.currentHours?.toLocaleString() || '-'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Important Dates */}
              <div className="bg-white/10 backdrop-blur-sm rounded-lg border border-white/20 p-6">
                <h2 className="text-white font-bold mb-4 flex items-center gap-2">
                  <Calendar className="w-5 h-5" />
                  Important Dates
                </h2>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-sm">Registration</span>
                    <span className="text-white text-sm">
                      {formatDate(currentApparatus.registrationExpiration)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-sm">Inspection</span>
                    <span className="text-white text-sm">
                      {formatDate(currentApparatus.inspectionExpiration)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-sm">Insurance</span>
                    <span className="text-white text-sm">
                      {formatDate(currentApparatus.insuranceExpiration)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-sm">Warranty</span>
                    <span className="text-white text-sm">
                      {formatDate(currentApparatus.warrantyExpiration)}
                    </span>
                  </div>
                </div>
              </div>

              {/* NFPA Compliance */}
              {currentApparatus.nfpaTrackingEnabled && (
                <div className="bg-white/10 backdrop-blur-sm rounded-lg border border-white/20 p-6">
                  <h2 className="text-white font-bold mb-4 flex items-center gap-2">
                    <Shield className="w-5 h-5" />
                    NFPA Compliance
                  </h2>
                  <p className="text-green-400 text-sm">Tracking Enabled</p>
                </div>
              )}

              {/* Notes */}
              {currentApparatus.notes && (
                <div className="bg-white/10 backdrop-blur-sm rounded-lg border border-white/20 p-6">
                  <h2 className="text-white font-bold mb-4">Notes</h2>
                  <p className="text-slate-300 text-sm whitespace-pre-wrap">
                    {currentApparatus.notes}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Maintenance Tab */}
        {activeTab === 'maintenance' && (
          <div className="bg-white/10 backdrop-blur-sm rounded-lg border border-white/20 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-white font-bold flex items-center gap-2">
                <Wrench className="w-5 h-5" />
                Maintenance Records
              </h2>
              <button
                onClick={() => navigate(`/apparatus/${id}/maintenance/new`)}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors text-sm"
              >
                Add Record
              </button>
            </div>
            {loadingTab ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto"></div>
              </div>
            ) : maintenanceRecords.length === 0 ? (
              <p className="text-slate-400 text-center py-8">No maintenance records found.</p>
            ) : (
              <div className="space-y-3">
                {maintenanceRecords.map((record) => (
                  <div
                    key={record.id}
                    className="bg-slate-900/50 rounded-lg p-4 border border-white/10"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-white font-medium">
                          {record.maintenanceType?.name || 'Maintenance'}
                        </p>
                        <p className="text-slate-400 text-sm">
                          {record.isCompleted
                            ? `Completed ${formatDate(record.completedDate)}`
                            : `Due ${formatDate(record.dueDate)}`}
                        </p>
                      </div>
                      <div className="text-right">
                        {record.cost && (
                          <p className="text-white">{formatCurrency(record.cost)}</p>
                        )}
                        <span
                          className={`px-2 py-1 text-xs rounded ${
                            record.isCompleted
                              ? 'bg-green-500/10 text-green-400'
                              : record.isOverdue
                              ? 'bg-red-500/10 text-red-400'
                              : 'bg-yellow-500/10 text-yellow-400'
                          }`}
                        >
                          {record.isCompleted ? 'Completed' : record.isOverdue ? 'Overdue' : 'Pending'}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Fuel Logs Tab */}
        {activeTab === 'fuel' && (
          <div className="bg-white/10 backdrop-blur-sm rounded-lg border border-white/20 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-white font-bold flex items-center gap-2">
                <Fuel className="w-5 h-5" />
                Fuel Logs
              </h2>
              <button
                onClick={() => navigate(`/apparatus/${id}/fuel/new`)}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors text-sm"
              >
                Add Fuel Log
              </button>
            </div>
            {loadingTab ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto"></div>
              </div>
            ) : fuelLogs.length === 0 ? (
              <p className="text-slate-400 text-center py-8">No fuel logs found.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-white/10">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs text-slate-400 uppercase">Date</th>
                      <th className="px-4 py-2 text-left text-xs text-slate-400 uppercase">Fuel Type</th>
                      <th className="px-4 py-2 text-right text-xs text-slate-400 uppercase">Gallons</th>
                      <th className="px-4 py-2 text-right text-xs text-slate-400 uppercase">Cost</th>
                      <th className="px-4 py-2 text-right text-xs text-slate-400 uppercase">Mileage</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {fuelLogs.map((log) => (
                      <tr key={log.id}>
                        <td className="px-4 py-3 text-white">{formatDate(log.fuelDate)}</td>
                        <td className="px-4 py-3 text-slate-300 capitalize">{log.fuelType}</td>
                        <td className="px-4 py-3 text-right text-white">{log.gallons.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right text-white">{formatCurrency(log.totalCost)}</td>
                        <td className="px-4 py-3 text-right text-slate-300">
                          {log.mileageAtFill?.toLocaleString() || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Operators Tab */}
        {activeTab === 'operators' && (
          <div className="bg-white/10 backdrop-blur-sm rounded-lg border border-white/20 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-white font-bold flex items-center gap-2">
                <Users className="w-5 h-5" />
                Certified Operators
              </h2>
              <button
                onClick={() => navigate(`/apparatus/${id}/operators/new`)}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors text-sm"
              >
                Add Operator
              </button>
            </div>
            {loadingTab ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto"></div>
              </div>
            ) : operators.length === 0 ? (
              <p className="text-slate-400 text-center py-8">No operators assigned.</p>
            ) : (
              <div className="space-y-3">
                {operators.map((op) => (
                  <div
                    key={op.id}
                    className="bg-slate-900/50 rounded-lg p-4 border border-white/10 flex items-center justify-between"
                  >
                    <div>
                      <p className="text-white font-medium">Operator ID: {op.userId}</p>
                      <p className="text-slate-400 text-sm">
                        {op.isCertified ? 'Certified' : 'Not Certified'}
                        {op.certificationExpiration && ` • Expires ${formatDate(op.certificationExpiration)}`}
                      </p>
                      {op.hasRestrictions && (
                        <p className="text-yellow-400 text-sm mt-1">Has Restrictions</p>
                      )}
                    </div>
                    <span
                      className={`px-2 py-1 text-xs rounded ${
                        op.isActive ? 'bg-green-500/10 text-green-400' : 'bg-slate-500/10 text-slate-400'
                      }`}
                    >
                      {op.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Equipment Tab */}
        {activeTab === 'equipment' && (
          <div className="bg-white/10 backdrop-blur-sm rounded-lg border border-white/20 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-white font-bold flex items-center gap-2">
                <Package className="w-5 h-5" />
                Equipment
              </h2>
              <button
                onClick={() => navigate(`/apparatus/${id}/equipment/new`)}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors text-sm"
              >
                Add Equipment
              </button>
            </div>
            {loadingTab ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto"></div>
              </div>
            ) : equipment.length === 0 ? (
              <p className="text-slate-400 text-center py-8">No equipment assigned.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {equipment.map((item) => (
                  <div
                    key={item.id}
                    className="bg-slate-900/50 rounded-lg p-4 border border-white/10"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-white font-medium">{item.name}</p>
                      <span className="text-slate-400 text-sm">Qty: {item.quantity}</span>
                    </div>
                    {item.locationOnApparatus && (
                      <p className="text-slate-400 text-sm flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {item.locationOnApparatus}
                      </p>
                    )}
                    <div className="flex gap-2 mt-2">
                      {item.isRequired && (
                        <span className="px-2 py-0.5 bg-red-500/10 text-red-400 text-xs rounded">Required</span>
                      )}
                      {item.isMounted && (
                        <span className="px-2 py-0.5 bg-blue-500/10 text-blue-400 text-xs rounded">Mounted</span>
                      )}
                      <span
                        className={`px-2 py-0.5 text-xs rounded ${
                          item.isPresent ? 'bg-green-500/10 text-green-400' : 'bg-yellow-500/10 text-yellow-400'
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
        )}

        {/* Documents Tab */}
        {activeTab === 'documents' && (
          <div className="bg-white/10 backdrop-blur-sm rounded-lg border border-white/20 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-white font-bold flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Documents & Photos
              </h2>
              <div className="flex gap-2">
                <button className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors text-sm flex items-center gap-2">
                  <Camera className="w-4 h-4" />
                  Add Photo
                </button>
                <button className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors text-sm flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Add Document
                </button>
              </div>
            </div>
            <p className="text-slate-400 text-center py-8">
              Document management will be available in the full implementation.
            </p>
          </div>
        )}
      </main>
    </div>
  );
};

export default ApparatusDetailPage;
