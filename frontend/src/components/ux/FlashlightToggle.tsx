import React from 'react';
import { Flashlight, FlashlightOff } from 'lucide-react';

interface FlashlightToggleProps {
  on: boolean;
  onToggle: () => void | Promise<void>;
}

/**
 * Flashlight (camera torch) toggle rendered as an overlay in the top-right of a
 * scanner preview. Only render it when the active camera reports flashlight
 * support. "Flashlight" is the US term for the device's torch.
 */
export const FlashlightToggle: React.FC<FlashlightToggleProps> = ({ on, onToggle }) => {
  return (
    <button
      type="button"
      onClick={() => { void onToggle(); }}
      aria-pressed={on}
      aria-label={on ? 'Turn flashlight off' : 'Turn flashlight on'}
      className={`absolute top-2 right-2 z-10 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full shadow-lg transition-colors ${
        on ? 'bg-amber-400 text-amber-950' : 'bg-black/50 text-white hover:bg-black/70'
      }`}
    >
      {on ? <FlashlightOff className="h-5 w-5" /> : <Flashlight className="h-5 w-5" />}
    </button>
  );
};
