import { useEffect, useState } from 'react';
import type { ProgramPhase, TrainingCategory, TrainingProgram, TrainingRequirement } from '../types/training';
import { trainingService, trainingProgramService } from '../services/api';

/** Option lists backing the training session linkage pickers. */
export interface TrainingLinkageData {
  categories: TrainingCategory[];
  requirements: TrainingRequirement[];
  programs: TrainingProgram[];
  phases: ProgramPhase[];
  /**
   * Whether the requirements request has settled. Until it has, a linked
   * requirement missing from `requirements` is not yet known to be gone.
   */
  requirementsLoaded?: boolean | undefined;
  /**
   * Which lists answered successfully: a failed one is empty, and must not be
   * taken to mean nothing is offered. `phasesFor` is the program whose phases
   * `phases` holds, or null when none has loaded.
   */
  loaded?: { categories: boolean; requirements: boolean; programs: boolean; phasesFor: string | null } | undefined;
  /** Whether every request has answered, including the phases of `programId`. */
  settled?: boolean | undefined;
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
  const [requirementsLoaded, setRequirementsLoaded] = useState(false);
  const [loaded, setLoaded] = useState({ categories: false, requirements: false, programs: false });
  const [pending, setPending] = useState(3);
  const [phasesFor, setPhasesFor] = useState<string | null>(null);
  const [phasesSettledFor, setPhasesSettledFor] = useState<string | null>(null);

  useEffect(() => {
    const answered = () => setPending((n) => n - 1);
    trainingService
      .getCategories()
      .then((data) => {
        setCategories(data);
        setLoaded((prev) => ({ ...prev, categories: true }));
      })
      .catch(() => {
        /* non-critical */
      })
      .finally(answered);
    trainingService
      .getRequirements({ active_only: true })
      .then((data) => {
        setRequirements(data);
        setLoaded((prev) => ({ ...prev, requirements: true }));
      })
      .catch(() => {
        /* non-critical */
      })
      .finally(() => {
        setRequirementsLoaded(true);
        answered();
      });
    trainingProgramService
      .getPrograms({ is_template: false })
      .then((data) => {
        setPrograms(data.filter((p) => p.active));
        setLoaded((prev) => ({ ...prev, programs: true }));
      })
      .catch(() => {
        /* non-critical */
      })
      .finally(answered);
  }, []);

  useEffect(() => {
    if (!programId) {
      setPhases([]);
      setPhasesFor(null);
      return;
    }
    let cancelled = false;
    trainingProgramService
      .getProgramPhases(programId)
      .then((data) => {
        if (cancelled) return;
        setPhases(data);
        setPhasesFor(programId);
      })
      .catch(() => {
        if (cancelled) return;
        setPhases([]);
        setPhasesFor(null);
      })
      .finally(() => {
        if (!cancelled) setPhasesSettledFor(programId);
      });
    return () => {
      cancelled = true;
    };
  }, [programId]);

  return {
    categories,
    requirements,
    programs,
    phases,
    requirementsLoaded,
    loaded: { ...loaded, phasesFor },
    settled: pending === 0 && (!programId || phasesSettledFor === programId),
  };
}
