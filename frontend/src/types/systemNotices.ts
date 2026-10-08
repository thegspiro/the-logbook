/**
 * Installation-level conditions an administrator must be told about
 * (GET /system-notices). Snake-case like its backend schema module.
 */
export interface SystemNotice {
  key: string;
  severity: 'warning' | 'critical';
  title: string;
  detail: string;
}
