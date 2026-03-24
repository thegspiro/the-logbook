/**
 * Apparatus Detail Page
 *
 * Thin orchestrator that manages tab state, tab-specific data loading,
 * and renders the header, tab bar, and active tab component.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Truck,
  Wrench,
  Fuel,
  Users,
  Package,
  FileText,
  AlertTriangle,
  Info,
} from 'lucide-react';
import { useApparatusStore } from '../store/apparatusStore';
import { ApparatusDetailHeader } from '../components/ApparatusDetailHeader';
import { ApparatusOverviewTab } from '../components/ApparatusOverviewTab';
import { MaintenanceTab } from '../components/MaintenanceTab';
import { FuelLogsTab } from '../components/FuelLogsTab';
import { OperatorsTab } from '../components/OperatorsTab';
import { EquipmentTab } from '../components/EquipmentTab';
import { DocumentsTab } from '../components/DocumentsTab';
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
import { useTimezone } from '../../../hooks/useTimezone';
import { Breadcrumbs } from '@/components/ux/Breadcrumbs';

type TabType = 'overview' | 'maintenance' | 'fuel' | 'operators' | 'equipment' | 'documents';

export const ApparatusDetailPage: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as TabType) || 'overview';
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [maintenanceRecords, setMaintenanceRecords] = useState<ApparatusMaintenance[]>([]);
  const [fuelLogs, setFuelLogs] = useState<ApparatusFuelLog[]>([]);
  const [operators, setOperators] = useState<ApparatusOperator[]>([]);
  const [equipment, setEquipment] = useState<ApparatusEquipment[]>([]);
  const [loadingTab, setLoadingTab] = useState(false);

  const tz = useTimezone();

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

    void fetchTypes();
    void fetchStatuses();
    void fetchApparatus(id);
  }, [id, fetchApparatus, fetchTypes, fetchStatuses]);

  // Load tab-specific data
  useEffect(() => {
    if (!id || !currentApparatus) return;

    const loadTabData = async () => {
      setLoadingTab(true);
      try {
        switch (activeTab) {
          case 'maintenance': {
            const maint = await apparatusMaintenanceService.getMaintenanceRecords({ apparatusId: id });
            setMaintenanceRecords(maint);
            break;
          }
          case 'fuel': {
            const fuel = await apparatusFuelLogService.getFuelLogs({ apparatusId: id });
            setFuelLogs(fuel);
            break;
          }
          case 'operators': {
            const ops = await apparatusOperatorService.getOperators({ apparatusId: id });
            setOperators(ops);
            break;
          }
          case 'equipment': {
            const equip = await apparatusEquipmentService.getEquipment({ apparatusId: id });
            setEquipment(equip);
            break;
          }
        }
      } catch (_err) {
        // Error silently handled - tab data will show empty state
      } finally {
        setLoadingTab(false);
      }
    };

    if (activeTab !== 'overview' && activeTab !== 'documents') {
      void loadTabData();
    }
  }, [id, activeTab, currentApparatus]);

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    if (tab === 'overview') {
      setSearchParams({});
    } else {
      setSearchParams({ tab });
    }
  };

  const handleTabAdd = (tab: TabType) => {
    setActiveTab(tab);
    setSearchParams({ tab, action: 'new' });
  };

  const getTypeById = (typeId: string) => types.find((t) => t.id === typeId);
  const getStatusById = (statusId: string) => statuses.find((s) => s.id === statusId);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-theme-bg flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-theme-text-primary mx-auto mb-4"></div>
          <p className="text-theme-text-secondary">Loading apparatus...</p>
        </div>
      </div>
    );
  }

  if (!currentApparatus) {
    return (
      <div className="min-h-screen bg-theme-bg flex items-center justify-center">
        <div className="text-center">
          <Truck className="w-16 h-16 text-theme-text-muted mx-auto mb-4" />
          <h2 className="text-theme-text-primary text-xl font-bold mb-2">Apparatus Not Found</h2>
          <p className="text-theme-text-muted mb-6">The apparatus you&#39;re looking for doesn&#39;t exist.</p>
          <button
            onClick={() => navigate('/apparatus')}
            className="btn-primary px-6 py-3"
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
    <div className="min-h-screen bg-theme-bg">
      <div className="max-w-7xl mx-auto px-6 pt-6">
        <Breadcrumbs />
      </div>
      {/* Header */}
      <ApparatusDetailHeader
        currentApparatus={currentApparatus}
        status={status}
        id={id || ''}
        isArchived={currentApparatus.isArchived}
      />

      {/* Error Display */}
      {error && (
        <div className="max-w-7xl mx-auto px-6 pt-4">
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-red-700 dark:text-red-400" />
              <span className="text-red-700 dark:text-red-300">{error}</span>
            </div>
            <button onClick={clearError} className="text-red-700 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="max-w-7xl mx-auto px-6 pt-6">
        <div className="card-secondary flex p-1 space-x-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`flex items-center space-x-2 px-4 py-2 rounded-md transition-colors flex-1 justify-center ${
                activeTab === tab.id
                  ? 'bg-red-600 text-white'
                  : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-secondary'
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
          <ApparatusOverviewTab
            currentApparatus={currentApparatus}
            apparatusType={apparatusType}
            timezone={tz}
          />
        )}

        {activeTab === 'maintenance' && (
          <MaintenanceTab
            maintenanceRecords={maintenanceRecords}
            loadingTab={loadingTab}
            timezone={tz}
            onAdd={() => handleTabAdd('maintenance')}
          />
        )}

        {activeTab === 'fuel' && (
          <FuelLogsTab
            fuelLogs={fuelLogs}
            loadingTab={loadingTab}
            timezone={tz}
            onAdd={() => handleTabAdd('fuel')}
          />
        )}

        {activeTab === 'operators' && (
          <OperatorsTab
            operators={operators}
            loadingTab={loadingTab}
            timezone={tz}
            onAdd={() => handleTabAdd('operators')}
          />
        )}

        {activeTab === 'equipment' && (
          <EquipmentTab
            equipment={equipment}
            loadingTab={loadingTab}
            onAdd={() => handleTabAdd('equipment')}
          />
        )}

        {activeTab === 'documents' && (
          <DocumentsTab id={id || ''} />
        )}
      </main>
    </div>
  );
};

export default ApparatusDetailPage;
