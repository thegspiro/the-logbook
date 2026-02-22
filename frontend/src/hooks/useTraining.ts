import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { trainingService, trainingProgramService } from '../services/api';
import type {
  TrainingCategory,
  TrainingCourse,
  TrainingRecord,
  TrainingRequirement,
  TrainingProgram,
  ProgramEnrollment,
  MemberProgramProgress,
  UserTrainingStats,
  RequirementProgress,
} from '../types/training';

export const useTrainingCategories = () => {
  const [categories, setCategories] = useState<TrainingCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCategories = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoading(true);
      setError(null);
      const data = await trainingService.getCategories();
      if (!signal?.aborted) setCategories(data);
    } catch (err: unknown) {
      if (signal?.aborted) return;
      const errorMessage =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to load training categories';
      setError(errorMessage);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchCategories(controller.signal);
    return () => controller.abort();
  }, [fetchCategories]);

  return { categories, loading, error, refetch: fetchCategories };
};

export const useTrainingCourses = (activeOnly?: boolean) => {
  const [courses, setCourses] = useState<TrainingCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCourses = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoading(true);
      setError(null);
      const data = await trainingService.getCourses(activeOnly);
      if (!signal?.aborted) setCourses(data);
    } catch (err: unknown) {
      if (signal?.aborted) return;
      const errorMessage =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to load training courses';
      setError(errorMessage);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [activeOnly]);

  useEffect(() => {
    const controller = new AbortController();
    fetchCourses(controller.signal);
    return () => controller.abort();
  }, [fetchCourses]);

  return { courses, loading, error, refetch: fetchCourses };
};

export const useTrainingRecords = (params?: { user_id?: string; status?: string; start_date?: string; end_date?: string }) => {
  const [records, setRecords] = useState<TrainingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stabilize params reference to avoid unnecessary re-fetches
  const stableParams = useMemo(() => params, [params?.user_id, params?.status, params?.start_date, params?.end_date]);

  const fetchRecords = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoading(true);
      setError(null);
      const data = await trainingService.getRecords(stableParams);
      if (!signal?.aborted) setRecords(data);
    } catch (err: unknown) {
      if (signal?.aborted) return;
      const errorMessage =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to load training records';
      setError(errorMessage);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [stableParams]);

  useEffect(() => {
    const controller = new AbortController();
    fetchRecords(controller.signal);
    return () => controller.abort();
  }, [fetchRecords]);

  return { records, loading, error, refetch: fetchRecords };
};

export const useTrainingRequirements = () => {
  const [requirements, setRequirements] = useState<TrainingRequirement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRequirements = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoading(true);
      setError(null);
      const data = await trainingService.getRequirements();
      if (!signal?.aborted) setRequirements(data);
    } catch (err: unknown) {
      if (signal?.aborted) return;
      const errorMessage =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to load training requirements';
      setError(errorMessage);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchRequirements(controller.signal);
    return () => controller.abort();
  }, [fetchRequirements]);

  return { requirements, loading, error, refetch: fetchRequirements };
};

export const useTrainingPrograms = () => {
  const [programs, setPrograms] = useState<TrainingProgram[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPrograms = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoading(true);
      setError(null);
      const data = await trainingProgramService.getPrograms();
      if (!signal?.aborted) setPrograms(data);
    } catch (err: unknown) {
      if (signal?.aborted) return;
      const errorMessage =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to load training programs';
      setError(errorMessage);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchPrograms(controller.signal);
    return () => controller.abort();
  }, [fetchPrograms]);

  return { programs, loading, error, refetch: fetchPrograms };
};

export const useTrainingStats = (userId: string | undefined) => {
  const [stats, setStats] = useState<UserTrainingStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async (signal?: AbortSignal) => {
    if (!userId) { setLoading(false); return; }
    try {
      setLoading(true);
      setError(null);
      const data = await trainingService.getUserStats(userId);
      if (!signal?.aborted) setStats(data);
    } catch (err: unknown) {
      if (signal?.aborted) return;
      const errorMessage =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to load training stats';
      setError(errorMessage);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    const controller = new AbortController();
    fetchStats(controller.signal);
    return () => controller.abort();
  }, [fetchStats]);

  return { stats, loading, error, refetch: fetchStats };
};

export const useMemberEnrollments = (userId?: string) => {
  const [enrollments, setEnrollments] = useState<ProgramEnrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEnrollments = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoading(true);
      setError(null);
      const data = userId
        ? await trainingProgramService.getUserEnrollments(userId)
        : await trainingProgramService.getMyEnrollments();
      if (!signal?.aborted) setEnrollments(data);
    } catch (err: unknown) {
      if (signal?.aborted) return;
      const errorMessage =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to load enrollments';
      setError(errorMessage);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    const controller = new AbortController();
    fetchEnrollments(controller.signal);
    return () => controller.abort();
  }, [fetchEnrollments]);

  return { enrollments, loading, error, refetch: fetchEnrollments };
};

export const useEnrollmentProgress = (enrollmentId: string | undefined) => {
  const [progress, setProgress] = useState<MemberProgramProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProgress = useCallback(async (signal?: AbortSignal) => {
    if (!enrollmentId) { setLoading(false); return; }
    try {
      setLoading(true);
      setError(null);
      const data = await trainingProgramService.getEnrollmentProgress(enrollmentId);
      if (!signal?.aborted) setProgress(data);
    } catch (err: unknown) {
      if (signal?.aborted) return;
      const errorMessage =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to load enrollment progress';
      setError(errorMessage);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [enrollmentId]);

  useEffect(() => {
    const controller = new AbortController();
    fetchProgress(controller.signal);
    return () => controller.abort();
  }, [fetchProgress]);

  return { progress, loading, error, refetch: fetchProgress };
};

export const useExpiringCertifications = (daysAhead?: number) => {
  const [certifications, setCertifications] = useState<TrainingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCertifications = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoading(true);
      setError(null);
      const data = await trainingService.getExpiringCertifications(daysAhead);
      if (!signal?.aborted) setCertifications(data);
    } catch (err: unknown) {
      if (signal?.aborted) return;
      const errorMessage =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to load expiring certifications';
      setError(errorMessage);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [daysAhead]);

  useEffect(() => {
    const controller = new AbortController();
    fetchCertifications(controller.signal);
    return () => controller.abort();
  }, [fetchCertifications]);

  return { certifications, loading, error, refetch: fetchCertifications };
};

export const useRequirementProgress = (userId: string | undefined) => {
  const [progress, setProgress] = useState<RequirementProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProgress = useCallback(async (signal?: AbortSignal) => {
    if (!userId) { setLoading(false); return; }
    try {
      setLoading(true);
      setError(null);
      const data = await trainingService.getRequirementProgress(userId);
      if (!signal?.aborted) setProgress(data);
    } catch (err: unknown) {
      if (signal?.aborted) return;
      const errorMessage =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to load requirement progress';
      setError(errorMessage);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    const controller = new AbortController();
    fetchProgress(controller.signal);
    return () => controller.abort();
  }, [fetchProgress]);

  return { progress, loading, error, refetch: fetchProgress };
};
