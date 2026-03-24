/**
 * Scheduling Patterns Page
 *
 * Standalone admin page for managing shift patterns.
 * Wraps the existing PatternsTab component with page chrome and back navigation.
 */

import React, { Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Repeat, Loader2 } from "lucide-react";
import { lazyWithRetry } from "../../utils/lazyWithRetry";

const PatternsTab = lazyWithRetry(() => import("./PatternsTab"));

const SchedulingPatternsPage: React.FC = () => {
  const navigate = useNavigate();

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
            <Repeat className="w-5 h-5 text-violet-500" />
            <h1 className="text-xl font-bold text-theme-text-primary">
              Shift Patterns
            </h1>
          </div>
        </div>
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
              <Loader2 className="w-8 h-8 animate-spin text-theme-text-muted" />
            </div>
          }
        >
          <PatternsTab />
        </Suspense>
      </div>
    </div>
  );
};

export default SchedulingPatternsPage;
