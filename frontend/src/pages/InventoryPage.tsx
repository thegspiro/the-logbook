import React from 'react';
import { Package, Wrench, ClipboardCheck, AlertTriangle } from 'lucide-react';

const InventoryPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900">
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-3">
            <div className="bg-emerald-600 rounded-lg p-2">
              <Package className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-white text-2xl font-bold">Equipment & Inventory</h1>
              <p className="text-slate-400 text-sm">
                Manage equipment, track maintenance schedules, and monitor inventory levels
              </p>
            </div>
          </div>
        </div>

        {/* Feature Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20">
            <ClipboardCheck className="w-8 h-8 text-emerald-400 mb-4" />
            <h3 className="text-white font-semibold text-lg mb-2">Equipment Tracking</h3>
            <p className="text-slate-300 text-sm">
              Track all equipment with serial numbers, locations, and assignment history.
            </p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20">
            <Wrench className="w-8 h-8 text-blue-400 mb-4" />
            <h3 className="text-white font-semibold text-lg mb-2">Maintenance Schedules</h3>
            <p className="text-slate-300 text-sm">
              Set up maintenance schedules and receive alerts when equipment is due for service.
            </p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20">
            <AlertTriangle className="w-8 h-8 text-yellow-400 mb-4" />
            <h3 className="text-white font-semibold text-lg mb-2">Low Stock Alerts</h3>
            <p className="text-slate-300 text-sm">
              Monitor inventory levels and get notified when supplies are running low.
            </p>
          </div>
        </div>

        {/* Empty State */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-12 border border-white/20 text-center">
          <Package className="w-16 h-16 text-slate-500 mx-auto mb-4" />
          <h3 className="text-white text-xl font-bold mb-2">No Equipment Tracked</h3>
          <p className="text-slate-300 mb-6">
            Start tracking your department's equipment, tools, and supplies.
          </p>
          <button
            className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors"
            disabled
          >
            Add Equipment (Coming Soon)
          </button>
        </div>
      </main>
    </div>
  );
};

export default InventoryPage;
