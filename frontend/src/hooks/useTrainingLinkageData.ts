import { useEffect, useState } from 'react';
import type { ProgramPhase, TrainingCategory, TrainingProgram, TrainingRequirement } from '../types/training';
import { trainingService, trainingProgramService } from '../services/api';

/** Option lists backing the training session linkage pickers. */
export interface TrainingLinkageData {
  categories: TrainingCategory[];
  requirements: TrainingRequirement[];
  programs: TrainingProgram[];
  phases: ProgramPhase[];
}

/**
 * Loads the option lists for the requirement/program linkage pickers, shared
 * by the create wizard and the event-detail edit card.
 *
 * Phases belong to a program, so they reload whenever `programId` changes.
 * Every load is non-critical — a failed fetch leaves that picker empty rather
 * than failing the surrounding form.
 */
export function useTrainingLinkageData(programId?: string): TrainingLinkageData {
  const [categories, setCategories] = useState<TrainingCategory[]>([]);
  const [requirements, setRequirements] = useState<TrainingRequirement[]>([]);
  const [programs, setPrograms] = useState<TrainingProgram[]>([]);
  const [phases, setPhases] = useState<ProgramPhase[]>([]);

  useEffect(() => {
    trainingService
      .getCategories()
      .then(setCategories)
      .catch(() => {
        /* non-critical */
      });
    trainingService
      .getRequirements({ active_only: true })
      .then(setRequirements)
      .catch(() => {
        /* non-critical */
      });
    trainingProgramService
      .getPrograms({ is_template: false })
      .then((data) => setPrograms(data.filter((p) => p.active)))
      .catch(() => {
        /* non-critical */
      });
  }, []);

  useEffect(() => {
    if (!programId) {
      setPhases([]);
      return;
    }
    let cancelled = false;
    trainingProgramService
      .getProgramPhases(programId)
      .then((data) => {
        if (!cancelled) setPhases(data);
      })
      .catch(() => {
        if (!cancelled) setPhases([]);
      });
    return () => {
      cancelled = true;
    };
  }, [programId]);

  return { categories, requirements, programs, phases };
}
