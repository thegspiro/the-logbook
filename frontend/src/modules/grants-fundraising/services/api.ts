/**
 * Grants & Fundraising API Service
 *
 * Handles all API calls for the Grants & Fundraising module.
 */

import { createApiClient } from '../../../utils/createApiClient';
import type {
  GrantOpportunity,
  GrantApplication,
  GrantBudgetItem,
  GrantExpenditure,
  GrantComplianceTask,
  GrantNote,
  FundraisingCampaign,
  Donor,
  Donation,
  Pledge,
  FundraisingEvent,
  GrantsDashboard,
  GrantReport,
  FundraisingReport,
} from '../types';

const api = createApiClient();

// =============================================================================
// Grants Service
// =============================================================================

export const grantsService = {
  // --- Opportunities ---

  async listOpportunities(params?: {
    category?: string;
    isActive?: boolean;
    search?: string;
    skip?: number;
    limit?: number;
  }): Promise<GrantOpportunity[]> {
    const response = await api.get<GrantOpportunity[]>('/grants', {
      params: {
        category: params?.category,
        is_active: params?.isActive,
        search: params?.search,
        skip: params?.skip ?? 0,
        limit: params?.limit ?? 100,
      },
    });
    return response.data;
  },

  async getOpportunity(id: string): Promise<GrantOpportunity> {
    const response = await api.get<GrantOpportunity>(`/grants/${id}`);
    return response.data;
  },

  async createOpportunity(
    data: Partial<GrantOpportunity>,
  ): Promise<GrantOpportunity> {
    const response = await api.post<GrantOpportunity>('/grants', data);
    return response.data;
  },

  async updateOpportunity(
    id: string,
    data: Partial<GrantOpportunity>,
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
    const response = await api.get<GrantApplication[]>(
      '/grants/applications',
      {
        params: {
          status: params?.status,
          priority: params?.priority,
          assigned_to: params?.assignedTo,
          search: params?.search,
          skip: params?.skip ?? 0,
          limit: params?.limit ?? 100,
        },
      },
    );
    return response.data;
  },

  async getApplication(id: string): Promise<GrantApplication> {
    const response = await api.get<GrantApplication>(
      `/grants/applications/${id}`,
    );
    return response.data;
  },

  async createApplication(
    data: Partial<GrantApplication>,
  ): Promise<GrantApplication> {
    const response = await api.post<GrantApplication>(
      '/grants/applications',
      data,
    );
    return response.data;
  },

  async updateApplication(
    id: string,
    data: Partial<GrantApplication>,
  ): Promise<GrantApplication> {
    const response = await api.put<GrantApplication>(
      `/grants/applications/${id}`,
      data,
    );
    return response.data;
  },

  async deleteApplication(id: string): Promise<void> {
    await api.delete(`/grants/applications/${id}`);
  },

  // --- Budget Items ---

  async listBudgetItems(applicationId: string): Promise<GrantBudgetItem[]> {
    const response = await api.get<GrantBudgetItem[]>(
      `/grants/applications/${applicationId}/budget-items`,
    );
    return response.data;
  },

  async createBudgetItem(
    applicationId: string,
    data: Partial<GrantBudgetItem>,
  ): Promise<GrantBudgetItem> {
    const response = await api.post<GrantBudgetItem>(
      `/grants/applications/${applicationId}/budget-items`,
      data,
    );
    return response.data;
  },

  async updateBudgetItem(
    _applicationId: string,
    itemId: string,
    data: Partial<GrantBudgetItem>,
  ): Promise<GrantBudgetItem> {
    const response = await api.put<GrantBudgetItem>(
      `/grants/budget-items/${itemId}`,
      data,
    );
    return response.data;
  },

  async deleteBudgetItem(
    _applicationId: string,
    itemId: string,
  ): Promise<void> {
    await api.delete(`/grants/budget-items/${itemId}`);
  },

  // --- Expenditures ---

  async listExpenditures(applicationId: string): Promise<GrantExpenditure[]> {
    const response = await api.get<GrantExpenditure[]>(
      `/grants/applications/${applicationId}/expenditures`,
    );
    return response.data;
  },

  async createExpenditure(
    applicationId: string,
    data: Partial<GrantExpenditure>,
  ): Promise<GrantExpenditure> {
    const response = await api.post<GrantExpenditure>(
      `/grants/applications/${applicationId}/expenditures`,
      data,
    );
    return response.data;
  },

  async updateExpenditure(
    _applicationId: string,
    expenditureId: string,
    data: Partial<GrantExpenditure>,
  ): Promise<GrantExpenditure> {
    const response = await api.put<GrantExpenditure>(
      `/grants/expenditures/${expenditureId}`,
      data,
    );
    return response.data;
  },

  async deleteExpenditure(
    _applicationId: string,
    expenditureId: string,
  ): Promise<void> {
    await api.delete(`/grants/expenditures/${expenditureId}`);
  },

  // --- Compliance Tasks ---

  async listComplianceTasks(
    applicationId?: string,
  ): Promise<GrantComplianceTask[]> {
    const response = await api.get<GrantComplianceTask[]>(
      '/grants/compliance-tasks',
      { params: { application_id: applicationId } },
    );
    return response.data;
  },

  async createComplianceTask(
    applicationId: string,
    data: Partial<GrantComplianceTask>,
  ): Promise<GrantComplianceTask> {
    const response = await api.post<GrantComplianceTask>(
      `/grants/applications/${applicationId}/compliance-tasks`,
      data,
    );
    return response.data;
  },

  async updateComplianceTask(
    _applicationId: string,
    taskId: string,
    data: Partial<GrantComplianceTask>,
  ): Promise<GrantComplianceTask> {
    const response = await api.put<GrantComplianceTask>(
      `/grants/compliance-tasks/${taskId}`,
      data,
    );
    return response.data;
  },

  async deleteComplianceTask(
    _applicationId: string,
    taskId: string,
  ): Promise<void> {
    await api.delete(`/grants/compliance-tasks/${taskId}`);
  },

  // --- Notes ---

  async listNotes(applicationId: string): Promise<GrantNote[]> {
    const response = await api.get<GrantNote[]>(
      `/grants/applications/${applicationId}/notes`,
    );
    return response.data;
  },

  async createNote(
    applicationId: string,
    data: Partial<GrantNote>,
  ): Promise<GrantNote> {
    const response = await api.post<GrantNote>(
      `/grants/applications/${applicationId}/notes`,
      data,
    );
    return response.data;
  },

  // --- Dashboard & Reports ---

  async getDashboard(): Promise<GrantsDashboard> {
    const response = await api.get<GrantsDashboard>('/grants/dashboard');
    return response.data;
  },

  async getGrantReport(params?: {
    startDate?: string;
    endDate?: string;
  }): Promise<GrantReport> {
    const response = await api.get<GrantReport>('/grants/reports/grants', {
      params: {
        start_date: params?.startDate,
        end_date: params?.endDate,
      },
    });
    return response.data;
  },

  async getFundraisingReport(params?: {
    startDate?: string;
    endDate?: string;
  }): Promise<FundraisingReport> {
    const response = await api.get<FundraisingReport>(
      '/grants/reports/fundraising',
      {
        params: {
          start_date: params?.startDate,
          end_date: params?.endDate,
        },
      },
    );
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
    const response = await api.get<FundraisingCampaign[]>(
      '/grants/campaigns',
      {
        params: {
          status: params?.status,
          campaign_type: params?.campaignType,
          search: params?.search,
          skip: params?.skip ?? 0,
          limit: params?.limit ?? 100,
        },
      },
    );
    return response.data;
  },

  async getCampaign(id: string): Promise<FundraisingCampaign> {
    const response = await api.get<FundraisingCampaign>(
      `/grants/campaigns/${id}`,
    );
    return response.data;
  },

  async createCampaign(
    data: Partial<FundraisingCampaign>,
  ): Promise<FundraisingCampaign> {
    const response = await api.post<FundraisingCampaign>(
      '/grants/campaigns',
      data,
    );
    return response.data;
  },

  async updateCampaign(
    id: string,
    data: Partial<FundraisingCampaign>,
  ): Promise<FundraisingCampaign> {
    const response = await api.put<FundraisingCampaign>(
      `/grants/campaigns/${id}`,
      data,
    );
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
    return response.data;
  },

  async getDonor(id: string): Promise<Donor> {
    const response = await api.get<Donor>(
      `/grants/donors/${id}`,
    );
    return response.data;
  },

  async createDonor(data: Partial<Donor>): Promise<Donor> {
    const response = await api.post<Donor>(
      '/grants/donors',
      data,
    );
    return response.data;
  },

  async updateDonor(id: string, data: Partial<Donor>): Promise<Donor> {
    const response = await api.put<Donor>(
      `/grants/donors/${id}`,
      data,
    );
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
    const response = await api.get<Donation[]>(
      '/grants/donations',
      {
        params: {
          campaign_id: params?.campaignId,
          donor_id: params?.donorId,
          payment_method: params?.paymentMethod,
          start_date: params?.startDate,
          end_date: params?.endDate,
          skip: params?.skip ?? 0,
          limit: params?.limit ?? 100,
        },
      },
    );
    return response.data;
  },

  async createDonation(data: Partial<Donation>): Promise<Donation> {
    const response = await api.post<Donation>(
      '/grants/donations',
      data,
    );
    return response.data;
  },

  async updateDonation(
    id: string,
    data: Partial<Donation>,
  ): Promise<Donation> {
    const response = await api.put<Donation>(
      `/grants/donations/${id}`,
      data,
    );
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
    const response = await api.get<Pledge[]>(
      '/grants/pledges',
      {
        params: {
          campaign_id: params?.campaignId,
          donor_id: params?.donorId,
          status: params?.status,
          skip: params?.skip ?? 0,
          limit: params?.limit ?? 100,
        },
      },
    );
    return response.data;
  },

  async createPledge(data: Partial<Pledge>): Promise<Pledge> {
    const response = await api.post<Pledge>(
      '/grants/pledges',
      data,
    );
    return response.data;
  },

  async updatePledge(id: string, data: Partial<Pledge>): Promise<Pledge> {
    const response = await api.put<Pledge>(
      `/grants/pledges/${id}`,
      data,
    );
    return response.data;
  },

  // --- Fundraising Events ---

  async listFundraisingEvents(params?: {
    campaignId?: string;
    status?: string;
    skip?: number;
    limit?: number;
  }): Promise<FundraisingEvent[]> {
    const response = await api.get<FundraisingEvent[]>(
      '/grants/fundraising-events',
      {
        params: {
          campaign_id: params?.campaignId,
          status: params?.status,
          skip: params?.skip ?? 0,
          limit: params?.limit ?? 100,
        },
      },
    );
    return response.data;
  },

  async createFundraisingEvent(
    data: Partial<FundraisingEvent>,
  ): Promise<FundraisingEvent> {
    const response = await api.post<FundraisingEvent>(
      '/grants/fundraising-events',
      data,
    );
    return response.data;
  },

  async updateFundraisingEvent(
    id: string,
    data: Partial<FundraisingEvent>,
  ): Promise<FundraisingEvent> {
    const response = await api.put<FundraisingEvent>(
      `/grants/fundraising-events/${id}`,
      data,
    );
    return response.data;
  },
};
