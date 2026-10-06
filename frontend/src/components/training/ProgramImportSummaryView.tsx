import React from 'react';
import { enumLabel } from '@/utils/displayValue';
import type { ProgramImportSummary } from '../../types/training';

interface ProgramImportSummaryViewProps {
  summary: ProgramImportSummary;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * What a program file will create, shown in the confirmation before import.
 * New requirements are listed by name because they are the part that outlives
 * a regretted import: deleting the program leaves them in the department.
 */
export const ProgramImportSummaryView: React.FC<ProgramImportSummaryViewProps> = ({ summary }) => (
  <div className="space-y-3 text-left" data-testid="program-import-summary">
    <p>
      <span className="text-theme-text-primary font-semibold">{summary.program_name}</span> (
      {enumLabel(summary.structure_type)})
    </p>
    <ul className="list-disc space-y-1 pl-5">
      <li>{plural(summary.phase_count, 'phase', 'phases')}</li>
      {summary.program_requirement_count > 0 && (
        <li>{plural(summary.program_requirement_count, 'program-level requirement', 'program-level requirements')}</li>
      )}
      <li>{plural(summary.milestone_count, 'milestone', 'milestones')}</li>
    </ul>
    {summary.phases.length > 0 && (
      <ol className="space-y-1">
        {summary.phases.map((phase) => (
          <li key={`${phase.phase_number}-${phase.name}`}>
            Phase {phase.phase_number}: {phase.name} — {plural(phase.requirement_count, 'requirement', 'requirements')}
          </li>
        ))}
      </ol>
    )}
    <div>
      <p className="text-theme-text-primary font-medium">
        New requirements created: {summary.requirements_created.length}
      </p>
      {summary.requirements_created.length > 0 && (
        <ul className="list-disc pl-5">
          {summary.requirements_created.map((name, index) => (
            <li key={`${index}-${name}`}>{name}</li>
          ))}
        </ul>
      )}
    </div>
    {summary.requirements_reused.length > 0 && (
      <div>
        <p className="text-theme-text-primary font-medium">
          Existing requirements linked: {summary.requirements_reused.length}
        </p>
        <ul className="list-disc pl-5">
          {summary.requirements_reused.map((name, index) => (
            <li key={`${index}-${name}`}>{name}</li>
          ))}
        </ul>
      </div>
    )}
  </div>
);

export default ProgramImportSummaryView;
