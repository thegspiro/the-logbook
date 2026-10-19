# Workflow Review — W73 Integrations

**Driven:** 2026-10-17 · **As:** `admin`, with `chief`, `secretary`, `member` for access · **Viewports:** 1280×900, 390×844
**Commit:** `origin/main` of 2026-10-15 plus this run's changes · **Database:** continued from W72

---

## What was driven

1. As `admin`, `/integrations`: the 27-entry catalog, the search ("iCal")
   and the category filters.
2. iCalendar (ICS): Connect (double-clicked), Test, then Disconnect; its
   Details page.
3. Slack:
   - Connect with `http://127.0.0.1:1/hook`, then with a Slack-shaped URL;
   - through the API, a connect with no config at all;
   - after the fixes, at 390×844, Disconnect → Keep it connected, then
     Disconnect → Disconnect.
4. Access: `chief`, `secretary`, `member` on the page, `GET /integrations`
   and `GET /integrations/connected`.

Not driven:

- any integration that needs a real outside service (Slack delivery, Google,
  Salesforce, PayPal, Cal.com, Documenso, NWS); the sandbox has no outbound
  DNS, so `hooks.slack.com` does not resolve;
- the Claude (MCP) key flow, which is covered by its own suites.

## Held up ✅

- A double-clicked Connect made one connection; Test on iCal answers "iCal
  feeds are read-only — no connection test needed".
- A loopback webhook URL and an unresolvable host are both refused (400) by
  the server's URL check.
- `chief` (`integrations.manage`) manages the page. `secretary` and `member`
  see Access Denied and get 403 on the list. `GET /integrations/connected`
  gives every member only each integration's type and on/off state, which the
  navigation uses.
- Disconnect keeps an integration's stored settings, as the new confirmation
  says (read from `disconnect_integration`).
- 390×844: no sideways scroll and no control under 44px.

## Findings

### W73-1 — MED — Disconnect acted on one tap, including the one that revokes every Claude key — ✅ FIXED

**Did:** iCalendar → Disconnect.
**Saw:** disconnected at once, no confirmation.
**Why it matters:** for Claude (MCP), disconnect also revokes every service
key and ends every member's own connection; reconnecting restores neither
(read from `disconnect_integration`). For a messaging integration it silently
stops the department's alerts.
**Where:** `IntegrationsPage.tsx` `handleDisconnect`.
**Fix:**

- A confirmation, "Disconnect Slack? Slack stops working for the department
  until it is connected again. Its saved settings are kept.", with Keep it
  connected / Disconnect ("Deactivate" for activation-type integrations).
- For Claude (MCP), a danger-styled confirmation naming the revoked keys and
  ended connections.

Re-driven both ways at 390×844. `IntegrationsPage.test.tsx`.

### W73-2 — LOW — Every card's buttons read "Connect", "Disconnect", "Test" — ✅ FIXED

Searching "iCal" left three cards with three identical "Connect" buttons (the
search also matches "med**ical**"), and the first opened Claude (MCP)'s
dialog. They are now "Connect iCalendar (ICS)", "Disconnect Slack", "Test
Slack". One existing test that found the bare "Connect" was updated to the
name.

### W73-3 — LOW — A connect with no settings left Slack "connected" with no webhook — ✅ FIXED

**Did:** `POST /integrations/{slack}/connect` with an empty body.
**Saw:** 200, `status: connected`, `enabled: true`, `config: {}`.
`_validate_config` validates only a non-empty config, so the required
`webhook_url` was never checked. The screen always sends one; the API did
not insist.
**Fix:** connect refuses when a required setting is in neither the request
nor what is stored, public or secret: "Slack needs: webhook_url". A
reconnect after a disconnect, which sends nothing because the settings were
kept, still works. `tests/test_integration_connect_required_fields.py` (the
refusal case fails without the fix).

### W73-4 — LOW — The Slack / Discord / Teams webhook field had no label — ✅ FIXED

"Webhook URL" was a `<label>` with no `htmlFor`; the generic webhook's field
already had one. Now tied (`messaging-webhook-url`).

### W73-5 — MED — The iCalendar integration is a switch with no reader — FLAGGED

**Did:** connected iCalendar (ICS).
**Saw:**

- status Connected;
- no feed URL anywhere on the card, its Details or its dialog;
- `config: {}`.

The catalog promises "Subscribe to department events via standard iCal feed
URL … Filtered feeds", and `ICalConfig` has `feed_token`,
`included_event_types` and `include_shifts`. Nothing reads any of them, or
the integration's status. The working calendar feed is each member's
personal shift feed (`GET /scheduling/calendar-feed` →
`/api/public/v1/calendar/{token}.ics`), which works whether or not this is
connected.
**Why flagged, not fixed:** the catalog row is seeded per organization, and
the choice is between building a department events feed and marking the
entry unavailable or pointing it at the shift feed. Pitfall 19. Mirrored to
KNOWN_LIMITATIONS.

## Checklist

| Section                 | Result                                                         |
| ----------------------- | -------------------------------------------------------------- |
| 1. The job gets done    | ⚠️ connect, test, disconnect work; iCal does nothing (flagged) |
| 2. The right people     | ✅ manage holders only; members see only on/off state          |
| 3. Wrong input, failure | ❌ → ✅ empty-config connect now refused; bad URLs refused     |
| 4. Browser signals      | ✅ only the intended 400s                                      |
| 5. Coming back to it    | ✅ state checked from the API after each step                  |
| 6. On a phone           | ✅ no sideways scroll; no control under 44px                   |
| 7. Everyone can use it  | ❌ → ✅ card buttons named; webhook field labelled             |
| 8. What happens around  | ❌ → ✅ disconnect now says what it ends                       |

## Completion gate

| Check                    | Result                                                    |
| ------------------------ | --------------------------------------------------------- |
| npm run typecheck        | ✅ clean                                                  |
| npm run lint             | ✅ clean                                                  |
| flake8 (changed files)   | ✅ clean                                                  |
| black --check            | ✅ clean                                                  |
| frontend tests (touched) | ✅ `IntegrationsPage` / `IntegrationDetailPage` 49 passed |
| backend tests (touched)  | ✅ integrations, MCP keys and the new file: 121 passed    |
