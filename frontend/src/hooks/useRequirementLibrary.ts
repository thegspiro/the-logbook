/**
 * useRequirementLibrary Hook
 *
 * Loads the department's existing training requirements so a program phase can
 * link one in rather than re-creating it. Without this, an officer building a
 * recruit school has to type "CPR/BLS Certification" a second time, producing a
 * duplicate requirement that tracks separately from the department's own.
 *
 * Mirrors useCourseLibrary: no module-level cache, since the global axios
 * instance already serves GETs from its stale-while-revalidate cache.
 */
import { useCallback, useEffect, useState } from 'react';
import { trainingProgramService } from '../services/api';
import { getErrorMessage } from '../utils/errorHandling';
import type { TrainingRequirementEnhanced } from '../types/training';

interface UseRequirementLibraryResult {
  requirements: TrainingRequirementEnhanced[];
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
}

export function useRequirementLibrary(): UseRequirementLibraryResult {
  const [requirements, setRequirements] = useState<TrainingRequirementEnhanced[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await trainingProgramService.getRequirementsEnhanced();
      setRequirements(data);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not load the requirement library'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { requirements, loading, error, reload: load };
}

export default useRequirementLibrary;
