import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useOnboardingStore } from './onboardingStore';

function getState() {
  return useOnboardingStore.getState();
}

const initialState = {
  departmentName: '',
  logoData: null,
  navigationLayout: 'top' as const,
  emailPlatform: null,
  emailConfigured: false,
  fileStoragePlatform: null,
  authPlatform: null,
  systemOwnerFirstName: '',
  systemOwnerLastName: '',
  systemOwnerEmail: '',
  itTeamConfigured: false,
  itTeamMembers: [{ id: '1', name: '', email: '', phone: '', role: 'Primary IT Contact' }],
  backupEmail: '',
  backupPhone: '',
  secondaryAdminEmail: '',
  positionsConfig: null,
  selectedModules: [],
  moduleStatuses: {},
  modulePermissionConfigs: {},
  sessionId: null,
  csrfToken: null,
  currentStep: 1,
  completedSteps: [],
  errors: [],
  lastError: null,
  autoSaveEnabled: true,
  lastSaved: null,
};

describe('onboardingStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    useOnboardingStore.setState(initialState);
  });

  // ---- Department Configuration ----

  describe('department configuration', () => {
    it('setDepartmentName updates state', () => {
      getState().setDepartmentName('Springfield Fire Department');
      expect(getState().departmentName).toBe('Springfield Fire Department');
    });

    it('setLogoData updates state with data', () => {
      const logoBase64 = 'data:image/png;base64,abc123';
      getState().setLogoData(logoBase64);
      expect(getState().logoData).toBe(logoBase64);
    });

    it('setLogoData clears data with null', () => {
      getState().setLogoData('data:image/png;base64,abc123');
      getState().setLogoData(null);
      expect(getState().logoData).toBeNull();
    });

    it('setNavigationLayout updates state to left', () => {
      getState().setNavigationLayout('left');
      expect(getState().navigationLayout).toBe('left');
    });

    it('setNavigationLayout updates state to top', () => {
      getState().setNavigationLayout('left');
      getState().setNavigationLayout('top');
      expect(getState().navigationLayout).toBe('top');
    });

    it('setNavigationLayout also writes to localStorage directly', () => {
      getState().setNavigationLayout('left');
      expect(localStorage.getItem('navigationLayout')).toBe('left');
    });
  });

  // ---- System Owner Info ----

  describe('system owner info', () => {
    it('setSystemOwnerInfo sets firstName, lastName, email', () => {
      getState().setSystemOwnerInfo({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane.doe@example.com',
      });

      const state = getState();
      expect(state.systemOwnerFirstName).toBe('Jane');
      expect(state.systemOwnerLastName).toBe('Doe');
      expect(state.systemOwnerEmail).toBe('jane.doe@example.com');
    });

    it('setSystemOwnerInfo overwrites previous values', () => {
      getState().setSystemOwnerInfo({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
      });
      getState().setSystemOwnerInfo({
        firstName: 'John',
        lastName: 'Smith',
        email: 'john@example.com',
      });

      const state = getState();
      expect(state.systemOwnerFirstName).toBe('John');
      expect(state.systemOwnerLastName).toBe('Smith');
      expect(state.systemOwnerEmail).toBe('john@example.com');
    });
  });

  // ---- Module Management ----

  describe('module management', () => {
    it('setSelectedModules sets module list', () => {
      getState().setSelectedModules(['training', 'scheduling', 'reports']);
      expect(getState().selectedModules).toEqual(['training', 'scheduling', 'reports']);
    });

    it('setSelectedModules replaces existing list', () => {
      getState().setSelectedModules(['training', 'scheduling']);
      getState().setSelectedModules(['reports']);
      expect(getState().selectedModules).toEqual(['reports']);
    });

    it('toggleModule adds a module not in list', () => {
      getState().setSelectedModules([]);
      getState().toggleModule('training');
      expect(getState().selectedModules).toEqual(['training']);
    });

    it('toggleModule removes a module already in list', () => {
      getState().setSelectedModules(['training', 'scheduling']);
      getState().toggleModule('training');
      expect(getState().selectedModules).toEqual(['scheduling']);
    });

    it('toggleModule adds then removes on consecutive calls', () => {
      getState().toggleModule('training');
      expect(getState().selectedModules).toContain('training');

      getState().toggleModule('training');
      expect(getState().selectedModules).not.toContain('training');
    });

    it('setModuleStatus sets enabled and adds to selectedModules', () => {
      getState().setModuleStatus('training', 'enabled');

      expect(getState().moduleStatuses['training']).toBe('enabled');
      expect(getState().selectedModules).toContain('training');
    });

    it('setModuleStatus sets skipped and removes from selectedModules', () => {
      getState().setSelectedModules(['training', 'scheduling']);
      getState().setModuleStatus('training', 'skipped');

      expect(getState().moduleStatuses['training']).toBe('skipped');
      expect(getState().selectedModules).not.toContain('training');
      expect(getState().selectedModules).toContain('scheduling');
    });

    it('setModuleStatus sets ignored and removes from selectedModules', () => {
      getState().setSelectedModules(['training']);
      getState().setModuleStatus('training', 'ignored');

      expect(getState().moduleStatuses['training']).toBe('ignored');
      expect(getState().selectedModules).not.toContain('training');
    });

    it('setModuleStatus enabled does not duplicate in selectedModules', () => {
      getState().setSelectedModules(['training']);
      getState().setModuleStatus('training', 'enabled');

      const trainingCount = getState().selectedModules.filter(
        (m) => m === 'training'
      ).length;
      expect(trainingCount).toBe(1);
    });

    it('setModuleStatuses sets bulk statuses and syncs selectedModules', () => {
      getState().setModuleStatuses({
        training: 'enabled',
        scheduling: 'enabled',
        reports: 'skipped',
      });

      expect(getState().moduleStatuses).toEqual({
        training: 'enabled',
        scheduling: 'enabled',
        reports: 'skipped',
      });
      expect(getState().selectedModules).toEqual(
        expect.arrayContaining(['training', 'scheduling'])
      );
      expect(getState().selectedModules).not.toContain('reports');
    });

    it('setModulePermissionConfig sets positions for a module', () => {
      getState().setModulePermissionConfig('training', ['chief', 'captain']);
      expect(getState().modulePermissionConfigs['training']).toEqual([
        'chief',
        'captain',
      ]);
    });

    it('setModulePermissionConfig updates independently per module', () => {
      getState().setModulePermissionConfig('training', ['chief']);
      getState().setModulePermissionConfig('scheduling', ['captain', 'lieutenant']);

      expect(getState().modulePermissionConfigs['training']).toEqual(['chief']);
      expect(getState().modulePermissionConfigs['scheduling']).toEqual([
        'captain',
        'lieutenant',
      ]);
    });
  });

  // ---- Step Progress ----

  describe('step progress', () => {
    it('setCurrentStep updates step number', () => {
      getState().setCurrentStep(3);
      expect(getState().currentStep).toBe(3);
    });

    it('setCurrentStep can go backward', () => {
      getState().setCurrentStep(5);
      getState().setCurrentStep(2);
      expect(getState().currentStep).toBe(2);
    });

    it('markStepCompleted adds step to completedSteps', () => {
      getState().markStepCompleted('department');
      expect(getState().completedSteps).toContain('department');
    });

    it('markStepCompleted does not duplicate already-completed steps', () => {
      getState().markStepCompleted('department');
      getState().markStepCompleted('department');

      const count = getState().completedSteps.filter(
        (s) => s === 'department'
      ).length;
      expect(count).toBe(1);
    });

    it('markStepCompleted accumulates distinct steps', () => {
      getState().markStepCompleted('department');
      getState().markStepCompleted('modules');
      getState().markStepCompleted('it-team');

      expect(getState().completedSteps).toEqual([
        'department',
        'modules',
        'it-team',
      ]);
    });
  });

  // ---- Error Handling ----

  describe('error handling', () => {
    it('logError adds error to list with timestamp and recovered=false', () => {
      getState().logError({
        step: 'department',
        action: 'saveName',
        errorMessage: 'Name too long',
      });

      const { errors } = getState();
      expect(errors).toHaveLength(1);
      expect(errors[0]?.step).toBe('department');
      expect(errors[0]?.action).toBe('saveName');
      expect(errors[0]?.errorMessage).toBe('Name too long');
      expect(errors[0]?.recovered).toBe(false);
      expect(errors[0]?.timestamp).toBeTruthy();
    });

    it('logError sets lastError to the new error', () => {
      getState().logError({
        step: 'modules',
        action: 'toggle',
        errorMessage: 'Failed to toggle',
      });

      expect(getState().lastError?.step).toBe('modules');
      expect(getState().lastError?.errorMessage).toBe('Failed to toggle');
    });

    it('logError accumulates multiple errors', () => {
      getState().logError({
        step: 'department',
        action: 'saveName',
        errorMessage: 'Error 1',
      });
      getState().logError({
        step: 'modules',
        action: 'toggle',
        errorMessage: 'Error 2',
      });

      expect(getState().errors).toHaveLength(2);
      expect(getState().lastError?.errorMessage).toBe('Error 2');
    });

    it('logError includes optional fields when provided', () => {
      getState().logError({
        step: 'department',
        action: 'saveLogo',
        errorMessage: 'Upload failed',
        errorDetails: { statusCode: 413 },
        userContext: 'Uploading large image',
      });

      const error = getState().errors[0];
      expect(error?.errorDetails).toEqual({ statusCode: 413 });
      expect(error?.userContext).toBe('Uploading large image');
    });

    it('markErrorRecovered marks specific error as recovered', () => {
      getState().logError({
        step: 'department',
        action: 'saveName',
        errorMessage: 'Error 1',
      });
      getState().logError({
        step: 'modules',
        action: 'toggle',
        errorMessage: 'Error 2',
      });

      getState().markErrorRecovered(0);

      const { errors } = getState();
      expect(errors[0]?.recovered).toBe(true);
      expect(errors[1]?.recovered).toBe(false);
    });

    it('markErrorRecovered is safe for out-of-bounds index', () => {
      getState().logError({
        step: 'department',
        action: 'saveName',
        errorMessage: 'Error 1',
      });

      getState().markErrorRecovered(99);

      expect(getState().errors).toHaveLength(1);
      expect(getState().errors[0]?.recovered).toBe(false);
    });

    it('clearErrors empties error list and clears lastError', () => {
      getState().logError({
        step: 'department',
        action: 'saveName',
        errorMessage: 'Error 1',
      });
      getState().logError({
        step: 'modules',
        action: 'toggle',
        errorMessage: 'Error 2',
      });

      getState().clearErrors();

      expect(getState().errors).toEqual([]);
      expect(getState().lastError).toBeNull();
    });
  });

  // ---- Auto-save ----

  describe('auto-save', () => {
    it('triggerAutoSave updates lastSaved when autoSaveEnabled is true', () => {
      expect(getState().lastSaved).toBeNull();
      getState().triggerAutoSave();
      expect(getState().lastSaved).toBeTruthy();
    });

    it('triggerAutoSave does not update lastSaved when autoSaveEnabled is false', () => {
      useOnboardingStore.setState({ autoSaveEnabled: false });
      getState().triggerAutoSave();
      expect(getState().lastSaved).toBeNull();
    });

    it('actions trigger auto-save (lastSaved is updated)', () => {
      getState().setDepartmentName('Test FD');
      expect(getState().lastSaved).toBeTruthy();
    });
  });

  // ---- Reset ----

  describe('reset', () => {
    it('resetOnboarding returns to initial state', () => {
      getState().setDepartmentName('Springfield FD');
      getState().setLogoData('data:image/png;base64,abc');
      getState().setNavigationLayout('left');
      getState().setCurrentStep(5);
      getState().markStepCompleted('department');
      getState().setSelectedModules(['training', 'scheduling']);
      getState().setSystemOwnerInfo({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
      });
      getState().setSessionId('session-123');
      getState().setCsrfToken('token-456');
      getState().logError({
        step: 'test',
        action: 'test',
        errorMessage: 'test error',
      });

      getState().resetOnboarding();

      const state = getState();
      expect(state.departmentName).toBe('');
      expect(state.logoData).toBeNull();
      expect(state.navigationLayout).toBe('top');
      expect(state.currentStep).toBe(1);
      expect(state.completedSteps).toEqual([]);
      expect(state.selectedModules).toEqual([]);
      expect(state.systemOwnerFirstName).toBe('');
      expect(state.systemOwnerLastName).toBe('');
      expect(state.systemOwnerEmail).toBe('');
      expect(state.sessionId).toBeNull();
      expect(state.csrfToken).toBeNull();
      expect(state.errors).toEqual([]);
      expect(state.lastError).toBeNull();
      expect(state.moduleStatuses).toEqual({});
      expect(state.modulePermissionConfigs).toEqual({});
    });

    it('clearSensitiveData removes session and CSRF token', () => {
      getState().setSessionId('session-123');
      getState().setCsrfToken('csrf-abc');
      getState().setDepartmentName('Test FD');

      getState().clearSensitiveData();

      const state = getState();
      expect(state.sessionId).toBeNull();
      expect(state.csrfToken).toBeNull();
      // Non-sensitive data should remain
      expect(state.departmentName).toBe('Test FD');
    });
  });

  // ---- Email, File Storage, Auth Platform ----

  describe('platform configuration', () => {
    it('setEmailPlatform updates state', () => {
      getState().setEmailPlatform('gmail');
      expect(getState().emailPlatform).toBe('gmail');
    });

    it('setEmailConfigured updates state', () => {
      getState().setEmailConfigured(true);
      expect(getState().emailConfigured).toBe(true);
    });

    it('setFileStoragePlatform updates state', () => {
      getState().setFileStoragePlatform('minio');
      expect(getState().fileStoragePlatform).toBe('minio');
    });

    it('setAuthPlatform updates state', () => {
      getState().setAuthPlatform('ldap');
      expect(getState().authPlatform).toBe('ldap');
    });
  });

  // ---- IT Team Configuration ----

  describe('IT team configuration', () => {
    it('setITTeamConfigured updates state', () => {
      getState().setITTeamConfigured(true);
      expect(getState().itTeamConfigured).toBe(true);
    });

    it('setITTeamMembers updates members list', () => {
      const members = [
        { id: '1', name: 'Alice', email: 'alice@fd.gov', phone: '555-0001', role: 'Primary IT Contact' },
        { id: '2', name: 'Bob', email: 'bob@fd.gov', phone: '555-0002', role: 'Backup IT Contact' },
      ];
      getState().setITTeamMembers(members);
      expect(getState().itTeamMembers).toEqual(members);
    });

    it('setBackupEmail updates state', () => {
      getState().setBackupEmail('backup@fd.gov');
      expect(getState().backupEmail).toBe('backup@fd.gov');
    });

    it('setBackupPhone updates state', () => {
      getState().setBackupPhone('555-9999');
      expect(getState().backupPhone).toBe('555-9999');
    });

    it('setSecondaryAdminEmail updates state', () => {
      getState().setSecondaryAdminEmail('admin2@fd.gov');
      expect(getState().secondaryAdminEmail).toBe('admin2@fd.gov');
    });
  });

  // ---- Session Actions ----

  describe('session actions', () => {
    it('setSessionId updates state', () => {
      getState().setSessionId('sess-abc-123');
      expect(getState().sessionId).toBe('sess-abc-123');
    });

    it('setCsrfToken updates state', () => {
      getState().setCsrfToken('csrf-token-xyz');
      expect(getState().csrfToken).toBe('csrf-token-xyz');
    });
  });

  // ---- Positions Config ----

  describe('positions config', () => {
    it('setPositionsConfig sets positions', () => {
      const positions = {
        chief: {
          id: 'chief',
          name: 'Chief',
          description: 'Department Chief',
          priority: 1,
          permissions: {
            events: { view: true, manage: true },
          },
        },
      };
      getState().setPositionsConfig(positions);
      expect(getState().positionsConfig).toEqual(positions);
    });

    it('setPositionsConfig can be set to null', () => {
      getState().setPositionsConfig({
        chief: {
          id: 'chief',
          name: 'Chief',
          description: 'Chief',
          priority: 1,
          permissions: {},
        },
      });
      getState().setPositionsConfig(null);
      expect(getState().positionsConfig).toBeNull();
    });
  });
});
