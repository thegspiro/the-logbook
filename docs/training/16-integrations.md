# Integrations

The Integrations module connects The Logbook to external services — calendar systems, messaging platforms, CRM tools, dispatch systems, and reporting agencies. Each integration is configured and managed from a central page.

---

## Table of Contents

1. [Integrations Overview](#integrations-overview)
2. [Integration Catalog](#integration-catalog)
3. [Connecting an Integration](#connecting-an-integration)
4. [Salesforce CRM](#salesforce-crm)
5. [Calendar Integrations](#calendar-integrations)
6. [Messaging Integrations](#messaging-integrations)
7. [Weather Alerts](#weather-alerts)
8. [EMS & Fire Reporting](#ems--fire-reporting)
9. [Generic Webhooks](#generic-webhooks)
10. [Training Provider Integrations](#training-provider-integrations)
11. [Monitoring Integration Health](#monitoring-integration-health)
12. [Troubleshooting](#troubleshooting)

---

## Integrations Overview

**Required Permission:** `settings.manage`

Navigate to **Settings > Integrations** (`/integrations`) to view and manage all external connections.

The integrations page shows:
- **Connected integrations** with status indicators (green = healthy, yellow = error)
- **Available integrations** that can be configured
- **Coming Soon** integrations planned for future releases
- Summary counts: connected vs available

> **[SCREENSHOT NEEDED]:** _Screenshot of the Integrations page showing the catalog grid with connected integrations (green checkmarks), available integrations (gray dots with "Connect" buttons), and coming-soon integrations (dimmed with badges). Show categories: Calendar, Messaging, CRM, Data, Safety._

---

## Integration Catalog

### Currently Available

| Category | Integration | Description |
|----------|-------------|-------------|
| **Calendar** | Google Calendar | Two-way event sync |
| **Calendar** | Microsoft Outlook | Calendar and contact sync |
| **Calendar** | iCalendar (ICS) | Subscribe to filtered ICS feed URLs |
| **Messaging** | Slack | Event alerts, training reminders, custom channels |
| **Messaging** | Discord | Webhook notifications, event reminders |
| **Messaging** | Microsoft Teams | Adaptive Cards, channel notifications |
| **CRM** | Salesforce | Contact sync, donor management, bidirectional |
| **Data** | CSV Import/Export | Member import, training/inventory export |
| **Data** | Generic Webhooks | HMAC-signed event notifications to any URL |
| **Safety** | NWS Weather Alerts | Tornado, flood, fire weather alerts (free) |
| **Reporting** | Generic ePCR Import | CSV or NEMSIS XML from any ePCR vendor |
| **Reporting** | NEMSIS Response Module Export | NEMSIS 3.5 format for state EMS reporting |
| **Reporting** | NFIRS Export | NFIRS 5.0 format for state fire marshal |

### Coming Soon

| Integration | Description |
|-------------|-------------|
| WhatsApp | Notifications and group messages |
| Active911 | Dispatch alerts and mapping |
| PulsePoint | CPR alerts and AED locations |
| ImageTrend ePCR | ePCR sync and run reports |
| ESO Solutions | ePCR data exchange |
| NREMT Certification | Certification status verification |
| Google Maps | Hydrant mapping and pre-plans |
| Zapier | Connect to 5,000+ apps |

---

## Connecting an Integration

1. Find the integration in the catalog
2. Click **Connect**
3. Fill in the configuration fields (vary by integration type)
4. Click **Test Connection** to verify credentials
5. Save to activate

> **[SCREENSHOT NEEDED]:** _Screenshot of an integration connection dialog (e.g., Slack) showing the webhook URL field, test connection button, and save button._

---

## Salesforce CRM

The Salesforce integration provides **bidirectional sync** between The Logbook and Salesforce for contacts, training records, events, and donors.

### Configuration

| Field | Description |
|-------|-------------|
| **Instance URL** | Your Salesforce org URL (e.g., `https://yourorg.my.salesforce.com`) |
| **Client ID** | Connected App client ID from Salesforce Setup |
| **Client Secret** | OAuth client secret |
| **Refresh Token** | OAuth refresh token (obtained via OAuth flow) |
| **Environment** | `production` or `sandbox` |
| **Sync Direction** | `push` (Logbook → SF), `pull` (SF → Logbook), or `both` |

### Sync Types

| Action | Description |
|--------|-------------|
| **Push Members** | Sync all active members to Salesforce contacts |
| **Push Training** | Sync training records and certifications |
| **Push Events** | Sync department events |
| **Pull Contacts** | Import Salesforce contacts to Logbook |

### How to Sync

1. Navigate to the connected Salesforce integration
2. Click the sync action you want (e.g., "Push Members")
3. The system syncs data and reports success/failure counts
4. Check the **Status** tab for sync history and any errors

> **[SCREENSHOT NEEDED]:** _Screenshot of the Salesforce integration detail page showing the connection status (green), last sync timestamp, sync action buttons (Push Members, Push Training, Push Events, Pull Contacts), and recent sync history table._

### Field Mappings

The system maps internal fields to Salesforce fields automatically. View the current mapping via **View Field Mappings** on the integration detail page.

### Webhook Integration

Salesforce can push contact updates back to The Logbook via a webhook at `POST /api/v1/webhooks/salesforce`. The webhook validates the request signature before processing.

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Salesforce API rate limit hit | Retried with exponential backoff |
| Field mapping mismatch | Warning logged; unmatched fields skipped |
| Sandbox vs production mismatch | Warning shown; data won't sync to production from sandbox |
| OAuth token expired | Auto-refreshed transparently |
| Conflict on bidirectional sync | Last-write-wins with conflict logged |

---

## Calendar Integrations

### Google Calendar

Sync department events with Google Calendar:

1. Connect with Google OAuth credentials
2. Select which calendars to sync
3. Events created in The Logbook automatically appear in Google Calendar
4. Two-way sync updates events in both directions

### Microsoft Outlook

Sync with Outlook/Exchange calendars:

1. Connect with Microsoft 365 credentials
2. Events and contacts sync between platforms
3. Email notifications can be sent via Outlook

### iCalendar (ICS) Feed

Generate subscribe-able ICS feed URLs:

1. Enable the ICS integration
2. Copy the generated feed URL
3. Subscribe in any calendar app (Google, Apple, Outlook)
4. The feed auto-updates as events change
5. Filtered feeds available (e.g., only training events, only your shifts)

> **[SCREENSHOT NEEDED]:** _Screenshot of the iCalendar configuration showing generated feed URLs for different filters (All Events, Training Only, My Shifts) with copy buttons._

---

## Messaging Integrations

### Slack

1. Create an incoming webhook in your Slack workspace settings
2. Paste the webhook URL in the integration configuration
3. Select which events trigger notifications (new members, training completed, events scheduled)
4. Messages appear in your configured Slack channel

### Discord

1. Create a webhook in your Discord server settings
2. Paste the webhook URL
3. Configure event triggers
4. Notifications appear as bot messages in your channel

### Microsoft Teams

1. Create an incoming webhook connector in your Teams channel
2. Paste the webhook URL
3. Notifications appear as Adaptive Cards with action buttons

> **[SCREENSHOT NEEDED]:** _Screenshot of the messaging integration configuration showing the webhook URL field, event trigger checkboxes (New Member, Training Completed, Event Scheduled, Shift Change), and a test notification button._

---

## Weather Alerts

The **NWS Weather Alerts** integration pulls tornado, flood, and fire weather warnings from NOAA — free, no API key required.

### Configuration

| Field | Description |
|-------|-------------|
| **NWS Zone ID** | Your area's zone code (format: `[STATE][C or Z][3DIGITS]`, e.g., `VAZ053`) |

### How It Works

- System checks the NOAA API hourly for active alerts in your zone
- Active alerts display on the department dashboard
- Alert types: Tornado Warning, Flood Warning, Fire Weather Watch, etc.

> **Hint:** Find your NWS Zone ID at [weather.gov/pdd/gis](https://www.weather.gov/pdd/gis) — search by county or zone.

---

## EMS & Fire Reporting

### Generic ePCR Import

Import patient care report data from any ePCR vendor:

1. Export data from your ePCR system as CSV or NEMSIS XML
2. Navigate to the ePCR integration
3. Upload the export file
4. System parses and imports run/call data
5. Data feeds into scheduling reports and compliance tracking

Supported vendors: ImageTrend, ESO, Zoll, or any vendor that exports CSV/NEMSIS XML.

### NEMSIS Response Module Export

Export response data in NEMSIS 3.5 format for state EMS reporting:

1. Configure your state code and agency ID
2. Select the date range to export
3. Generate the NEMSIS XML file
4. Submit to your state EMS reporting system

### NFIRS Export

Export incident data in NFIRS 5.0 format for state fire marshal reporting:

1. Configure your state code and FDID (Fire Department ID)
2. Select the reporting period
3. Generate the NFIRS export file
4. Submit to your state fire marshal office

> **[SCREENSHOT NEEDED]:** _Screenshot of the NFIRS Export configuration showing state code dropdown, FDID field, date range selector, and Generate Export button._

---

## Generic Webhooks

Send event notifications to any external system via HTTP POST:

### Configuration

| Field | Description |
|-------|-------------|
| **Webhook URL** | Your endpoint that receives POST requests |
| **Secret** | Optional HMAC signing secret for `X-Webhook-Signature` header |

### Payload Format

```json
{
  "event": "member_created",
  "timestamp": "2026-06-27T14:30:00Z",
  "data": {
    "member_id": "...",
    "name": "John Smith",
    "email": "john@example.com"
  }
}
```

### Security

- Requests include an `X-Webhook-Signature` header (HMAC-SHA256 of the payload body)
- Your endpoint should validate the signature before processing
- Failed deliveries are retried with exponential backoff

### Available Events

Events you can subscribe to include: member created/updated, training completed, event scheduled, shift changed, inventory assigned, and more.

---

## Training Provider Integrations

Training provider integrations are configured from **Training Admin > Integrations** (separate from the general integrations page). See [Training & Certification > External Training Integrations](./02-training.md#external-training-integrations) for details.

Available training providers:
- **Vector Solutions** — Category catalog fetch, credit hours, auto-sync
- **Target Solutions** — Training record import
- **Lexipol** — Policy training sync
- **iAmResponding** — Response tracking
- **Custom API** — Generic webhook-based provider

---

## Monitoring Integration Health

The integrations dashboard shows health status for each connected integration:

| Indicator | Meaning |
|-----------|---------|
| **Green checkmark** | Connected and healthy — last sync successful |
| **Yellow warning** | Connected but last sync failed — check error details |
| **Gray dot** | Not connected — available to configure |
| **Red X** | Connection lost — credentials may have expired |

Click any integration to see:
- Last sync timestamp
- Last error message (if any)
- Consecutive error count
- Sync history

> **[SCREENSHOT NEEDED]:** _Screenshot of an integration detail page showing a yellow warning status, the error message "Salesforce API rate limit exceeded", consecutive error count (2), and a "Retry Sync" button._

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Integration shows "Connection failed" | Verify credentials haven't expired. Click "Test Connection" to diagnose. |
| Salesforce sync shows field mapping errors | Check field mappings via the integration detail page. Ensure Salesforce fields exist. |
| Webhook not receiving events | Verify your endpoint is reachable from the internet. Check the webhook URL. Test with a curl command. |
| Weather alerts not showing | Verify your NWS Zone ID is correct. Check that the NOAA API is responding. |
| ICS feed not updating | Allow up to 1 hour for calendar apps to refresh. Verify the feed URL is correct. |
| ePCR import fails | Check the file format (CSV or NEMSIS XML). Ensure column headers match expected format. |
| Slack notifications not appearing | Verify the webhook URL in Slack workspace settings. Check channel permissions. |
| OAuth token expired | Most integrations auto-refresh tokens. If persistent, disconnect and reconnect. |
| PHI data in integration | ePCR and medical integrations are flagged as containing PHI. Data is processed and deleted after import per HIPAA requirements. |

---

**Previous:** [Prospective Members Pipeline](./15-prospective-members.md)
