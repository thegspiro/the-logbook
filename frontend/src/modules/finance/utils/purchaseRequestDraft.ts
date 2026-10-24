/**
 * What the purchase request form sends, and when the server can hold it.
 *
 * Create omits blank optional fields so an empty string never reaches a
 * Pydantic validator. Update sends every field the form owns, a blank one as
 * an explicit null, because an omitted key means "leave this alone" and the
 * old value would survive an emptied box (CLAUDE.md pitfall #1).
 */

import { blankToNull } from '@/utils/formValues';
import type { PurchaseRequest, PurchaseRequestPriority } from '../types';

export interface PurchaseRequestFormValues {
  title: string;
  description?: string | undefined;
  vendor?: string | undefined;
  estimatedAmount: number;
  priority: string;
  budgetId?: string | undefined;
  fundCampaignId?: string | undefined;
  fiscalYearId: string;
}

/**
 * The create endpoint requires a title, a fiscal year and an amount above
 * zero, so a draft cannot exist on the server before the form has all three.
 */
export const canSaveDraft = (values: PurchaseRequestFormValues): boolean =>
  values.title.trim().length > 0 && values.fiscalYearId.length > 0 && Number(values.estimatedAmount) > 0;

export function createPurchaseRequestPayload(values: PurchaseRequestFormValues): Partial<PurchaseRequest> {
  const payload: Partial<PurchaseRequest> = {
    title: values.title.trim(),
    estimatedAmount: Number(values.estimatedAmount).toFixed(2),
    priority: values.priority as PurchaseRequestPriority,
    fiscalYearId: values.fiscalYearId,
  };
  const description = values.description?.trim();
  if (description) payload.description = description;
  const vendor = values.vendor?.trim();
  if (vendor) payload.vendor = vendor;
  if (values.budgetId) payload.budgetId = values.budgetId;
  if (values.fundCampaignId) payload.fundCampaignId = values.fundCampaignId;
  return payload;
}

export function updatePurchaseRequestPayload(values: PurchaseRequestFormValues): Partial<PurchaseRequest> {
  return {
    title: values.title.trim(),
    estimatedAmount: Number(values.estimatedAmount).toFixed(2),
    priority: values.priority as PurchaseRequestPriority,
    fiscalYearId: values.fiscalYearId,
    description: blankToNull(values.description),
    vendor: blankToNull(values.vendor),
    budgetId: values.budgetId || null,
    fundCampaignId: values.fundCampaignId || null,
  };
}
