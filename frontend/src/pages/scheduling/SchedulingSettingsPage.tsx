/**
 * Scheduling Settings Page
 *
 * Standalone admin page for scheduling settings.
 * Wraps the existing ShiftSettingsPanel component with page chrome and back navigation.
 */

import React from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Settings, Loader2 } from "lucide-react";
import { ShiftSettingsPanel } from "../../modules/scheduling/components/ShiftSettingsPanel";
import { useSchedulingStore } from "../../modules/scheduling/store/schedulingStore";

const SchedulingSettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    templates: backendTemplates,
    apparatus: apparatusList,
    templatesLoaded,
    loadInitialData,
  } = useSchedulingStore();

  React.useEffect(() => {
    if (!templatesLoaded) {
      void loadInitialData();
    }
  }, [templatesLoaded, loadInitialData]);

  return (
    <div className="min-h-screen bg-theme-bg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => void navigate("/scheduling")}
            className="p-1.5 rounded-lg hover:bg-theme-surface-hover text-theme-text-muted"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-violet-500" />
            <h1 className="text-xl font-bold text-theme-text-primary">
              Scheduling Settings
            </h1>
          </div>
        </div>
        {!templatesLoaded ? (
          <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
            <Loader2 className="w-8 h-8 animate-spin text-theme-text-muted" />
          </div>
        ) : (
          <ShiftSettingsPanel
            templates={backendTemplates}
            apparatusList={apparatusList}
            onNavigateToTemplates={() => void navigate("/scheduling/templates")}
          />
        )}
      </div>
    </div>
  );
};

export default SchedulingSettingsPage;
