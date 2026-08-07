/**
 * useCourseLibrary Hook
 *
 * Loads the organization's course catalog for the pickers that link a
 * requirement to specific courses.
 *
 * Archived courses are included on purpose: a requirement created last year may
 * point at a course that has since been archived, and dropping it from the list
 * would render that link as a bare UUID with no way to identify or remove it.
 * The picker marks archived entries and keeps them out of the default browse
 * list instead.
 *
 * No module-level cache here — the global axios instance already serves GETs
 * from its stale-while-revalidate cache, and a process-lifetime cache would
 * outlive a logout.
 */
import { useCallback, useEffect, useState } from 'react';
import { trainingService } from '../services/api';
import { getErrorMessage } from '../utils/errorHandling';
import type { TrainingCourse } from '../types/training';

interface UseCourseLibraryResult {
  courses: TrainingCourse[];
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
}

export function useCourseLibrary(): UseCourseLibraryResult {
  const [courses, setCourses] = useState<TrainingCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await trainingService.getCourses(false);
      setCourses(data);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not load the course library'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { courses, loading, error, reload: load };
}

export default useCourseLibrary;
