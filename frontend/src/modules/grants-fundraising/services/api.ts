/**
 * Grants & Fundraising API Service
 *
 * Handles all API calls for the Grants & Fundraising module.
 */

import { createApiClient } from '../../../utils/createApiClient';
import type {
  GrantOpportunity,
  GrantOpportunityCreatePayload,
  GrantOpportunityUpdatePayload,
  GrantApplication,
  GrantApplicationPage,
  GrantApplicationQuery,
  GrantBudgetItem,
  GrantExpenditure,
  GrantComplianceTask,
  GrantNote,
  FundraisingCampaign,
  Donor,
  Donation,
  DonationCreatePayload,
  Pledge,
  PledgeCreatePayload,
  PledgeUpdatePayload,
  FundraisingEvent,
  FundraisingEventCreatePayload,
  FundraisingEventUpdatePayload,
  GrantsDashboard,
  GrantReport,
  FundraisingReport,
  ZeffyCampaign,
  ZeffyDuesScheduleOption,
  ZeffyLink,
  ZeffyLinkPayload,
  ZeffyPaymentPage,
  ZeffyPaymentState,
  ZeffyStatus,
  ZeffySyncResult,
} from '../types';
import { asArray } from '../../../utils/asArray';

const api = createApiClient();

// =============================================================================
// Grants Service
// =============================================================================

export const grantsService = {
  // --- Opportunities ---

  async listOpportunities(params?: {
    category?: string;
    /** `false` includes retired opportunities. The backend defaults to `true`. */
    activeOnly?: boolean;
    search?: string;
    skip?: number;
    limit?: number;
  }): Promise<GrantOpportunity[]> {
    const response = await api.get<GrantOpportunity[]>('/grants', {
      params: {
        category: params?.category,
        active_only: params?.activeOnly,
        search: params?.search,
        skip: params?.skip ?? 0,
        limit: params?.limit ?? 100,
      },
    });
    return asArray(response.data);
  },

  async getOpportunity(id: string): Promise<GrantOpportunity> {
    const response = await api.get<GrantOpportunity>(`/grants/${id}`);
    return response.data;
  },

  async createOpportunity(data: GrantOpportunityCreatePayload): Promise<GrantOpportunity> {
    const response = await api.post<GrantOpportunity>('/grants', data);
    return response.data;
  },

  async updateOpportunity(
    id: string,
    data: GrantOpportunityUpdatePayload | { isActive: boolean }
  ): Promise<GrantOpportunity> {
    const response = await api.put<GrantOpportunity>(`/grants/${id}`, data);
    return response.data;
  },

  async deleteOpportunity(id: string): Promise<void> {
    await api.delete(`/grants/${id}`);
  },

  // --- Applications ---

  async listApplications(params?: {
    status?: string;
    priority?: string;
    assignedTo?: string;
    search?: string;
    skip?: number;
    limit?: number;
  }): Promise<GrantApplication[]> {
    const response = await api.get<GrantApplication[]>('/grants/applications', {
      params: {
        status: params?.status,
        priority: params?.priority,
        assigned_to: params?.assignedTo,
        search: params?.search,
        skip: params?.skip ?? 0,
        limit: params?.limit ?? 100,
      },
    });
    return asArray(response.data);
  },

  /**
   * One page of applications plus the total matching the filters, read from
   * `X-Total-Count` (GF-33). Filtering, search and sort all happen on the
   * server so the page can step through every application, not the first
   * fetch's worth.
   */
  async listApplicationsPage(query: GrantApplicationQuery): Promise<GrantApplicationPage> {
    const response = await api.get<GrantApplication[]>('/grants/applications', {
      params: {
        status: query.status || undefined,
        status_group: query.statusGroup || undefined,
        priority: query.priority || undefined,
        search: query.search?.trim() || undefined,
        sort: query.sort || undefined,
        order: query.order,
        skip: query.skip ?? 0,
        limit: query.limit ?? 25,
      },
    });
    const items = asArray(response.data);
    const header = Number(response.headers['x-total-count']);
    return { items, total: Number.isFinite(header) ? header : items.length };
  },

  async getApplication(id: string): Promise<GrantApplication> {
    const response = await api.get<GrantApplication>(`/grants/applications/${id}`);
    return response.data;
  },

  async createApplication(data: Partial<GrantApplication>): Promise<GrantApplication> {
    const response = await api.post<GrantApplication>('/grants/applications', data);
    return response.data;
  },

  async updateApplication(id: string, data: Partial<GrantApplication>): Promise<GrantApplication> {
    const response = await api.put<GrantApplication>(`/grants/applications/${id}`, data);
    return response.data;
  },

  async deleteApplication(id: string): Promise<void> {
    await api.delete(`/grants/applications/${id}`);
  },

  // --- Budget Items ---

  async listBudgetItems(applicationId: string): Promise<GrantBudgetItem[]> {
    const response = await api.get<GrantBudgetItem[]>(`/grants/applications/${applicationId}/budget-items`);
    return asArray(response.data);
  },

  async createBudgetItem(applicationId: string, data: Partial<GrantBudgetItem>): Promise<GrantBudgetItem> {
    const response = await api.post<GrantBudgetItem>(`/grants/applications/${applicationId}/budget-items`, data);
    return response.data;
  },

  async updateBudgetItem(
    _applicationId: string,
    itemId: string,
    data: Partial<GrantBudgetItem>
  ): Promise<GrantBudgetItem> {
    const response = await api.put<GrantBudgetItem>(`/grants/budget-items/${itemId}`, data);
    return response.data;
  },

  async deleteBudgetItem(_applicationId: string, itemId: string): Promise<void> {
    await api.delete(`/grants/budget-items/${itemId}`);
  },

  // --- Expenditures ---

  async listExpenditures(applicationId: string): Promise<GrantExpenditure[]> {
    const response = await api.get<GrantExpenditure[]>(`/grants/applications/${applicationId}/expenditures`);
    return asArray(response.data);
  },

  async createExpenditure(applicationId: string, data: Partial<GrantExpenditure>): Promise<GrantExpenditure> {
    const response = await api.post<GrantExpenditure>(`/grants/applications/${applicationId}/expenditures`, data);
    return response.data;
  },

  async updateExpenditure(
    _applicationId: string,
    expenditureId: string,
    data: Partial<GrantExpenditure>
  ): Promise<GrantExpenditure> {
    const response = await api.put<GrantExpenditure>(`/grants/expenditures/${expenditureId}`, data);
    return response.data;
  },

  async deleteExpenditure(_applicationId: string, expenditureId: string): Promise<void> {
    await api.delete(`/grants/expenditures/${expenditureId}`);
  },

  // --- Compliance Tasks ---

  async listComplianceTasks(applicationId?: string): Promise<GrantComplianceTask[]> {
    const response = await api.get<GrantComplianceTask[]>('/grants/compliance-tasks', {
      params: { application_id: applicationId },
    });
    return asArray(response.data);
  },

  async createComplianceTask(applicationId: string, data: Partial<GrantComplianceTask>): Promise<GrantComplianceTask> {
    const response = await api.post<GrantComplianceTask>(
      `/grants/applications/${applicationId}/compliance-tasks`,
      data
    );
    return response.data;
  },

  async updateComplianceTask(
    _applicationId: string,
    taskId: string,
    data: Partial<GrantComplianceTask>
  ): Promise<GrantComplianceTask> {
    const response = await api.put<GrantComplianceTask>(`/grants/compliance-tasks/${taskId}`, data);
    return response.data;
  },

  async deleteComplianceTask(_applicationId: string, taskId: string): Promise<void> {
    await api.delete(`/grants/compliance-tasks/${taskId}`);
  },

  // --- Notes ---

  async listNotes(applicationId: string): Promise<GrantNote[]> {
    const response = await api.get<GrantNote[]>(`/grants/applications/${applicationId}/notes`);
    return asArray(response.data);
  },

  async createNote(applicationId: string, data: Partial<GrantNote>): Promise<GrantNote> {
    const response = await api.post<GrantNote>(`/grants/applications/${applicationId}/notes`, data);
    return response.data;
  },

  // --- Dashboard & Reports ---

  async getDashboard(): Promise<GrantsDashboard> {
    const response = await api.get<GrantsDashboard>('/grants/dashboard');
    return response.data;
  },

  async getGrantReport(params?: { startDate?: string; endDate?: string }): Promise<GrantReport> {
    const response = await api.get<GrantReport>('/grants/reports/grants', {
      params: {
        start_date: params?.startDate,
        end_date: params?.endDate,
      },
    });
    return response.data;
  },

  async getFundraisingReport(params?: { startDate?: string; endDate?: string }): Promise<FundraisingReport> {
    const response = await api.get<FundraisingReport>('/grants/reports/fundraising', {
      params: {
        start_date: params?.startDate,
        end_date: params?.endDate,
      },
    });
    return response.data;
  },
};

// =============================================================================
// Fundraising Service
// =============================================================================

export const fundraisingService = {
  // --- Campaigns ---

  async listCampaigns(params?: {
    status?: string;
    campaignType?: string;
    search?: string;
    skip?: number;
    limit?: number;
  }): Promise<FundraisingCampaign[]> {
    const response = await api.get<FundraisingCampaign[]>('/grants/campaigns', {
      params: {
        status: params?.status,
        campaign_type: params?.campaignType,
        search: params?.search,
        skip: params?.skip ?? 0,
        limit: params?.limit ?? 100,
      },
    });
    return asArray(response.data);
  },

  async getCampaign(id: string): Promise<FundraisingCampaign> {
    const response = await api.get<FundraisingCampaign>(`/grants/campaigns/${id}`);
    return response.data;
  },

  async createCampaign(data: Partial<FundraisingCampaign>): Promise<FundraisingCampaign> {
    const response = await api.post<FundraisingCampaign>('/grants/campaigns', data);
    return response.data;
  },

  async updateCampaign(id: string, data: Partial<FundraisingCampaign>): Promise<FundraisingCampaign> {
    const response = await api.put<FundraisingCampaign>(`/grants/campaigns/${id}`, data);
    return response.data;
  },

  async deleteCampaign(id: string): Promise<void> {
    await api.delete(`/grants/campaigns/${id}`);
  },

  // --- Donors ---

  async listDonors(params?: {
    donorType?: string;
    active?: boolean;
    search?: string;
    skip?: number;
    limit?: number;
  }): Promise<Donor[]> {
    const response = await api.get<Donor[]>('/grants/donors', {
      params: {
        donor_type: params?.donorType,
        active: params?.active,
        search: params?.search,
        skip: params?.skip ?? 0,
        limit: params?.limit ?? 100,
      },
    });
    return asArray(response.data);
  },

  async getDonor(id: string): Promise<Donor> {
    const response = await api.get<Donor>(`/grants/donors/${id}`);
    return response.data;
  },

  async createDonor(data: Partial<Donor>): Promise<Donor> {
    const response = await api.post<Donor>('/grants/donors', data);
    return response.data;
  },

  async updateDonor(id: string, data: Partial<Donor>): Promise<Donor> {
    const response = await api.put<Donor>(`/grants/donors/${id}`, data);
    return response.data;
  },

  // --- Donations ---

  async listDonations(params?: {
    campaignId?: string;
    donorId?: string;
    paymentMethod?: string;
    startDate?: string;
    endDate?: string;
    skip?: number;
    limit?: number;
  }): Promise<Donation[]> {
    const response = await api.get<Donation[]>('/grants/donations', {
      params: {
        campaign_id: params?.campaignId,
        donor_id: params?.donorId,
        payment_method: params?.paymentMethod,
        start_date: params?.startDate,
        end_date: params?.endDate,
        skip: params?.skip ?? 0,
        limit: params?.limit ?? 100,
      },
    });
    return asArray(response.data);
  },

  async createDonation(data: DonationCreatePayload): Promise<Donation> {
    const response = await api.post<Donation>('/grants/donations', data);
    return response.data;
  },

  async updateDonation(id: string, data: Partial<Donation>): Promise<Donation> {
    const response = await api.put<Donation>(`/grants/donations/${id}`, data);
    return response.data;
  },

  // --- Pledges ---

  async listPledges(params?: {
    campaignId?: string;
    donorId?: string;
    status?: string;
    skip?: number;
    limit?: number;
  }): Promise<Pledge[]> {
    const response = await api.get<Pledge[]>('/grants/pledges', {
      params: {
        campaign_id: params?.campaignId,
        donor_id: params?.donorId,
        status: params?.status,
        skip: params?.skip ?? 0,
        limit: params?.limit ?? 100,
      },
    });
    return asArray(response.data);
  },

  async createPledge(data: PledgeCreatePayload): Promise<Pledge> {
    const response = await api.post<Pledge>('/grants/pledges', data);
    return response.data;
  },

  async updatePledge(id: string, data: PledgeUpdatePayload): Promise<Pledge> {
    const response = await api.put<Pledge>(`/grants/pledges/${id}`, data);
    return response.data;
  },

  // --- Fundraising Events ---

  async listFundraisingEvents(params?: {
    campaignId?: string;
    status?: string;
    skip?: number;
    limit?: number;
  }): Promise<FundraisingEvent[]> {
    const response = await api.get<FundraisingEvent[]>('/grants/fundraising-events', {
      params: {
        campaign_id: params?.campaignId,
        status: params?.status,
        skip: params?.skip ?? 0,
        limit: params?.limit ?? 100,
      },
    });
    return asArray(response.data);
  },

  async createFundraisingEvent(data: FundraisingEventCreatePayload): Promise<FundraisingEvent> {
    const response = await api.post<FundraisingEvent>('/grants/fundraising-events', data);
    return response.data;
  },

  async updateFundraisingEvent(id: string, data: FundraisingEventUpdatePayload): Promise<FundraisingEvent> {
    const response = await api.put<FundraisingEvent>(`/grants/fundraising-events/${id}`, data);
    return response.data;
  },
};

// =============================================================================
// Zeffy Service
// =============================================================================

export const zeffyService = {
  async getStatus(): Promise<ZeffyStatus> {
    const response = await api.get<ZeffyStatus>('/grants/zeffy/status');
    return response.data;
  },

  /** Read live from Zeffy; `fundraising.manage`. */
  async listCampaigns(): Promise<ZeffyCampaign[]> {
    const response = await api.get<ZeffyCampaign[]>('/grants/zeffy/campaigns');
    return asArray(response.data);
  },

  async listLinks(): Promise<ZeffyLink[]> {
    const response = await api.get<ZeffyLink[]>('/grants/zeffy/links');
    return asArray(response.data);
  },

  async saveLink(zeffyCampaignId: string, data: ZeffyLinkPayload): Promise<ZeffyLink> {
    const response = await api.put<ZeffyLink>(`/grants/zeffy/links/${encodeURIComponent(zeffyCampaignId)}`, data);
    return response.data;
  },

  async deleteLink(zeffyCampaignId: string): Promise<void> {
    await api.delete(`/grants/zeffy/links/${encodeURIComponent(zeffyCampaignId)}`);
  },

  async listPayments(params: {
    state?: ZeffyPaymentState | undefined;
    limit: number;
    offset: number;
  }): Promise<ZeffyPaymentPage> {
    const response = await api.get<ZeffyPaymentPage>('/grants/zeffy/payments', {
      params: { state: params.state, limit: params.limit, offset: params.offset },
    });
    return { items: asArray(response.data.items), total: response.data.total };
  },

  async syncNow(): Promise<ZeffySyncResult> {
    const response = await api.post<ZeffySyncResult>('/grants/zeffy/sync');
    return response.data;
  },

  /** Dues schedules to link a membership campaign to; needs finance access. */
  async listDuesSchedules(): Promise<ZeffyDuesScheduleOption[]> {
    // The endpoint pages (at most 1000 a page); an older schedule past the
    // first page may still be active and must be offered.
    const pageSize = 1000;
    const schedules: ZeffyDuesScheduleOption[] = [];
    for (let skip = 0; ; skip += pageSize) {
      const response = await api.get<ZeffyDuesScheduleOption[]>('/finance/dues-schedules', {
        params: { skip, limit: pageSize },
      });
      const page = asArray(response.data);
      schedules.push(...page);
      if (page.length < pageSize) return schedules;
    }
  },
};
