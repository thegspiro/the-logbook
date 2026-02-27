export interface DailyCount {
  date: string;
  count: number;
}

export interface ModuleUsage {
  name: string;
  enabled: boolean;
  recordCount: number;
  lastActivity: string | null;
}

export interface PlatformAnalytics {
  totalUsers: number;
  activeUsers: number;
  inactiveUsers: number;
  newUsersLast30Days: number;
  adoptionRate: number;
  loginTrend: DailyCount[];

  modules: ModuleUsage[];

  totalEvents: number;
  eventsLast30Days: number;
  totalCheckIns: number;
  trainingHoursLast30Days: number;
  formsSubmittedLast30Days: number;

  errorsLast7Days: number;
  errorTrend: DailyCount[];
  topErrorTypes: Record<string, number>;

  totalDocuments: number;
  documentsLast30Days: number;

  generatedAt: string;
}
