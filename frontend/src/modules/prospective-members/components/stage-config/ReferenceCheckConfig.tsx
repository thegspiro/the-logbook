import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { ReferenceCheckConfig as ReferenceCheckConfigType, StageConfig } from '../../types';

interface ReferenceCheckConfigProps {
  config: StageConfig;
  setConfig: React.Dispatch<React.SetStateAction<StageConfig>>;
  errors: Record<string, string>;
}

const ReferenceCheckConfig: React.FC<ReferenceCheckConfigProps> = ({
  config,
  setConfig,
  errors,
}) => {
  const referenceCheckConfig = config as ReferenceCheckConfigType;

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="stage-ref-count" className="text-theme-text-muted mb-2 block text-sm">
          Required Number of References
        </label>
        <input
          id="stage-ref-count"
          type="number"
          min={1}
          max={10}
          value={referenceCheckConfig.required_count}
          onChange={(e) =>
            setConfig({ ...referenceCheckConfig, required_count: Number(e.target.value) })
          }
          className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring w-32 rounded-lg border px-4 py-2 focus:ring-2 focus:outline-hidden"
        />
        {errors.required_count && (
          <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.required_count}</p>
        )}
      </div>
      <div>
        <label className="text-theme-text-muted mb-2 block text-sm">Reference Types</label>
        {referenceCheckConfig.reference_types.map((refType, idx) => (
          <div key={idx} className="mb-2 flex items-center gap-2">
            <input
              type="text"
              value={refType}
              onChange={(e) => {
                const updated = [...referenceCheckConfig.reference_types];
                updated[idx] = e.target.value;
                setConfig({ ...referenceCheckConfig, reference_types: updated });
              }}
              placeholder="e.g., Professional, Personal, Supervisor"
              aria-label={`Reference type ${idx + 1}`}
              className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring flex-1 rounded-lg border px-4 py-2 focus:ring-2 focus:outline-hidden"
            />
            {referenceCheckConfig.reference_types.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  const updated = referenceCheckConfig.reference_types.filter((_, i) => i !== idx);
                  setConfig({ ...referenceCheckConfig, reference_types: updated });
                }}
                className="text-theme-text-muted transition-colors hover:text-red-700 dark:hover:text-red-400"
                aria-label={`Remove reference type ${idx + 1}`}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setConfig({
              ...referenceCheckConfig,
              reference_types: [...referenceCheckConfig.reference_types, ''],
            })
          }
          className="flex items-center gap-1 text-sm text-red-700 transition-colors hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
        >
          <Plus className="h-3 w-3" aria-hidden="true" /> Add reference type
        </button>
        {errors.reference_types && (
          <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.reference_types}</p>
        )}
      </div>
      <div>
        <label htmlFor="stage-ref-method" className="text-theme-text-muted mb-2 block text-sm">
          Collection Method
        </label>
        <select
          id="stage-ref-method"
          value={referenceCheckConfig.collect_method}
          onChange={(e) =>
            setConfig({
              ...referenceCheckConfig,
              collect_method: e.target.value as 'form' | 'manual',
            })
          }
          className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring w-full rounded-lg border px-4 py-2.5 focus:ring-2 focus:outline-hidden"
        >
          <option value="manual">Manual — coordinator enters reference info</option>
          <option value="form">Form — prospect submits reference contacts</option>
        </select>
      </div>
      <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={referenceCheckConfig.require_all_before_advance}
          onChange={(e) =>
            setConfig({ ...referenceCheckConfig, require_all_before_advance: e.target.checked })
          }
          className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
        />
        Require all references verified before advancing
      </label>
      <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={referenceCheckConfig.auto_advance ?? false}
          onChange={(e) => setConfig({ ...referenceCheckConfig, auto_advance: e.target.checked })}
          className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
        />
        Auto-advance when all references are verified
      </label>
      <p className="text-theme-text-muted text-xs ml-6">
        Automatically complete this step and advance the prospect when the required number of references are verified.
      </p>
    </div>
  );
};

export default ReferenceCheckConfig;
