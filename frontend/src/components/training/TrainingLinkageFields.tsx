import React, { useId, useMemo } from 'react';
import { AlertCircle } from 'lucide-react';
import type { TrainingCourse, TrainingRequirement } from '../../types/training';
import type { TrainingLinkageData } from '../../hooks/useTrainingLinkageData';

/** The four linkage ids a training session can carry. */
export interface TrainingLinkageValue {
  category_id?: string | undefined;
  program_id?: string | undefined;
  phase_id?: string | undefined;
  requirement_id?: string | undefined;
}

const requirementLabel = (req: TrainingRequirement): string =>
  `${req.name}${req.registry_code ? ` (${req.registry_code})` : ''}`;

interface TrainingLinkageFieldsProps {
  data: TrainingLinkageData;
  value: TrainingLinkageValue;
  /** Merge the patch into the owning form's state. A program change patches
   *  `phase_id: undefined` in the same call so a stale phase never survives. */
  onChange: (patch: Partial<TrainingLinkageValue>) => void;
  /** The course this session teaches, when known — drives the suggestion chips. */
  selectedCourse?: TrainingCourse | undefined;
}

/**
 * The category / requirement / program / phase pickers for a training session,
 * with one-tap suggestion chips and a plain-language preview of what the
 * chosen links will do at check-in. Shared by the create wizard and the
 * session edit card so both flows behave identically.
 */
export const TrainingLinkageFields: React.FC<TrainingLinkageFieldsProps> = ({
  data,
  value,
  onChange,
  selectedCourse,
}) => {
  const { categories, requirements, programs, phases } = data;
  // Both the create wizard and the edit card can mount this, so ids are
  // per-instance rather than hard-coded.
  const fieldId = useId();

  // Requirements this session likely satisfies, so the officer can link one in
  // a single tap instead of hunting through the full list: requirements that
  // explicitly list the selected course, plus hour/category requirements that
  // share a category with the course or the chosen session category.
  const suggestedRequirements = useMemo(() => {
    if (requirements.length === 0) return [];
    const courseCategoryIds = new Set(selectedCourse?.category_ids ?? []);
    return requirements.filter((req) => {
      if (selectedCourse && req.required_courses?.includes(selectedCourse.id)) return true;
      if (courseCategoryIds.size > 0 && req.category_ids?.some((id) => courseCategoryIds.has(id))) return true;
      if (value.category_id && req.category_ids?.includes(value.category_id)) return true;
      return false;
    });
  }, [requirements, selectedCourse, value.category_id]);

  const suggestedRequirementIds = useMemo(
    () => new Set(suggestedRequirements.map((r) => r.id)),
    [suggestedRequirements]
  );

  const categoryName = categories.find((c) => c.id === value.category_id)?.name;
  const programName = programs.find((p) => p.id === value.program_id)?.name;
  const requirementName = requirements.find((r) => r.id === value.requirement_id)?.name;

  // Plain-language preview of what the chosen links will do at check-in
  const linkageSummary = ((): string | null => {
    if (value.program_id && value.requirement_id) {
      return `Attendance will advance "${requirementName}" for members enrolled in ${programName}.`;
    }
    if (value.program_id && value.category_id) {
      return `Attendance hours will advance ${programName}'s hour-based requirements in the "${categoryName}" category for enrolled members.`;
    }
    if (value.requirement_id) {
      return `Linked to "${requirementName}". Also select a training program to automatically advance enrolled members' pipeline progress.`;
    }
    if (value.category_id) {
      return `Attendees' training records will be tagged "${categoryName}" and count toward department requirements linked to that category.`;
    }
    return null;
  })();

  return (
    <div>
      {suggestedRequirements.length > 0 && !value.requirement_id && (
        <div className="mb-4 rounded-lg border border-green-500/30 bg-green-500/10 p-3">
          <p className="text-sm font-semibold text-green-700">
            {selectedCourse ? 'This course counts toward:' : 'Requirements in this category:'}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {suggestedRequirements.map((req) => (
              <button
                key={req.id}
                type="button"
                onClick={() => onChange({ requirement_id: req.id })}
                className="text-theme-text-secondary border-theme-surface-border hover:bg-theme-surface-secondary focus:ring-theme-focus-ring bg-theme-surface rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus:ring-2 focus:outline-hidden"
              >
                + {requirementLabel(req)}
              </button>
            ))}
          </div>
          <p className="text-theme-text-muted mt-2 text-xs">Tap a requirement to link it to this session.</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label htmlFor={`${fieldId}-category`} className="text-theme-text-primary mb-2 block text-sm font-semibold">
            Training Category
          </label>
          <select
            id={`${fieldId}-category`}
            value={value.category_id || ''}
            onChange={(e) => onChange({ category_id: e.target.value || undefined })}
            className="form-input py-3"
          >
            <option value="">No category</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
                {cat.code ? ` (${cat.code})` : ''}
              </option>
            ))}
          </select>
          <p className="text-theme-text-muted mt-1 text-xs">Hours count toward requirements linked to this category</p>
        </div>
        <div>
          <label
            htmlFor={`${fieldId}-requirement`}
            className="text-theme-text-primary mb-2 block text-sm font-semibold"
          >
            Requirement
          </label>
          <select
            id={`${fieldId}-requirement`}
            value={value.requirement_id || ''}
            onChange={(e) => onChange({ requirement_id: e.target.value || undefined })}
            className="form-input py-3"
          >
            <option value="">No specific requirement</option>
            {suggestedRequirements.length > 0 ? (
              <>
                <optgroup label="Suggested">
                  {suggestedRequirements.map((req) => (
                    <option key={req.id} value={req.id}>
                      {requirementLabel(req)}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="All requirements">
                  {requirements
                    .filter((req) => !suggestedRequirementIds.has(req.id))
                    .map((req) => (
                      <option key={req.id} value={req.id}>
                        {requirementLabel(req)}
                      </option>
                    ))}
                </optgroup>
              </>
            ) : (
              requirements.map((req) => (
                <option key={req.id} value={req.id}>
                  {requirementLabel(req)}
                </option>
              ))
            )}
          </select>
          <p className="text-theme-text-muted mt-1 text-xs">Attendance credits this requirement directly</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label htmlFor={`${fieldId}-program`} className="text-theme-text-primary mb-2 block text-sm font-semibold">
            Training Program
          </label>
          <select
            id={`${fieldId}-program`}
            value={value.program_id || ''}
            onChange={(e) => onChange({ program_id: e.target.value || undefined, phase_id: undefined })}
            className="form-input py-3"
          >
            <option value="">No program</option>
            {programs.map((program) => (
              <option key={program.id} value={program.id}>
                {program.name}
                {program.code ? ` (${program.code})` : ''}
              </option>
            ))}
          </select>
          <p className="text-theme-text-muted mt-1 text-xs">
            Pipeline this session advances (e.g., Recruit School, Driver Training)
          </p>
        </div>
        {value.program_id && phases.length > 0 && (
          <div>
            <label htmlFor={`${fieldId}-phase`} className="text-theme-text-primary mb-2 block text-sm font-semibold">
              Program Phase
            </label>
            <select
              id={`${fieldId}-phase`}
              value={value.phase_id || ''}
              onChange={(e) => onChange({ phase_id: e.target.value || undefined })}
              className="form-input py-3"
            >
              <option value="">Any phase</option>
              {phases.map((phase) => (
                <option key={phase.id} value={phase.id}>
                  Phase {phase.phase_number}: {phase.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {linkageSummary && (
        <div className="mt-4 flex items-start gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
          <p className="text-theme-text-secondary text-sm">{linkageSummary}</p>
        </div>
      )}
    </div>
  );
};
