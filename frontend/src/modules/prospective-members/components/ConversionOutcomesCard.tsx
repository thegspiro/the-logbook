/**
 * What applicants become when this pipeline converts them to members.
 *
 * One outcome per applicant track: operational applicants and administrative
 * applicants (the applicant's target membership type). Each is a member class
 * and a starting status, so a department can, say, make administrative
 * applicants regular administrative members while operational applicants start
 * as probationary operational members.
 *
 * Automatic conversion -- an election vote or final approval on a pipeline that
 * converts on approval -- applies these outcomes; the Convert dialog pre-fills
 * from them and lets a coordinator change them for one applicant.
 */

import React, { useEffect, useState } from 'react';
import { Loader2, Save, UserCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { MemberClass } from '../../../constants/enums';
import { getErrorMessage } from '../../../utils/errorHandling';
import { pipelineService } from '../services/api';
import type { ConversionStatus, Pipeline, PipelineConversionConfig } from '../types';

const TRACKS: { key: keyof PipelineConversionConfig; label: string }[] = [
  { key: 'operational', label: 'Operational applicants' },
  { key: 'administrative', label: 'Administrative applicants' },
];

const CLASS_LABELS: Record<MemberClass, string> = {
  [MemberClass.OPERATIONAL]: 'Operational',
  [MemberClass.ADMINISTRATIVE]: 'Administrative',
  [MemberClass.SOCIAL]: 'Social',
};

const STATUS_LABELS: Record<ConversionStatus, string> = {
  probationary: 'Probationary',
  regular: 'Regular',
};

interface Props {
  pipeline: Pipeline;
  onSaved: (pipeline: Pipeline) => void;
}

export const ConversionOutcomesCard: React.FC<Props> = ({ pipeline, onSaved }) => {
  const [config, setConfig] = useState<PipelineConversionConfig>(pipeline.conversion_config);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setConfig(pipeline.conversion_config);
  }, [pipeline]);

  const setOutcome = (
    track: keyof PipelineConversionConfig,
    patch: Partial<PipelineConversionConfig[keyof PipelineConversionConfig]>
  ) => {
    setConfig((current) => ({ ...current, [track]: { ...current[track], ...patch } }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const updated = await pipelineService.updatePipeline(pipeline.id, { conversion_config: config });
      onSaved(updated);
      toast.success('Conversion settings saved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save conversion settings'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="card bg-theme-input-bg p-5">
      <div className="mb-3 flex items-center gap-2">
        <UserCheck className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
        <h3 className="text-theme-text-primary text-sm font-semibold">When an Applicant Becomes a Member</h3>
      </div>
      <p className="text-theme-text-muted mb-4 text-xs">
        The class and starting status each kind of applicant receives when this pipeline converts them, including
        automatically after an election or final approval. The Convert dialog starts from these and can change them for
        one applicant.
      </p>

      <div className="space-y-4">
        {TRACKS.map(({ key, label }) => (
          <fieldset key={key} className="form-grid-2">
            <legend className="text-theme-text-secondary mb-2 text-sm font-medium">{label}</legend>
            <div>
              <label htmlFor={`conversion-${key}-class`} className="text-theme-text-muted mb-1 block text-xs">
                Member class
              </label>
              <select
                id={`conversion-${key}-class`}
                value={config[key].member_class}
                onChange={(e) => setOutcome(key, { member_class: e.target.value as MemberClass })}
                className="form-input"
              >
                {Object.values(MemberClass).map((value) => (
                  <option key={value} value={value}>
                    {CLASS_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`conversion-${key}-status`} className="text-theme-text-muted mb-1 block text-xs">
                Starting status
              </label>
              <select
                id={`conversion-${key}-status`}
                value={config[key].member_status}
                onChange={(e) => setOutcome(key, { member_status: e.target.value as ConversionStatus })}
                className="form-input"
              >
                {(Object.keys(STATUS_LABELS) as ConversionStatus[]).map((value) => (
                  <option key={value} value={value}>
                    {STATUS_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
          </fieldset>
        ))}
      </div>

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={() => {
            void handleSave();
          }}
          disabled={isSaving}
          className="btn-primary flex items-center gap-2 px-4 py-2 text-sm"
        >
          {isSaving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Save Conversion Settings
        </button>
      </div>
    </div>
  );
};
