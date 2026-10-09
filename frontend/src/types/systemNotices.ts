/**
 * Installation-level conditions an administrator must be told about
 * (GET /system-notices). Snake-case like its backend schema module.
 */
export interface SystemNotice {
  key: string;
  severity: 'warning' | 'critical';
  title: string;
  detail: string;
  /** Something the administrator can do here to clear the notice, if any. */
  action?: 'confirm_key_custody' | null | undefined;
}

/** GET/POST /system-notices/encryption-key-custody. */
export interface KeyCustodyStatus {
  /** An HMAC identifying the key, never the key itself. */
  key_fingerprint: string;
  confirmed: boolean;
  confirmed_at?: string | null | undefined;
  confirmed_via?: string | null | undefined;
}
