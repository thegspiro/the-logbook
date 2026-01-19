/**
 * API Service
 *
 * Handles all API calls to the backend.
 */

import axios from 'axios';
import type { User, ContactInfoSettings, ContactInfoUpdate } from '../types/user';
import type {
  Role,
  Permission,
  PermissionCategory,
  UserWithRoles,
  RoleAssignment,
  UserRoleResponse
} from '../types/role';
import type {
  LoginCredentials,
  RegisterData,
  TokenResponse,
  CurrentUser,
  PasswordChangeData,
} from '../types/auth';
import type {
  TrainingCourse,
  TrainingCourseCreate,
  TrainingCourseUpdate,
  TrainingRecord,
  TrainingRecordCreate,
  TrainingRecordUpdate,
  TrainingRequirement,
  TrainingRequirementCreate,
  TrainingRequirementUpdate,
  UserTrainingStats,
  TrainingReport,
  RequirementProgress,
} from '../types/training';
import type {
  Event,
  EventListItem,
  EventCreate,
  EventUpdate,
  EventCancel,
  RSVP,
  RSVPCreate,
  CheckInRequest,
  EventStats,
} from '../types/event';

const API_BASE_URL = '/api/v1';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle token expiration
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // If 401 and we haven't retried yet, try to refresh token
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const refreshToken = localStorage.getItem('refresh_token');
        if (refreshToken) {
          const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {
            refresh_token: refreshToken,
          });

          const { access_token } = response.data;
          localStorage.setItem('access_token', access_token);

          originalRequest.headers.Authorization = `Bearer ${access_token}`;
          return api(originalRequest);
        }
      } catch (refreshError) {
        // Refresh failed, clear tokens and redirect to login
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export const userService = {
  /**
   * Get all users/members in the organization
   */
  async getUsers(): Promise<User[]> {
    const response = await api.get<User[]>('/users');
    return response.data;
  },

  /**
   * Check if contact information is enabled
   */
  async checkContactInfoEnabled(): Promise<ContactInfoSettings> {
    const response = await api.get<ContactInfoSettings>('/users/contact-info-enabled');
    return response.data;
  },

  /**
   * Get all users with their assigned roles
   */
  async getUsersWithRoles(): Promise<UserWithRoles[]> {
    const response = await api.get<UserWithRoles[]>('/users/with-roles');
    return response.data;
  },

  /**
   * Get a specific user with their assigned roles
   */
  async getUserWithRoles(userId: string): Promise<UserWithRoles> {
    const response = await api.get<UserWithRoles>(`/users/${userId}/with-roles`);
    return response.data;
  },

  /**
   * Get roles for a specific user
   */
  async getUserRoles(userId: string): Promise<UserRoleResponse> {
    const response = await api.get<UserRoleResponse>(`/users/${userId}/roles`);
    return response.data;
  },

  /**
   * Assign roles to a user (replaces existing roles)
   */
  async assignUserRoles(userId: string, roleIds: string[]): Promise<UserRoleResponse> {
    const response = await api.put<UserRoleResponse>(`/users/${userId}/roles`, {
      role_ids: roleIds,
    });
    return response.data;
  },

  /**
   * Add a single role to a user
   */
  async addRoleToUser(userId: string, roleId: string): Promise<UserRoleResponse> {
    const response = await api.post<UserRoleResponse>(`/users/${userId}/roles/${roleId}`);
    return response.data;
  },

  /**
   * Remove a role from a user
   */
  async removeRoleFromUser(userId: string, roleId: string): Promise<UserRoleResponse> {
    const response = await api.delete<UserRoleResponse>(`/users/${userId}/roles/${roleId}`);
    return response.data;
  },

  /**
   * Update user contact information and notification preferences
   */
  async updateContactInfo(userId: string, contactInfo: ContactInfoUpdate): Promise<UserWithRoles> {
    const response = await api.patch<UserWithRoles>(`/users/${userId}/contact-info`, contactInfo);
    return response.data;
  },

  /**
   * Create a new member (admin/secretary only)
   */
  async createMember(memberData: {
    username: string;
    email: string;
    first_name: string;
    last_name: string;
    badge_number?: string;
    phone?: string;
    mobile?: string;
    date_of_birth?: string;
    hire_date?: string;
    role_ids: string[];
    send_welcome_email: boolean;
  }): Promise<UserWithRoles> {
    const response = await api.post<UserWithRoles>('/users', memberData);
    return response.data;
  },
};

export const organizationService = {
  /**
   * Get organization settings
   */
  async getSettings(): Promise<{ contact_info_visibility: ContactInfoSettings }> {
    const response = await api.get('/organization/settings');
    return response.data;
  },

  /**
   * Update contact information settings (secretary only)
   */
  async updateContactInfoSettings(settings: ContactInfoSettings): Promise<ContactInfoSettings> {
    const response = await api.patch('/organization/settings/contact-info', settings);
    return response.data;
  },
};

export const roleService = {
  /**
   * Get all available permissions
   */
  async getPermissions(): Promise<Permission[]> {
    const response = await api.get<Permission[]>('/roles/permissions');
    return response.data;
  },

  /**
   * Get permissions grouped by category
   */
  async getPermissionsByCategory(): Promise<PermissionCategory[]> {
    const response = await api.get<PermissionCategory[]>('/roles/permissions/by-category');
    return response.data;
  },

  /**
   * Get all roles
   */
  async getRoles(): Promise<Role[]> {
    const response = await api.get<Role[]>('/roles');
    return response.data;
  },

  /**
   * Get a specific role by ID
   */
  async getRole(roleId: string): Promise<Role> {
    const response = await api.get<Role>(`/roles/${roleId}`);
    return response.data;
  },

  /**
   * Create a new custom role
   */
  async createRole(roleData: {
    name: string;
    slug: string;
    description?: string;
    permissions: string[];
    priority?: number;
  }): Promise<Role> {
    const response = await api.post<Role>('/roles', roleData);
    return response.data;
  },

  /**
   * Update a role
   */
  async updateRole(
    roleId: string,
    updates: {
      name?: string;
      description?: string;
      permissions?: string[];
      priority?: number;
    }
  ): Promise<Role> {
    const response = await api.patch<Role>(`/roles/${roleId}`, updates);
    return response.data;
  },

  /**
   * Delete a custom role
   */
  async deleteRole(roleId: string): Promise<void> {
    await api.delete(`/roles/${roleId}`);
  },
};

export const authService = {
  /**
   * Login user
   */
  async login(credentials: LoginCredentials): Promise<TokenResponse> {
    const response = await api.post<TokenResponse>('/auth/login', credentials);
    return response.data;
  },

  /**
   * Register new user
   */
  async register(data: RegisterData): Promise<TokenResponse> {
    const response = await api.post<TokenResponse>('/auth/register', data);
    return response.data;
  },

  /**
   * Logout user
   */
  async logout(): Promise<void> {
    await api.post('/auth/logout');
  },

  /**
   * Get current user
   */
  async getCurrentUser(): Promise<CurrentUser> {
    const response = await api.get<CurrentUser>('/auth/me');
    return response.data;
  },

  /**
   * Change password
   */
  async changePassword(data: PasswordChangeData): Promise<void> {
    await api.post('/auth/change-password', data);
  },

  /**
   * Check if authenticated
   */
  async checkAuth(): Promise<boolean> {
    try {
      await api.get('/auth/check');
      return true;
    } catch (error) {
      return false;
    }
  },
};

export const trainingService = {
  /**
   * Get all training courses
   */
  async getCourses(activeOnly: boolean = true): Promise<TrainingCourse[]> {
    const response = await api.get<TrainingCourse[]>('/training/courses', {
      params: { active_only: activeOnly },
    });
    return response.data;
  },

  /**
   * Get a specific course
   */
  async getCourse(courseId: string): Promise<TrainingCourse> {
    const response = await api.get<TrainingCourse>(`/training/courses/${courseId}`);
    return response.data;
  },

  /**
   * Create a new course
   */
  async createCourse(course: TrainingCourseCreate): Promise<TrainingCourse> {
    const response = await api.post<TrainingCourse>('/training/courses', course);
    return response.data;
  },

  /**
   * Update a course
   */
  async updateCourse(courseId: string, updates: TrainingCourseUpdate): Promise<TrainingCourse> {
    const response = await api.patch<TrainingCourse>(`/training/courses/${courseId}`, updates);
    return response.data;
  },

  /**
   * Get training records
   */
  async getRecords(params?: {
    user_id?: string;
    status?: string;
    start_date?: string;
    end_date?: string;
  }): Promise<TrainingRecord[]> {
    const response = await api.get<TrainingRecord[]>('/training/records', { params });
    return response.data;
  },

  /**
   * Create a training record
   */
  async createRecord(record: TrainingRecordCreate): Promise<TrainingRecord> {
    const response = await api.post<TrainingRecord>('/training/records', record);
    return response.data;
  },

  /**
   * Update a training record
   */
  async updateRecord(recordId: string, updates: TrainingRecordUpdate): Promise<TrainingRecord> {
    const response = await api.patch<TrainingRecord>(`/training/records/${recordId}`, updates);
    return response.data;
  },

  /**
   * Get training requirements
   */
  async getRequirements(params?: {
    year?: number;
    active_only?: boolean;
  }): Promise<TrainingRequirement[]> {
    const response = await api.get<TrainingRequirement[]>('/training/requirements', { params });
    return response.data;
  },

  /**
   * Create a training requirement
   */
  async createRequirement(requirement: TrainingRequirementCreate): Promise<TrainingRequirement> {
    const response = await api.post<TrainingRequirement>('/training/requirements', requirement);
    return response.data;
  },

  /**
   * Update a training requirement
   */
  async updateRequirement(
    requirementId: string,
    updates: TrainingRequirementUpdate
  ): Promise<TrainingRequirement> {
    const response = await api.patch<TrainingRequirement>(
      `/training/requirements/${requirementId}`,
      updates
    );
    return response.data;
  },

  /**
   * Get training statistics for a user
   */
  async getUserStats(userId: string): Promise<UserTrainingStats> {
    const response = await api.get<UserTrainingStats>(`/training/stats/user/${userId}`);
    return response.data;
  },

  /**
   * Generate a training report
   */
  async generateReport(
    userId: string,
    startDate: string,
    endDate: string
  ): Promise<TrainingReport> {
    const response = await api.get<TrainingReport>(`/training/reports/user/${userId}`, {
      params: { start_date: startDate, end_date: endDate },
    });
    return response.data;
  },

  /**
   * Get requirement progress for a user
   */
  async getRequirementProgress(
    userId: string,
    year?: number
  ): Promise<RequirementProgress[]> {
    const response = await api.get<RequirementProgress[]>(
      `/training/requirements/progress/${userId}`,
      { params: { year } }
    );
    return response.data;
  },

  /**
   * Get expiring certifications
   */
  async getExpiringCertifications(daysAhead: number = 90): Promise<TrainingRecord[]> {
    const response = await api.get<TrainingRecord[]>('/training/certifications/expiring', {
      params: { days_ahead: daysAhead },
    });
    return response.data;
  },
};

  /**
   * Create a new member (admin/secretary only)
   */
  async createMember(memberData: {
    username: string;
    email: string;
    first_name: string;
    last_name: string;
    badge_number?: string;
    phone?: string;
    mobile?: string;
    date_of_birth?: string;
    hire_date?: string;
    role_ids: string[];
    send_welcome_email: boolean;
  }): Promise<UserWithRoles> {
    const response = await api.post<UserWithRoles>('/users', memberData);
    return response.data;
  },
};

export const electionService = {
  /**
   * Get all elections
   */
  async getElections(statusFilter?: string): Promise<import('../types/election').ElectionListItem[]> {
    const response = await api.get<import('../types/election').ElectionListItem[]>('/elections', {
      params: { status_filter: statusFilter },
    });
    return response.data;
  },

  /**
   * Get a specific election
   */
  async getElection(electionId: string): Promise<import('../types/election').Election> {
    const response = await api.get<import('../types/election').Election>(`/elections/${electionId}`);
    return response.data;
  },

  /**
   * Create a new election
   */
  async createElection(electionData: import('../types/election').ElectionCreate): Promise<import('../types/election').Election> {
    const response = await api.post<import('../types/election').Election>('/elections', electionData);
    return response.data;
  },

  /**
   * Update an election
   */
  async updateElection(electionId: string, electionData: import('../types/election').ElectionUpdate): Promise<import('../types/election').Election> {
    const response = await api.patch<import('../types/election').Election>(`/elections/${electionId}`, electionData);
    return response.data;
  },

  /**
   * Delete an election
   */
  async deleteElection(electionId: string): Promise<void> {
    await api.delete(`/elections/${electionId}`);
  },

  /**
   * Open an election for voting
   */
  async openElection(electionId: string): Promise<import('../types/election').Election> {
    const response = await api.post<import('../types/election').Election>(`/elections/${electionId}/open`);
    return response.data;
  },

  /**
   * Close an election
   */
  async closeElection(electionId: string): Promise<import('../types/election').Election> {
    const response = await api.post<import('../types/election').Election>(`/elections/${electionId}/close`);
    return response.data;
  },

  /**
   * Rollback an election to previous status
   */
  async rollbackElection(electionId: string, reason: string): Promise<{ success: boolean; election: import('../types/election').Election; message: string; notifications_sent: number }> {
    const response = await api.post(`/elections/${electionId}/rollback`, { reason });
    return response.data;
  },

  /**
   * Get candidates for an election
   */
  async getCandidates(electionId: string): Promise<import('../types/election').Candidate[]> {
    const response = await api.get<import('../types/election').Candidate[]>(`/elections/${electionId}/candidates`);
    return response.data;
  },

  /**
   * Add a candidate to an election
   */
  async createCandidate(electionId: string, candidateData: import('../types/election').CandidateCreate): Promise<import('../types/election').Candidate> {
    const response = await api.post<import('../types/election').Candidate>(`/elections/${electionId}/candidates`, candidateData);
    return response.data;
  },

  /**
   * Update a candidate
   */
  async updateCandidate(electionId: string, candidateId: string, candidateData: import('../types/election').CandidateUpdate): Promise<import('../types/election').Candidate> {
    const response = await api.patch<import('../types/election').Candidate>(`/elections/${electionId}/candidates/${candidateId}`, candidateData);
    return response.data;
  },

  /**
   * Delete a candidate
   */
  async deleteCandidate(electionId: string, candidateId: string): Promise<void> {
    await api.delete(`/elections/${electionId}/candidates/${candidateId}`);
  },

  /**
   * Check voter eligibility
   */
  async checkEligibility(electionId: string): Promise<import('../types/election').VoterEligibility> {
    const response = await api.get<import('../types/election').VoterEligibility>(`/elections/${electionId}/eligibility`);
    return response.data;
  },

  /**
   * Cast a vote
   */
  async castVote(electionId: string, voteData: import('../types/election').VoteCreate): Promise<import('../types/election').Vote> {
    const response = await api.post<import('../types/election').Vote>(`/elections/${electionId}/vote`, voteData);
    return response.data;
  },

  /**
   * Get election results
   */
  async getResults(electionId: string): Promise<import('../types/election').ElectionResults> {
    const response = await api.get<import('../types/election').ElectionResults>(`/elections/${electionId}/results`);
    return response.data;
  },

  /**
   * Get election statistics
   */
  async getStats(electionId: string): Promise<import('../types/election').ElectionStats> {
    const response = await api.get<import('../types/election').ElectionStats>(`/elections/${electionId}/stats`);
    return response.data;
  },

  /**
   * Send ballot notification emails
   */
  async sendBallotEmail(electionId: string, emailData: import('../types/election').EmailBallot): Promise<import('../types/election').EmailBallotResponse> {
    const response = await api.post<import('../types/election').EmailBallotResponse>(`/elections/${electionId}/send-ballot`, emailData);
    return response.data;
  },
};

export const eventService = {
  /**
   * Get all events with optional filtering
   */
  async getEvents(params?: {
    event_type?: string;
    start_after?: string;
    start_before?: string;
    include_cancelled?: boolean;
    skip?: number;
    limit?: number;
  }): Promise<EventListItem[]> {
    const response = await api.get<EventListItem[]>('/events', { params });
    return response.data;
  },

  /**
   * Create a new event
   */
  async createEvent(eventData: EventCreate): Promise<Event> {
    const response = await api.post<Event>('/events', eventData);
    return response.data;
  },

  /**
   * Get a specific event
   */
  async getEvent(eventId: string): Promise<Event> {
    const response = await api.get<Event>(`/events/${eventId}`);
    return response.data;
  },

  /**
   * Update an event
   */
  async updateEvent(eventId: string, eventData: EventUpdate): Promise<Event> {
    const response = await api.patch<Event>(`/events/${eventId}`, eventData);
    return response.data;
  },

  /**
   * Delete an event
   */
  async deleteEvent(eventId: string): Promise<void> {
    await api.delete(`/events/${eventId}`);
  },

  /**
   * Cancel an event
   */
  async cancelEvent(eventId: string, cancelData: EventCancel): Promise<Event> {
    const response = await api.post<Event>(`/events/${eventId}/cancel`, cancelData);
    return response.data;
  },

  /**
   * Create or update an RSVP
   */
  async createOrUpdateRSVP(eventId: string, rsvpData: RSVPCreate): Promise<RSVP> {
    const response = await api.post<RSVP>(`/events/${eventId}/rsvp`, rsvpData);
    return response.data;
  },

  /**
   * Get all RSVPs for an event
   */
  async getEventRSVPs(eventId: string, status_filter?: string): Promise<RSVP[]> {
    const params = status_filter ? { status_filter } : undefined;
    const response = await api.get<RSVP[]>(`/events/${eventId}/rsvps`, { params });
    return response.data;
  },

  /**
   * Check in an attendee
   */
  async checkInAttendee(eventId: string, checkInData: CheckInRequest): Promise<RSVP> {
    const response = await api.post<RSVP>(`/events/${eventId}/check-in`, checkInData);
    return response.data;
  },

  /**
   * Get event statistics
   */
  async getEventStats(eventId: string): Promise<EventStats> {
    const response = await api.get<EventStats>(`/events/${eventId}/stats`);
    return response.data;
  },

  /**
   * Get eligible members for check-in
   */
  async getEligibleMembers(eventId: string): Promise<Array<{ id: string; first_name: string; last_name: string; email: string }>> {
    const response = await api.get<Array<{ id: string; first_name: string; last_name: string; email: string }>>(`/events/${eventId}/eligible-members`);
    return response.data;
  },

  /**
   * Record actual start and end times for an event
   */
  async recordActualTimes(eventId: string, times: import('../types/event').RecordActualTimes): Promise<import('../types/event').Event> {
    const response = await api.post<import('../types/event').Event>(`/events/${eventId}/record-times`, times);
    return response.data;
  },

  /**
   * Get QR code check-in data for an event
   */
  async getQRCheckInData(eventId: string): Promise<import('../types/event').QRCheckInData> {
    const response = await api.get<import('../types/event').QRCheckInData>(`/events/${eventId}/qr-check-in-data`);
    return response.data;
  },

  /**
   * Check in to an event (self-check-in via QR code)
   */
  async selfCheckIn(eventId: string): Promise<import('../types/event').RSVP> {
    const response = await api.post<import('../types/event').RSVP>(`/events/${eventId}/self-check-in`);
    return response.data;
  },
};
