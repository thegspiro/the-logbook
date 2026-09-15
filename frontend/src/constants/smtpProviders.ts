/**
 * SMTP quick-fill presets for providers the platform has no dedicated tile for.
 *
 * Gmail, Microsoft 365 and Cloudflare are first-class platforms because they
 * need credentials of their own shape — an App Password against a fixed host,
 * an Entra ID app registration, a REST token. Everything else in this list is
 * ordinary SMTP submission, which the `selfhosted` platform already sends
 * perfectly well; what departments did not have was any way to know that. A
 * chief whose department runs on Yahoo or Fastmail reads "Self-Hosted SMTP —
 * your own mail server" and reasonably concludes the platform does not support
 * them, or picks "Other", which stores nothing and cannot send.
 *
 * So this is a labelling fix rather than a transport one: choosing an entry
 * fills in the host, port and encryption the provider documents, and the
 * stored shape is unchanged — still `selfhosted` with the same `smtp_*`
 * fields. Nothing on the backend knows about this list, which is deliberate:
 * these are starting values for three inputs the administrator can still edit,
 * not a second authority on how mail is sent.
 *
 * `credentialHint` is the part that matters most for the providers this list
 * exists for. Yahoo, iCloud, Zoho, Fastmail, AOL and GMX all refuse an account
 * password over SMTP once two-factor sign-in is on and require an app password
 * generated in their own settings — the single most common reason a correct
 * host and port still fails to authenticate.
 */

export interface SmtpProviderPreset {
  id: string;
  label: string;
  host: string;
  port: number;
  encryption: 'tls' | 'ssl';
  /** What the provider expects in the Username field. */
  usernameHint: string;
  /** Which credential the password field takes, and where it comes from. */
  credentialHint: string;
  helpUrl?: string;
}

/**
 * Proton Mail Bridge is deliberately absent. It listens on 127.0.0.1:1025 with
 * a self-signed certificate, and the sender's STARTTLS uses
 * `ssl.create_default_context()` — `check_hostname=True`,
 * `verify_mode=CERT_REQUIRED` — so the handshake fails every time. A preset
 * that cannot connect is worse than no preset: it reads as a supported
 * provider. Supporting it needs a per-connection trust decision the settings
 * model has no field for; relaxing verification globally is not on the table.
 */
export const SMTP_PROVIDER_PRESETS: SmtpProviderPreset[] = [
  {
    id: 'yahoo',
    label: 'Yahoo Mail',
    host: 'smtp.mail.yahoo.com',
    port: 465,
    encryption: 'ssl',
    usernameHint: 'Your full Yahoo address',
    credentialHint: 'An app password generated in Yahoo Account Security — not your account password.',
    helpUrl: 'https://login.yahoo.com/account/security',
  },
  {
    id: 'icloud',
    label: 'iCloud Mail',
    host: 'smtp.mail.me.com',
    port: 587,
    encryption: 'tls',
    usernameHint: 'Your iCloud address',
    credentialHint: 'An app-specific password from appleid.apple.com. Two-factor authentication must be on.',
    helpUrl: 'https://account.apple.com/account/manage',
  },
  {
    id: 'zoho',
    label: 'Zoho Mail',
    host: 'smtp.zoho.com',
    port: 587,
    encryption: 'tls',
    usernameHint: 'Your full Zoho address',
    credentialHint:
      'An application-specific password from Zoho Account Security if two-factor sign-in is on. EU accounts use smtp.zoho.eu.',
    helpUrl: 'https://accounts.zoho.com/home#security',
  },
  {
    id: 'fastmail',
    label: 'Fastmail',
    host: 'smtp.fastmail.com',
    port: 465,
    encryption: 'ssl',
    usernameHint: 'Your full Fastmail address',
    credentialHint: 'An app password created in Fastmail Settings → Privacy & Security, with SMTP access.',
    helpUrl: 'https://app.fastmail.com/settings/security/apps',
  },
  {
    id: 'aol',
    label: 'AOL Mail',
    host: 'smtp.aol.com',
    port: 465,
    encryption: 'ssl',
    usernameHint: 'Your full AOL address',
    credentialHint: 'An app password generated in AOL Account Security.',
  },
  {
    id: 'gmx',
    label: 'GMX',
    host: 'mail.gmx.com',
    port: 587,
    encryption: 'tls',
    usernameHint: 'Your full GMX address',
    credentialHint: 'Your GMX password. POP3/IMAP access must be enabled in GMX settings first.',
  },
  {
    id: 'sendgrid',
    label: 'SendGrid',
    host: 'smtp.sendgrid.net',
    port: 587,
    encryption: 'tls',
    usernameHint: 'The literal word "apikey"',
    credentialHint: 'Your SendGrid API key, used as the password. The username is always "apikey".',
  },
  {
    id: 'ses',
    label: 'Amazon SES',
    host: 'email-smtp.us-east-1.amazonaws.com',
    port: 587,
    encryption: 'tls',
    usernameHint: 'Your SES SMTP username (not an AWS access key ID)',
    credentialHint:
      'SMTP credentials generated in the SES console. Change the region in the host to match your SES region.',
  },
  {
    id: 'mailgun',
    label: 'Mailgun',
    host: 'smtp.mailgun.org',
    port: 587,
    encryption: 'tls',
    usernameHint: 'postmaster@your-domain',
    credentialHint: 'The SMTP password shown for that domain in the Mailgun dashboard.',
  },
  {
    id: 'postmark',
    label: 'Postmark',
    host: 'smtp.postmarkapp.com',
    port: 587,
    encryption: 'tls',
    usernameHint: 'Your Postmark server API token',
    credentialHint: 'The same server API token is used as both username and password.',
  },
  {
    id: 'brevo',
    label: 'Brevo',
    host: 'smtp-relay.brevo.com',
    port: 587,
    encryption: 'tls',
    usernameHint: 'Your Brevo login address',
    credentialHint: 'An SMTP key from Brevo → SMTP & API, not your account password.',
  },
  {
    id: 'mailjet',
    label: 'Mailjet',
    host: 'in-v3.mailjet.com',
    port: 587,
    encryption: 'tls',
    usernameHint: 'Your Mailjet API key',
    credentialHint: 'Your Mailjet secret key, used as the password.',
  },
];

export const findSmtpProviderPreset = (id: string): SmtpProviderPreset | undefined =>
  SMTP_PROVIDER_PRESETS.find((preset) => preset.id === id);
