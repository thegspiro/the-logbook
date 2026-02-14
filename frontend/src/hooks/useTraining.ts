import { useState, useEffect } from 'react';
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

  const fetchCategories = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await trainingService.getCategories();
      setCategories(data);
    } catch (err: unknown) {
      const errorMessage =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to load training categories';
      console.error('Error fetching training categories:', err);
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCategories(); }, []);
  return { categories, loading, error, refetch: fetchCategories };
};

export const useTrainingCourses = (activeOnly?: boolean) => {
  const [courses, setCourses] = useState<TrainingCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCourses = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await trainingService.getCourses(activeOnly);
      setCourses(data);
    } catch (err: unknown) {
      const errorMessage =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to load training courses';
      console.error('Error fetching training courses:', err);
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCourses(); }, [activeOnly]);
  return { courses, loading, error, refetch: fetchCourses };
};

export const useTrainingRecords = (params?: { user_id?: string; status?: string; start_date?: string; end_date?: string }) => {
  const [records, setRecords] = useState<TrainingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRecords = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await trainingService.getRecords(params);
      setRecords(data);
    } catch (err: unknown) {
      const errorMessage =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to load training records';
      console.error('Error fetching training records:', err);
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRecords(); }, [JSON.stringify(params)]);
  return { records, loading, error, refetch: fetchRecords };
};

export const useTrainingRequirements = () => {
  const [requirements, setRequirements] = useState<TrainingRequirement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRequirements = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await trainingService.getRequirements();
      setRequirements(data);
    } catch (err: unknown) {
      const errorMessage =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to load training requirements';
      console.error('Error fetching training requirements:', err);
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRequirements(); }, []);
  return { requirements, loading, error, refetch: fetchRequirements };
};

export const useTrainingPrograms = () => {
  const [programs, setPrograms] = useState<TrainingProgram[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPrograms = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await trainingProgramService.getPrograms();
      setPrograms(data);
    } catch (err: unknown) {
      const errorMessage =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to load training programs';
      console.error('Error fetching training programs:', err);
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchPrograms(); }, []);
  return { programs, loading, error, refetch: fetchPrograms };
};

export const useTrainingStats = (userId: string | undefined) => {
  const [stats, setStats] = useState<UserTrainingStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = async () => {
    if (!userId) { setLoading(false); return; }
    try {
      setLoading(true);
      setError(null);
      const data = await trainingService.getStatistics(userId);
      setStats(data);
    } catch (err: unknown) {
      const errorMessage =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to load training stats';
      console.error('Error fetching training stats:', err);
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStats(); }, [userId]);
  return { stats, loading, error, refetch: fetchStats };
};

export const useMemberEnrollments = (userId?: string) => {
  const [enrollments, setEnrollments] = useState<ProgramEnrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEnrollments = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = userId
        ? await trainingProgramService.getUserEnrollments(userId)
        : await trainingProgramService.getMyEnrollments();
      setEnrollments(data);
    } catch (err: unknown) {
      const errorMessage =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to load enrollments';
      console.error('Error fetching enrollments:', err);
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchEnrollments(); }, [userId]);
  return { enrollments, loading, error, refetch: fetchEnrollments };
};

export const useEnrollmentProgress = (enrollmentId: string | undefined) => {
  const [progress, setProgress] = useState<MemberProgramProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProgress = async () => {
    if (!enrollmentId) { setLoading(false); return; }
    try {
      setLoading(true);
      setError(null);
      const data = await trainingProgramService.getEnrollmentProgress(enrollmentId);
      setProgress(data);
    } catch (err: unknown) {
      const errorMessage =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to load enrollment progress';
      console.error('Error fetching enrollment progress:', err);
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchProgress(); }, [enrollmentId]);
  return { progress, loading, error, refetch: fetchProgress };
};

export const useExpiringCertifications = (daysAhead?: number) => {
  const [certifications, setCertifications] = useState<TrainingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCertifications = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await trainingService.getExpiringCertifications(daysAhead);
      setCertifications(data);
    } catch (err: unknown) {
      const errorMessage =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to load expiring certifications';
      console.error('Error fetching expiring certifications:', err);
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCertifications(); }, [daysAhead]);
  return { certifications, loading, error, refetch: fetchCertifications };
};

export const useRequirementProgress = (userId: string | undefined) => {
  const [progress, setProgress] = useState<RequirementProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProgress = async () => {
    if (!userId) { setLoading(false); return; }
    try {
      setLoading(true);
      setError(null);
      const data = await trainingService.getProgress(userId);
      setProgress(data);
    } catch (err: unknown) {
      const errorMessage =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to load requirement progress';
      console.error('Error fetching requirement progress:', err);
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchProgress(); }, [userId]);
  return { progress, loading, error, refetch: fetchProgress };
};
