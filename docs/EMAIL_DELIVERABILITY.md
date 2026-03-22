# Email Deliverability Setup Guide

This guide covers the DNS records and SMTP configuration needed to ensure
emails sent by The Logbook are accepted by Gmail, Microsoft 365 / Outlook,
and other major providers.

## Quick Checklist

| Requirement | Gmail | Microsoft | Where |
|-------------|-------|-----------|-------|
| SPF record | Required | Required | DNS TXT |
| DKIM signing | Required (bulk) | Required | DNS TXT + SMTP relay |
| DMARC policy | Required (bulk) | Required | DNS TXT |
| Reverse DNS (PTR) | Recommended | Required | Hosting provider |
| TLS encryption | Required | Required | `SMTP_ENCRYPTION=tls` |
| Valid EHLO hostname | Recommended | Required | `SMTP_EHLO_HOSTNAME` |
| `Message-ID` header | Required | Required | Automatic (app code) |
| `List-Unsubscribe` header | Required (bulk) | Required (bulk) | Automatic for ballot emails |

## 1. SPF Record

SPF tells receiving servers which IPs are allowed to send email for your
domain. Without it, Gmail and Microsoft will reject or junk your messages.

Add a DNS TXT record on your sending domain (the domain in `SMTP_FROM_EMAIL`):

```
Type:  TXT
Name:  @  (or your subdomain, e.g. mail)
Value: v=spf1 include:_spf.google.com ~all
```

Replace the `include:` with your SMTP provider:

| Provider | SPF include |
|----------|-------------|
| Google Workspace | `include:_spf.google.com` |
| Microsoft 365 | `include:spf.protection.outlook.com` |
| Amazon SES | `include:amazonses.com` |
| SendGrid | `include:sendgrid.net` |
| Mailgun | `include:mailgun.org` |
| Self-hosted | `ip4:YOUR.SERVER.IP` |

> **Important:** Only one SPF record per domain. If you have multiple
> senders, combine them: `v=spf1 include:_spf.google.com include:sendgrid.net ~all`

## 2. DKIM Signing

DKIM adds a cryptographic signature to each email proving it came from your
domain. This is typically configured at the **SMTP relay level**, not in
application code.

### Hosted SMTP relays (recommended)

Most hosted SMTP services handle DKIM signing automatically once you add
their DNS records:

- **Google Workspace:** Admin Console > Apps > Google Workspace > Gmail >
  Authenticate email. Add the provided TXT record.
- **Microsoft 365:** Exchange Admin > Protection > DKIM. Enable and add
  the CNAME records.
- **SendGrid:** Settings > Sender Authentication > Authenticate Your Domain.
- **Amazon SES:** Verified Identities > Domain > DKIM. Add the 3 CNAME records.
- **Mailgun:** Domain Settings > DNS Records. Add the TXT record.

### Self-hosted SMTP

If running your own SMTP server (Postfix, etc.), install and configure
OpenDKIM:

```bash
# Example for Postfix + OpenDKIM on Ubuntu
apt install opendkim opendkim-tools
opendkim-genkey -s mail -d yourdomain.com
# Add the generated DNS TXT record, then configure Postfix to use OpenDKIM
```

## 3. DMARC Policy

DMARC ties SPF and DKIM together and tells receivers what to do when
authentication fails. Both Gmail and Microsoft require DMARC for bulk
senders.

Add a DNS TXT record:

```
Type:  TXT
Name:  _dmarc
Value: v=DMARC1; p=none; rua=mailto:dmarc-reports@yourdomain.com
```

Start with `p=none` (monitor only), then move to `p=quarantine` or
`p=reject` once you confirm legitimate emails are passing:

| Policy | Effect |
|--------|--------|
| `p=none` | Monitor only (receive reports, no action) |
| `p=quarantine` | Failing messages go to spam |
| `p=reject` | Failing messages are blocked |

## 4. Reverse DNS (PTR Record)

Microsoft specifically checks that the sending IP has a valid PTR record
(reverse DNS) that matches the EHLO hostname. Without it, emails may be
rejected outright.

- **Cloud hosting (AWS, GCP, Azure):** Request a PTR record through your
  provider's support or console.
- **VPS/dedicated:** Contact your hosting provider to set the PTR record
  to match your sending domain.

## 5. Application Configuration

### Environment Variables

```bash
# Required for email
EMAIL_ENABLED=true
SMTP_HOST=smtp.yourdomain.com        # Your SMTP relay
SMTP_PORT=587                         # 587 for STARTTLS, 465 for SSL
SMTP_USER=your-smtp-user
SMTP_PASSWORD=your-smtp-password
SMTP_FROM_EMAIL=noreply@yourdomain.com
SMTP_FROM_NAME="Your Organization"
SMTP_ENCRYPTION=tls                   # tls, ssl, or none

# Recommended: EHLO hostname (defaults to from_email domain)
# Must resolve in DNS and match your PTR record
SMTP_EHLO_HOSTNAME=mail.yourdomain.com
```

### What the app handles automatically

These headers are set by the application code and require no configuration:

- **`Message-ID`** — Unique `<uuid@domain>` per email (RFC 5322)
- **`List-Unsubscribe`** — Set on ballot notification emails with the
  admin contact's mailto address (RFC 8058)
- **`List-Unsubscribe-Post`** — One-click unsubscribe support (RFC 8058)
- **`Reply-To`** — Set to the election admin's email on ballot notifications
- **EHLO hostname** — Uses `SMTP_EHLO_HOSTNAME` or the `SMTP_FROM_EMAIL`
  domain instead of the container's local hostname

## 6. Testing Your Setup

### Verify DNS records

```bash
# SPF
dig TXT yourdomain.com +short

# DKIM (replace "mail" with your DKIM selector)
dig TXT mail._domainkey.yourdomain.com +short

# DMARC
dig TXT _dmarc.yourdomain.com +short

# Reverse DNS
dig -x YOUR.SERVER.IP +short
```

### Online testing tools

- **[mail-tester.com](https://www.mail-tester.com/)** — Send a test email
  and get a 1-10 deliverability score with specific recommendations
- **[MXToolbox](https://mxtoolbox.com/SuperTool.aspx)** — Check SPF, DKIM,
  DMARC, blacklists, and PTR records
- **[Google Postmaster Tools](https://postmaster.google.com/)** — Monitor
  your domain's reputation with Gmail (requires domain verification)
- **Microsoft SNDS** — Apply at
  [sendersupport.olc.protection.outlook.com](https://sendersupport.olc.protection.outlook.com/)
  to monitor your IP reputation with Outlook/Hotmail

### Common rejection codes

| Code | Meaning | Fix |
|------|---------|-----|
| 550 5.7.1 | SPF fail | Add/fix SPF record |
| 550 5.7.26 | DMARC fail | Align SPF/DKIM with From domain |
| 421 4.7.0 | Rate limited | Reduce send rate (app handles this) |
| 550 5.7.1 (Microsoft) | PTR mismatch | Set reverse DNS to match EHLO hostname |
| 421 RP-001 (Microsoft) | IP reputation | Warm up IP gradually, check blacklists |

## 7. Microsoft-Specific Notes

Microsoft's mail filtering (Exchange Online Protection / EOP) is stricter
than Gmail in several areas:

1. **PTR record is mandatory** — Microsoft will reject email from IPs
   without valid reverse DNS. Gmail is more lenient here.
2. **EHLO hostname must resolve** — The hostname announced in EHLO must
   have a valid A/AAAA record. The app now sends the `SMTP_FROM_EMAIL`
   domain (or `SMTP_EHLO_HOSTNAME`) instead of the container hostname.
3. **IP reputation matters more** — New IPs start with low reputation.
   Warm up gradually: start with 50-100 emails/day and increase over 2-4
   weeks.
4. **Junk Mail Reporting Program (JMRP)** — Register at
   [sendersupport.olc.protection.outlook.com](https://sendersupport.olc.protection.outlook.com/)
   to receive feedback when users mark your email as spam.
5. **Throttling is aggressive** — Microsoft may throttle to ~30 messages
   per connection. The app's batch sender handles this with automatic
   reconnection and backoff.

## 8. Application-Level Improvements (2026-03-22)

The following changes were made in the application code to improve email
deliverability without requiring DNS or SMTP configuration changes:

| Improvement | Description |
|-------------|-------------|
| **Message-ID header** | All outgoing emails include a proper RFC 5322 `Message-ID` header, satisfying Gmail and Microsoft authentication checks |
| **Batch rate limiting** | Large recipient lists are rate-limited per batch to avoid triggering bulk-send throttles (Gmail: ~100/min, Microsoft: ~30/connection) |
| **Inline CSS** | All email template styles are inlined directly on HTML elements. Gmail strips `<style>` tags from email bodies, so inline styles ensure consistent rendering |
| **SMTP connection reuse** | SMTP connections are reused within a batch send operation, reducing connection overhead and improving throughput for large batches |
| **Hosted logo images** | Organization logos use hosted image URLs instead of base64 data URIs. Gmail clips emails exceeding ~102 KB, and base64-encoded logos easily push emails past this limit |
| **Admin email templates** | Administrators can send emails using saved templates directly from the admin interface |

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Logo image URL not accessible | Falls back to text-only header with organization name |
| Batch > 50 recipients (Gmail) | Rate-limited with 1-second delays between sub-batches |
| Email client without CSS support | Inline styles ensure basic formatting is preserved |
| SMTP connection timeout mid-batch | Automatic reconnection and retry for remaining recipients |
