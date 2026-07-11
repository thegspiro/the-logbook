import React from 'react';
import { Check } from 'lucide-react';

interface ScanSuccessFlashProps {
  active: boolean;
}

/**
 * Brief green confirmation overlay shown when a code is captured. Render it
 * inside a `relative` scanner viewport container; it is purely decorative and
 * ignores pointer events.
 */
export const ScanSuccessFlash: React.FC<ScanSuccessFlashProps> = ({ active }) => {
  if (!active) return null;
  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-emerald-500/40 animate-fade-in"
      aria-hidden="true"
      data-testid="scan-success-flash"
    >
      <div className="rounded-full bg-emerald-500 p-3 shadow-lg">
        <Check className="h-8 w-8 text-white" aria-hidden="true" />
      </div>
    </div>
  );
};
