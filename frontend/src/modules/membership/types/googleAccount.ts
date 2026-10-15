/**
 * A member's Google Workspace account, as The Logbook created or found it when
 * they were converted from an applicant. snake_case, like the integrations
 * module that serves it.
 */
import type { GoogleAccountStatus } from '../../../constants/enums';

export interface GoogleAccount {
  user_id: string;
  primary_email: string;
  status: GoogleAccountStatus;
  credentials_sent: boolean;
  pending_groups: string[];
  last_error: string | null;
  attempts: number;
  last_attempt_at: string | null;
  created_at: string | null;
  /** The member's departure wants the account suspended. */
  suspension_wanted: boolean;
  /** False until Google has been brought to `suspension_wanted`. */
  suspension_settled: boolean;
  /** The suspension in place is The Logbook's own; only that one is lifted. */
  suspended_by_logbook: boolean;
  suspended_at: string | null;
  suspension_error: string | null;
}

export interface GoogleAccountEnvelope {
  /** Null for a member The Logbook never made an account for. */
  account: GoogleAccount | null;
}
