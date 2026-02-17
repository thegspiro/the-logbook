/**
 * Inventory Admin Hub
 *
 * Consolidated admin page for inventory management.
 * Currently wraps the main InventoryPage which has inline admin controls.
 * Additional tabs can be added as inventory features grow.
 *
 * Requires: inventory.manage permission
 */

import React, { lazy, Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

const InventoryPage = lazy(() => import('./InventoryPage'));

type AdminTab = 'manage';

const tabs: { id: AdminTab; label: string }[] = [
  { id: 'manage', label: 'Manage Inventory' },
];

const TabLoading = () => (
  <div className="flex justify-center items-center h-64">
    <div className="text-slate-400">Loading...</div>
  </div>
);

export const InventoryAdminHub: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as AdminTab | null;
  const [activeTab, setActiveTab] = useState<AdminTab>(tabParam && tabs.some(t => t.id === tabParam) ? tabParam : 'manage');

  useEffect(() => {
    if (tabParam && tabs.some(t => t.id === tabParam)) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  const handleTabChange = (tab: AdminTab) => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  return (
    <div>
      {/* Header + Tab Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">Inventory Administration</h1>
          <p className="mt-1 text-sm text-slate-400">
            Manage inventory items, categories, and assignments
          </p>
        </div>

        <div className="border-b border-white/10">
          <nav className="flex space-x-1 overflow-x-auto" aria-label="Inventory admin tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`whitespace-nowrap px-4 py-3 text-sm font-medium border-b-2 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 ${
                  activeTab === tab.id
                    ? 'border-red-500 text-white'
                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-white/30'
                }`}
                aria-current={activeTab === tab.id ? 'page' : undefined}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Tab Content */}
      <Suspense fallback={<TabLoading />}>
        {activeTab === 'manage' && <InventoryPage />}
      </Suspense>
    </div>
  );
};

export default InventoryAdminHub;
