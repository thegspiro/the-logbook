/**
 * Onboarding Store - Zustand State Management
 *
 * Centralizes all onboarding state with:
 * - Automatic localStorage persistence and recovery
 * - Type-safe state updates
 * - Error tracking and logging
 * - Server synchronization
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface OnboardingError {
  timestamp: string;
  step: string;
  action: string;
  errorMessage: string;
  errorDetails?: any;
  userContext?: string;
  recovered: boolean;
}

export interface OnboardingState {
  // Department Information
  departmentName: string;
  logoData: string | null;
  navigationLayout: 'top' | 'left';

  // Email Configuration
  emailPlatform: string | null;
  emailConfigured: boolean;

  // File Storage
  fileStoragePlatform: string | null;

  // Authentication
  authPlatform: string | null;

  // IT Team
  itTeamConfigured: boolean;
  itTeamMembers: Array<{
    id: string;
    name: string;
    email: string;
    phone: string;
    role: string;
  }>;
  backupEmail: string;
  backupPhone: string;
  secondaryAdminEmail: string;

  // Module Selection
  selectedModules: string[];
  moduleStatuses: Record<string, 'enabled' | 'skipped' | 'ignored'>;

  // Session
  sessionId: string | null;
  csrfToken: string | null;

  // Progress Tracking
  currentStep: number;
  completedSteps: string[];

  // Error Tracking
  errors: OnboardingError[];
  lastError: OnboardingError | null;

  // Auto-save flag
  autoSaveEnabled: boolean;
  lastSaved: string | null;
}

export interface OnboardingActions {
  // Department Actions
  setDepartmentName: (name: string) => void;
  setLogoData: (data: string | null) => void;
  setNavigationLayout: (layout: 'top' | 'left') => void;

  // Email Actions
  setEmailPlatform: (platform: string) => void;
  setEmailConfigured: (configured: boolean) => void;

  // File Storage Actions
  setFileStoragePlatform: (platform: string) => void;

  // Authentication Actions
  setAuthPlatform: (platform: string) => void;

  // IT Team Actions
  setITTeamConfigured: (configured: boolean) => void;
  setITTeamMembers: (members: Array<{ id: string; name: string; email: string; phone: string; role: string }>) => void;
  setBackupEmail: (email: string) => void;
  setBackupPhone: (phone: string) => void;
  setSecondaryAdminEmail: (email: string) => void;

  // Module Actions
  setSelectedModules: (modules: string[]) => void;
  toggleModule: (moduleId: string) => void;
  setModuleStatus: (moduleId: string, status: 'enabled' | 'skipped' | 'ignored') => void;
  setModuleStatuses: (statuses: Record<string, 'enabled' | 'skipped' | 'ignored'>) => void;

  // Session Actions
  setSessionId: (id: string) => void;
  setCsrfToken: (token: string) => void;

  // Progress Actions
  setCurrentStep: (step: number) => void;
  markStepCompleted: (stepName: string) => void;

  // Error Actions
  logError: (error: Omit<OnboardingError, 'timestamp' | 'recovered'>) => void;
  markErrorRecovered: (errorIndex: number) => void;
  clearErrors: () => void;

  // Auto-save Actions
  triggerAutoSave: () => void;

  // Reset Actions
  resetOnboarding: () => void;
  clearSensitiveData: () => void;
}

const initialState: OnboardingState = {
  departmentName: '',
  logoData: null,
  navigationLayout: 'top',
  emailPlatform: null,
  emailConfigured: false,
  fileStoragePlatform: null,
  authPlatform: null,
  itTeamConfigured: false,
  itTeamMembers: [{ id: '1', name: '', email: '', phone: '', role: 'Primary IT Contact' }],
  backupEmail: '',
  backupPhone: '',
  secondaryAdminEmail: '',
  selectedModules: [],
  moduleStatuses: {},
  sessionId: null,
  csrfToken: null,
  currentStep: 1,
  completedSteps: [],
  errors: [],
  lastError: null,
  autoSaveEnabled: true,
  lastSaved: null,
};

/**
 * Structured error logging to console
 * SECURITY: Only log non-sensitive fields. Never log userContext (may contain
 * emails, usernames) or errorDetails (may contain API response bodies).
 */
const logErrorToConsole = (error: OnboardingError) => {
  if (import.meta.env.DEV) {
    // Development: show full details for debugging
    console.group(`ONBOARDING ERROR - ${error.step}`);
    console.error('Action:', error.action);
    console.error('Message:', error.errorMessage);
    if (error.errorDetails) console.error('Details:', error.errorDetails);
    if (error.userContext) console.info('User Context:', error.userContext);
    console.groupEnd();
  } else {
    // Production: log only non-sensitive fields
    console.error(`Onboarding error at step "${error.step}": ${error.errorMessage}`);
  }
};

/**
 * Onboarding Store with localStorage persistence
 */
export const useOnboardingStore = create<OnboardingState & OnboardingActions>()(
  persist(
    (set, get) => ({
      ...initialState,

      // Department Actions
      setDepartmentName: (name) => {
        set({ departmentName: name });
        get().triggerAutoSave();
      },

      setLogoData: (data) => {
        set({ logoData: data });
        get().triggerAutoSave();
      },

      setNavigationLayout: (layout) => {
        set({ navigationLayout: layout });
        get().triggerAutoSave();
      },

      // Email Actions
      setEmailPlatform: (platform) => {
        set({ emailPlatform: platform });
        get().triggerAutoSave();
      },

      setEmailConfigured: (configured) => {
        set({ emailConfigured: configured });
        get().triggerAutoSave();
      },

      // File Storage Actions
      setFileStoragePlatform: (platform) => {
        set({ fileStoragePlatform: platform });
        get().triggerAutoSave();
      },

      // Authentication Actions
      setAuthPlatform: (platform) => {
        set({ authPlatform: platform });
        get().triggerAutoSave();
      },

      // IT Team Actions
      setITTeamConfigured: (configured) => {
        set({ itTeamConfigured: configured });
        get().triggerAutoSave();
      },

      setITTeamMembers: (members) => {
        set({ itTeamMembers: members });
        get().triggerAutoSave();
      },

      setBackupEmail: (email) => {
        set({ backupEmail: email });
        get().triggerAutoSave();
      },

      setBackupPhone: (phone) => {
        set({ backupPhone: phone });
        get().triggerAutoSave();
      },

      setSecondaryAdminEmail: (email) => {
        set({ secondaryAdminEmail: email });
        get().triggerAutoSave();
      },

      // Module Actions
      setSelectedModules: (modules) => {
        set({ selectedModules: modules });
        get().triggerAutoSave();
      },

      toggleModule: (moduleId) => {
        const { selectedModules } = get();
        const newModules = selectedModules.includes(moduleId)
          ? selectedModules.filter((id) => id !== moduleId)
          : [...selectedModules, moduleId];

        set({ selectedModules: newModules });
        get().triggerAutoSave();
      },

      setModuleStatus: (moduleId, status) => {
        const { moduleStatuses, selectedModules } = get();
        const newStatuses = { ...moduleStatuses, [moduleId]: status };

        // Update selectedModules based on status
        let newSelectedModules = [...selectedModules];
        if (status === 'enabled' && !newSelectedModules.includes(moduleId)) {
          newSelectedModules.push(moduleId);
        } else if (status !== 'enabled') {
          newSelectedModules = newSelectedModules.filter(id => id !== moduleId);
        }

        set({ moduleStatuses: newStatuses, selectedModules: newSelectedModules });
        get().triggerAutoSave();
      },

      setModuleStatuses: (statuses) => {
        // Update selectedModules based on all statuses
        const enabledModules = Object.entries(statuses)
          .filter(([_, status]) => status === 'enabled')
          .map(([id]) => id);

        set({ moduleStatuses: statuses, selectedModules: enabledModules });
        get().triggerAutoSave();
      },

      // Session Actions
      setSessionId: (id) => {
        set({ sessionId: id });
      },

      setCsrfToken: (token) => {
        set({ csrfToken: token });
      },

      // Progress Actions
      setCurrentStep: (step) => {
        set({ currentStep: step });
        get().triggerAutoSave();
      },

      markStepCompleted: (stepName) => {
        const { completedSteps } = get();
        if (!completedSteps.includes(stepName)) {
          set({ completedSteps: [...completedSteps, stepName] });
          get().triggerAutoSave();
        }
      },

      // Error Actions
      logError: (error) => {
        const newError: OnboardingError = {
          ...error,
          timestamp: new Date().toISOString(),
          recovered: false,
        };

        // Log to console
        logErrorToConsole(newError);

        // Add to store
        set((state) => ({
          errors: [...state.errors, newError],
          lastError: newError,
        }));
      },

      markErrorRecovered: (errorIndex) => {
        set((state) => {
          const updatedErrors = [...state.errors];
          if (updatedErrors[errorIndex]) {
            updatedErrors[errorIndex] = {
              ...updatedErrors[errorIndex],
              recovered: true,
            };
          }
          return { errors: updatedErrors };
        });
      },

      clearErrors: () => {
        set({ errors: [], lastError: null });
      },

      // Auto-save Action
      triggerAutoSave: () => {
        if (get().autoSaveEnabled) {
          set({ lastSaved: new Date().toISOString() });
          console.info('💾 Onboarding progress auto-saved to localStorage');
        }
      },

      // Reset Actions
      resetOnboarding: () => {
        set(initialState);
        console.info('🔄 Onboarding state reset');
      },

      clearSensitiveData: () => {
        set({
          csrfToken: null,
          sessionId: null,
        });
        console.info('🔒 Sensitive onboarding data cleared');
      },
    }),
    {
      name: 'onboarding-storage', // localStorage key
      storage: createJSONStorage(() => localStorage),
      // Only persist non-sensitive data
      partialize: (state) => ({
        departmentName: state.departmentName,
        logoData: state.logoData,
        navigationLayout: state.navigationLayout,
        emailPlatform: state.emailPlatform,
        emailConfigured: state.emailConfigured,
        fileStoragePlatform: state.fileStoragePlatform,
        authPlatform: state.authPlatform,
        itTeamConfigured: state.itTeamConfigured,
        itTeamMembers: state.itTeamMembers,
        backupEmail: state.backupEmail,
        backupPhone: state.backupPhone,
        secondaryAdminEmail: state.secondaryAdminEmail,
        selectedModules: state.selectedModules,
        moduleStatuses: state.moduleStatuses,
        currentStep: state.currentStep,
        completedSteps: state.completedSteps,
        lastSaved: state.lastSaved,
        // Exclude sensitive data from persistence
        // sessionId, csrfToken, errors are NOT persisted
      }),
    }
  )
);

/**
 * Sync Zustand store with sessionStorage (for backward compatibility)
 * This ensures existing code using sessionStorage continues to work
 */
export const syncWithSessionStorage = () => {
  const store = useOnboardingStore.getState();

  // Read from sessionStorage if Zustand is empty (initial load)
  if (!store.departmentName) {
    const sessionDepartment = sessionStorage.getItem('departmentName');
    const sessionLogo = sessionStorage.getItem('logoData');
    const sessionNav = sessionStorage.getItem('navigationLayout');
    const sessionEmail = sessionStorage.getItem('emailPlatform');
    const sessionStoragePlatform = sessionStorage.getItem('fileStoragePlatform');
    const sessionAuth = sessionStorage.getItem('authPlatform');

    if (sessionDepartment) store.setDepartmentName(sessionDepartment);
    if (sessionLogo) store.setLogoData(sessionLogo);
    if (sessionNav) store.setNavigationLayout(sessionNav as 'top' | 'left');
    if (sessionEmail) store.setEmailPlatform(sessionEmail);
    if (sessionStoragePlatform) store.setFileStoragePlatform(sessionStoragePlatform);
    if (sessionAuth) store.setAuthPlatform(sessionAuth);
  }
};
