import React from 'react';
import { BatteryFull, Signal, Wifi } from 'lucide-react';

type PhoneSize = 'compact' | 'expanded';

interface CrewPreviewPhoneProps {
  size: PhoneSize;
  /** Accessible name of the device frame; the builder's tests address it by this. */
  label: string;
  /** CSS length for the screen. The sweep fills it, so it is the phone's height. */
  screenHeight: string;
  children: React.ReactNode;
}

const SIZES: Record<PhoneSize, { frame: string; statusBar: string; island: string; homeBar: string }> = {
  compact: {
    frame: 'w-[268px] rounded-[2.25rem] border-[6px]',
    statusBar: 'h-7 px-5 text-[11px]',
    island: 'top-1.5 h-4 w-20',
    homeBar: 'py-1.5',
  },
  expanded: {
    frame: 'w-[390px] max-w-[90vw] rounded-[2.75rem] border-[8px]',
    statusBar: 'h-9 px-7 text-[13px]',
    island: 'top-2 h-5 w-28',
    homeBar: 'py-2',
  },
};

/**
 * The device mock around the builder's crew preview.
 *
 * The status bar is slate-900, not the page canvas: the crew's sweep and finish
 * screens both open on a slate-900 header in either theme, so a light bar above
 * it read as a second, unrelated header sitting on top of the app. Joined to the
 * header the way a phone tints its status bar, the two are one band.
 *
 * `relative` on the screen is load-bearing, not decoration: the sweep renders
 * `absolute inset-0` under previewMode, and without a containing block it
 * resolves against the nearest positioned ancestor and covers the builder
 * around the phone instead of filling it.
 */
export const CrewPreviewPhone: React.FC<CrewPreviewPhoneProps> = ({ size, label, screenHeight, children }) => {
  const s = SIZES[size];
  return (
    <div
      className={`bg-theme-bg text-theme-text-primary relative mx-auto overflow-hidden border-gray-800 shadow-2xl dark:border-gray-600 ${s.frame}`}
      aria-label={label}
    >
      <div className={`relative flex items-center justify-between bg-slate-900 text-white ${s.statusBar}`}>
        <span className="font-semibold tabular-nums">9:41</span>
        <span aria-hidden="true" className={`absolute left-1/2 -translate-x-1/2 rounded-full bg-black ${s.island}`} />
        <span className="flex items-center gap-1" aria-hidden="true">
          <Signal className="h-3 w-3" />
          <Wifi className="h-3 w-3" />
          <BatteryFull className="h-3.5 w-3.5" />
        </span>
      </div>
      <div className="bg-theme-bg relative overflow-hidden" style={{ height: screenHeight }}>
        {children}
      </div>
      <div className={`bg-theme-bg flex justify-center ${s.homeBar}`} aria-hidden="true">
        <div className="h-1 w-28 rounded-full bg-gray-800/25 dark:bg-gray-400/30" />
      </div>
    </div>
  );
};

export default CrewPreviewPhone;
