# The Logbook — Improvement Proposals

Research-driven proposals for expanding and improving The Logbook, based on a review of competing fire department intranet systems, industry-standard RMS platforms, and current market trends (March 2026).

---

## Current Feature Inventory

The Logbook already covers substantial ground:

| Area | Current Coverage |
|------|-----------------|
| **Auth & Security** | httpOnly cookies, CSRF, TOTP/MFA, OAuth, LDAP, SAML, IP security, audit logging, HIPAA compliance |
| **Events & RSVP** | Event creation, RSVP, QR check-in, templates, recurrence, external attendees |
| **Training** | Courses, records, requirements, sessions, programs, phases, milestones, enrollments, skill evaluations/checkoffs, waivers, external provider sync, self-reporting, shift completion reports |
| **Apparatus** | Types, statuses, custom fields, photos, documents, maintenance, fuel logs, operators, equipment, location/status history, NFPA compliance, components, service providers |
| **Inventory** | Categories, items, assignments, issuances, check-out/in, maintenance records, departure clearances, equipment requests, storage areas, write-offs, NFPA compliance/inspections/exposure tracking |
| **Facilities** | Types, statuses, photos, documents, maintenance, systems, inspections, utilities, access keys, rooms, emergency contacts, shutoff locations, capital projects, insurance, occupants, compliance checklists |
| **Scheduling** | Shift templates, patterns, assignments, swap requests, time off |
| **Documents** | Folders (with visibility), documents (with status/type) |
| **Elections** | Elections, candidates, voting tokens, votes |
| **Meetings & Minutes** | Meeting types, attendees, action items, templates, motions |
| **Membership Pipeline** | Pipeline stages, prospective members, step progress, activity logs, prospect documents, election packages |
| **Onboarding** | Status tracking, checklist items, sessions |
| **Communications** | Notification rules, logs, department messages, email templates, scheduled emails |
| **Forms** | Dynamic form builder, fields, submissions, integrations |
| **Reports & Analytics** | Analytics events, saved reports, platform analytics |
| **Admin Hours** | Categories, entries (with methods and statuses) |
| **Public Portal** | Config, API keys, access logs, data whitelists |
| **Integrations** | Integration model (extensible) |
| **Module Flags** | Training, Compliance, Scheduling, Inventory, Meetings, Elections (off), Fundraising (off) |

---

## Proposals

### 1. Incident Reporting & NERIS Integration

**Gap:** The Logbook has no incident/run reporting module. This is the single most critical gap — incident reporting is the core function of every fire department RMS.

**What competitors offer:**
- NERIS-compliant incident data collection (multi-category incident types, near-real-time submission)
- NFIRS-to-NERIS migration tools
- CAD integration for auto-populating dispatch timestamps
- Run reports with personnel, apparatus, response times, and narrative fields
- ePCR (electronic Patient Care Reporting) for EMS runs

**Proposed scope:**

| Component | Description |
|-----------|-------------|
| `IncidentReport` model | Incident number, date/time dispatched/en-route/on-scene/cleared, incident type(s) (up to 3 per NERIS), address/GPS, narrative, mutual aid given/received |
| `IncidentPersonnel` model | Which members responded, their roles, on-scene actions |
| `IncidentApparatus` model | Which apparatus responded, timestamps per unit |
| `IncidentCasualty` model | Civilian/firefighter injuries/fatalities (NERIS-required fields) |
| NERIS export | API-based data export conforming to the NERIS V1 Data Exchange spec |
| Dashboard widgets | Run volume trends, response time distributions, incident type breakdown |
| Mobile-first entry | Field-friendly forms for on-scene or post-run documentation |

**Implementation complexity:** Large — new module with 5+ models, API endpoints, frontend pages, and external API integration. Could be phased: Phase 1 = basic incident logging, Phase 2 = NERIS export, Phase 3 = CAD integration.

**Feature flag:** `MODULE_INCIDENTS_ENABLED`

---

### 2. Hydrant Management & Pre-Incident Planning

**Gap:** No hydrant inventory, no pre-incident plan (pre-plan) management.

**What competitors offer:**
- Hydrant inventory with GPS coordinates, flow rates, NFPA 291 color coding
- Hydrant inspection scheduling and tracking
- Pre-incident plans linked to occupancies/addresses with floor plans, hazmat info, Knox box locations, utility shutoffs
- GIS map layers for hydrants, buildings, hazard zones
- Automatic hose-lay distance calculations

**Proposed scope:**

| Component | Description |
|-----------|-------------|
| `Hydrant` model | Location (lat/lng), type (wet/dry), flow rate GPM, static/residual pressure, last flow test date, NFPA color class, status (in-service/out-of-service/under-repair), notes |
| `HydrantInspection` model | Inspector, date, results, deficiencies found, photos |
| `PreIncidentPlan` model | Address, occupancy type, construction type, stories, square footage, hazmat present, Knox box, standpipe/sprinkler info, utility shutoffs, key contacts |
| `PrePlanAttachment` model | Floor plan images, site diagrams, photos |
| Map view | Interactive map (Leaflet/Mapbox) showing hydrants color-coded by flow rate, pre-plan locations, apparatus stations |

**Implementation complexity:** Medium-Large — new module, map integration, could leverage existing Facilities infrastructure for some occupancy data.

**Feature flag:** `MODULE_HYDRANTS_ENABLED`

---

### 3. Community Risk Reduction (CRR) & Inspections

**Gap:** No fire prevention inspections, no occupancy tracking, no code enforcement workflow.

**What competitors offer:**
- Occupancy/property database with inspection histories
- Violation tracking with reinspection scheduling
- Permit management (burn permits, fireworks, fire system install)
- Public education event tracking
- Risk scoring by geographic area
- Integration with county assessor/property data

**Proposed scope:**

| Component | Description |
|-----------|-------------|
| `Occupancy` model | Address, occupancy classification, construction type, sprinkler/alarm info, owner/contact, risk score |
| `Inspection` model | Type (annual, complaint, re-inspection), inspector, date, pass/fail, deficiencies, photos, follow-up date |
| `Violation` model | Code reference, description, severity, correction deadline, status (open/corrected/cited) |
| `Permit` model | Type, applicant, issue/expiration dates, conditions, status |
| CRR dashboard | Risk heat map, inspection completion rates, open violation counts |

**Implementation complexity:** Large — full workflow module with scheduling, notifications, and potentially GIS integration. Could share the map infrastructure with Hydrant Management.

**Feature flag:** `MODULE_CRR_ENABLED`

---

### 4. Volunteer Hours & LOSAP Tracking

**Gap:** Admin hours tracking exists but lacks LOSAP (Length of Service Award Program) specifics — point calculations per activity type, annual summaries, compliance thresholds.

**What competitors offer:**
- Activity-based point accrual (incidents, training, drills, meetings, fundraising, standby, maintenance)
- Configurable point values per activity type
- Annual LOSAP compliance reports per member
- Integration with scheduling, training, and incident modules to auto-credit hours
- Export for pension/LOSAP administrators

**Proposed scope:**

| Component | Description |
|-----------|-------------|
| `LOSAPConfig` model | Organization-level settings: qualifying year, minimum points for credit, point values per activity type |
| `LOSAPCredit` model | Member, activity type, activity reference (event/training/incident ID), points earned, date |
| `LOSAPAnnualSummary` model | Member, year, total points, qualified (bool), manual adjustments |
| Auto-credit hooks | When a member is marked present at an event, training, or incident, automatically create a LOSAPCredit |
| Reports page | Annual member-by-member LOSAP report, exportable to CSV/PDF |

**Implementation complexity:** Medium — extends existing Admin Hours infrastructure, with hooks into Events, Training, and (future) Incidents modules. The auto-crediting logic is the key value-add.

**Feature flag:** `MODULE_LOSAP_ENABLED`

---

### 5. SOG/SOP Policy Management

**Gap:** The Documents module stores files but lacks policy-specific workflows — version control, read-receipt acknowledgment, expiration/review dates, categorization by NFPA-aligned topics.

**What competitors offer:**
- Central policy repository with version history
- Required-reading assignments with tracked acknowledgments per member
- Automatic review reminders when policies approach their expiration/review date
- Red/Yellow/Green color-coded categorization (emergency ops, admin, routine)
- Search across all policies
- Mobile access for field reference
- Integration with training (assign policy review as training credit)

**Proposed scope:**

| Component | Description |
|-----------|-------------|
| `Policy` model | Title, category (emergency/admin/routine), effective date, review-by date, version number, status (draft/active/archived/under-review), content (rich text or PDF), supersedes (FK to previous version) |
| `PolicyAcknowledgment` model | Policy, member, acknowledged date, IP address |
| `PolicyReviewCycle` model | Policy, reviewer, due date, completed date, outcome (no-change/revised/retired) |
| Notification hooks | Alert members when assigned a new required-read; alert policy owners when review date approaches |
| Dashboard widget | Compliance percentage (% of members who have acknowledged current policies) |

**Implementation complexity:** Medium — builds on the existing Documents infrastructure. The acknowledgment tracking and notification integration are the core new capabilities.

**Feature flag:** `MODULE_POLICIES_ENABLED`

---

### 6. Member Wellness & Behavioral Health Tracking

**Gap:** No wellness features exist. This is increasingly considered essential in modern fire service.

**What competitors offer:**
- Anonymous wellness self-assessments (stress, sleep, mood)
- Critical Incident Stress Management (CISM) event logging (tracks that a debriefing occurred, not individual clinical details)
- Exposure tracking (hazmat, smoke, communicable disease)
- Peer support program management (trained peer supporters, contact facilitation)
- Fitness/physical assessment tracking (annual physicals, fit tests, PAT results)
- Resource directory (EAP contacts, crisis hotlines, local therapists)

**Proposed scope:**

| Component | Description |
|-----------|-------------|
| `WellnessCheckIn` model | Anonymous — no FK to user. Timestamp, stress level (1-5), sleep quality, mood, free-text notes. Aggregated only for department-level trends |
| `CISMEvent` model | Incident reference, date, type (defusing/debriefing/one-on-one), facilitator, attendance count (not names, for privacy) |
| `ExposureRecord` model | Member, date, type (smoke/hazmat/bloodborne/noise), incident reference, duration, PPE worn, follow-up actions |
| `PhysicalAssessment` model | Member, date, type (annual physical/SCBA fit test/PAT), result (pass/fail/restricted), provider, expiration date |
| `WellnessResource` model | Title, category, description, URL/phone, display order |
| Peer support directory | List of trained peer supporters with contact info (opt-in only) |

**Implementation note:** HIPAA is paramount. Wellness check-ins must be truly anonymous (no user FK, no session correlation). Exposure records and physical assessments are PII/PHI and must be added to `UNCACHEABLE_PREFIXES`. Access must be role-gated (member sees own records only; admin sees aggregated, anonymized trends).

**Implementation complexity:** Medium — multiple small models, strong privacy controls. The anonymous check-in design requires careful architecture to prevent de-anonymization.

**Feature flag:** `MODULE_WELLNESS_ENABLED`

---

### 7. Fundraising & Donations

**Gap:** `MODULE_FUNDRAISING_ENABLED` flag exists but is `False` and no models/endpoints exist yet.

**What competitors offer:**
- Campaign creation and tracking (goal amount, deadline, progress)
- Donor management (contact info, donation history, thank-you letter tracking)
- Online donation forms (integrated with Stripe)
- Recurring donation support
- In-kind donation tracking
- Tax receipt generation
- Campaign analytics (donor retention, average gift, conversion rates)

**Proposed scope:**

| Component | Description |
|-----------|-------------|
| `FundraisingCampaign` model | Name, description, goal amount, start/end dates, status, category (annual drive, capital campaign, event-based) |
| `Donation` model | Campaign, donor name/email (or anonymous), amount, date, payment method, Stripe payment ID, in-kind description, tax-deductible (bool) |
| `Donor` model | Name, email, phone, address, total lifetime giving, first/last donation dates, notes |
| `DonationReceipt` model | Donation, receipt number, generated date, sent date, PDF path |
| Stripe integration | Leverage existing Stripe config for payment processing; create embeddable donation form |
| Public portal integration | Expose campaign progress and donation form through the existing public portal |

**Implementation complexity:** Medium — Stripe integration already exists in the stack. The donor CRM aspect and receipt generation add scope.

**Feature flag:** `MODULE_FUNDRAISING_ENABLED` (already exists)

---

### 8. Grant Tracking & Management

**Gap:** No grant lifecycle management. Fire departments rely heavily on federal grants (FEMA AFG, SAFER) and state grants.

**What competitors offer:**
- Grant opportunity discovery and tracking
- Application deadline management
- Award tracking with budget allocation
- Expenditure tracking against grant budgets
- Reporting/compliance deadline tracking
- Document storage for applications, award letters, progress reports

**Proposed scope:**

| Component | Description |
|-----------|-------------|
| `Grant` model | Title, grantor (FEMA/state/private), program (AFG/SAFER/other), application date, status (researching/applied/awarded/declined/closed), award amount, match requirement, performance period start/end |
| `GrantBudgetLine` model | Grant, category, budgeted amount, spent amount |
| `GrantExpenditure` model | Budget line, amount, date, vendor, description, receipt/invoice reference |
| `GrantMilestone` model | Grant, description, due date, completed date, status |
| `GrantDocument` model | Grant, document type (application/award-letter/progress-report/closeout), file reference |
| Dashboard | Active grants with burn rate, upcoming deadlines, budget vs. actual charts |

**Implementation complexity:** Medium — straightforward CRUD with reporting. The value is in centralizing information that currently lives in spreadsheets and email.

**Feature flag:** `MODULE_GRANTS_ENABLED`

---

### 9. ISO Rating Preparation & Analytics

**Gap:** No ISO-specific tracking. ISO ratings directly affect community insurance premiums and department funding.

**What competitors offer:**
- ISO score breakdown by category (receiving/handling alarms, fire department, water supply, community risk reduction)
- Training hours tracking against ISO's 20-hours/month/firefighter target
- Response time analytics (alarm handling, turnout, travel, total)
- Equipment/apparatus readiness tracking
- Water supply (hydrant) coverage analysis
- Auto-generated ISO preparation reports

**Proposed scope:**

| Component | Description |
|-----------|-------------|
| `ISOProfile` model | Organization, current PPC rating, last evaluation date, next evaluation date, target rating |
| ISO Dashboard | Read-only analytics page that pulls from existing data: training hours/member/month (from Training), apparatus in-service % (from Apparatus), response times (from future Incidents), hydrant coverage (from future Hydrants) |
| Gap analysis | Highlight areas below ISO thresholds (e.g., members with < 20 training hours/month) |
| Report generator | Exportable ISO preparation report summarizing all categories |

**Implementation complexity:** Small-Medium — primarily a reporting/analytics layer over existing data. Value increases significantly once Incident Reporting and Hydrant Management modules exist.

**Feature flag:** `MODULE_ISO_ENABLED`

---

### 10. Certification & Credential Management

**Gap:** Training records exist but there is no dedicated certification lifecycle management — tracking expiration dates, CE requirements, automatic alerts.

**What competitors offer:**
- Certification database (type, issuing authority, cert number, issue/expiration dates)
- Automated expiration alerts (30/60/90 days out)
- CE hour requirements per certification with progress tracking
- Certification verification workflows (upload cert document, admin verifies)
- Driver/operator qualifications linked to apparatus assignments
- Report: "Who is qualified to drive Engine 1?"
- Bulk expiration report for department leadership

**Proposed scope:**

| Component | Description |
|-----------|-------------|
| `CertificationType` model | Name (EMT-B, Paramedic, Fire Officer I, CDL, etc.), issuing authority, default validity period, required CE hours per cycle, category (medical/fire/driving/hazmat/officer) |
| `MemberCertification` model | Member, certification type, cert number, issue date, expiration date, status (active/expired/pending-renewal/suspended), document attachment |
| `CECredit` model | Member certification, training record reference, hours, date |
| Alert rules | Automated notifications at configurable intervals before expiration |
| Apparatus integration | Link certifications to apparatus operator requirements; prevent scheduling uncertified operators |
| Dashboard | Expiring-soon list, compliance percentage by cert type, member credential portfolio |

**Implementation complexity:** Medium — integrates deeply with Training and Scheduling. The alerting and qualification-checking logic is the differentiator.

**Feature flag:** `MODULE_CERTIFICATIONS_ENABLED`

---

### 11. Real-Time Dashboard & KPI Analytics

**Gap:** Dashboard and analytics endpoints exist but lack fire-service-specific KPIs and real-time updates.

**What competitors offer:**
- Real-time incident count (today/this week/this month/this year)
- Response time trends with NFPA 1710/1720 benchmark lines
- Staffing levels (current on-duty count vs. minimum staffing)
- Training compliance percentage
- Apparatus in-service/out-of-service status
- Call volume heat maps by time-of-day and day-of-week
- Year-over-year comparison charts
- Customizable widget dashboard (drag-and-drop layout)

**Proposed scope:**

| Component | Description |
|-----------|-------------|
| WebSocket layer | Real-time push for staffing changes, apparatus status changes, new incidents |
| Dashboard widgets | Modular widget system where admins can choose which cards appear |
| `DashboardLayout` model | User, widget positions/sizes (persisted per user) |
| Pre-built widgets | Staffing gauge, apparatus status board, training compliance meter, upcoming events, recent activity feed, certification expiration countdown |
| Export | PDF/PNG export of dashboard state for reports |

**Implementation complexity:** Medium — WebSocket infrastructure (the `VITE_WS_URL` config already exists, suggesting some groundwork is laid). Widget system requires flexible frontend architecture.

**Feature flag:** None needed — enhances existing dashboard.

---

### 12. Mobile-Optimized Field Tools

**Gap:** The application is a PWA but may lack field-specific UX optimizations.

**What competitors offer:**
- Offline-capable forms (for areas with poor connectivity)
- Large-button interfaces for gloved hands
- Voice-to-text for narrative entry
- Camera integration for photo documentation
- Barcode/QR scanning for equipment identification
- GPS auto-location for incident addresses
- Push notifications for dispatches, schedule changes, mandatory reads

**Proposed scope:**

| Component | Description |
|-----------|-------------|
| Offline mode | Service worker queues form submissions when offline; syncs when connectivity returns. Priority for incident reports and inspection forms |
| Field UI mode | Toggle for larger touch targets, simplified navigation, high-contrast colors |
| Camera integration | Use `MediaDevices` API for inline photo capture in inspection, incident, and maintenance forms |
| Barcode scanning | Use a JS barcode library (e.g., `html5-qrcode`) to scan equipment asset tags |
| GPS auto-fill | Use Geolocation API to pre-populate location fields |
| Push notifications | Leverage existing PWA service worker for push notification delivery |

**Implementation complexity:** Medium — mostly frontend work. Offline sync is the most architecturally significant piece (conflict resolution strategy needed). The PWA foundation already exists.

---

### 13. Advanced Scheduling Enhancements

**Gap:** Basic shift scheduling exists. Missing: Kelly schedule support, overtime forecasting, qualification-aware staffing, callback/recall management.

**What competitors offer:**
- Kelly schedule (24/48, 48/96) template builder
- Minimum staffing enforcement per station/apparatus
- Qualification-based scheduling (only certified members assigned to specific roles)
- Overtime prediction and budgeting
- Automatic callback/recall for minimum staffing shortfalls
- FLSA compliance tracking (7(k) exemption for fire)
- Trade board (members post available shifts for swap)
- Integration with payroll export

**Proposed scope:**

| Component | Description |
|-----------|-------------|
| Kelly schedule support | Pre-built 24/48 and 48/96 templates; visual calendar showing platoon rotations |
| Minimum staffing rules | `MinimumStaffingRule` model: station, apparatus, role, minimum count. Alert when a shift falls below minimum |
| Qualification checks | Cross-reference member certifications when making assignments; warn on unqualified placements |
| Overtime forecasting | Calculate projected overtime based on current schedule; flag members approaching thresholds |
| Trade board | `ShiftTrade` model: member posts a shift they want covered; eligible members can claim; supervisor approves |
| Payroll export | Export hours worked, overtime, differentials in formats compatible with common payroll systems (CSV, ADP, Paychex) |

**Implementation complexity:** Medium-Large — extends existing Scheduling module significantly. Qualification checks require Certification module. FLSA calculations are nuanced.

---

### 14. CAD (Computer-Aided Dispatch) Integration

**Gap:** No dispatch integration. This is a common need but typically involves third-party CAD systems.

**What competitors offer:**
- Real-time dispatch feed from CAD system
- Auto-populate incident reports from CAD data
- Unit status updates (available/dispatched/en-route/on-scene/available)
- Geo-location of units on a map
- Response time capture from CAD timestamps

**Proposed scope:**

| Component | Description |
|-----------|-------------|
| CAD adapter interface | Abstract interface for receiving dispatch data; concrete implementations for major CAD vendors (Tyler/New World, Hexagon, Motorola PremierOne, Mark43) |
| `Dispatch` model | CAD incident number, call type, address, units dispatched, timestamps (received/dispatched/en-route/on-scene/cleared) |
| Webhook receiver | HTTP endpoint for CAD systems that support outbound webhooks |
| Polling adapter | For CAD systems that only expose a query API |
| Unit status board | Real-time display of all units and their current status |

**Implementation complexity:** Large — CAD integration is vendor-specific and requires coordination with the department's dispatch center. Best implemented as an Integration module with a plugin architecture.

**Feature flag:** `MODULE_CAD_ENABLED`

---

### 15. Multi-Department / Mutual Aid Management

**Gap:** The Organization model exists but there's no inter-department collaboration framework.

**What competitors offer:**
- Mutual aid agreements tracked digitally (who, what resources, conditions)
- Automatic mutual aid notifications
- Shared resource visibility (which neighboring departments have a ladder truck available?)
- Joint training event coordination
- Billing/reimbursement tracking for mutual aid responses

**Proposed scope:**

| Component | Description |
|-----------|-------------|
| `MutualAidAgreement` model | Partner organization, effective/expiration dates, resource types covered, auto-dispatch triggers, billing terms |
| `MutualAidRequest` model | Requesting/providing org, incident reference, resources requested, timestamps, status |
| `MutualAidBilling` model | Request reference, hours, equipment, rate, total, invoice status |
| Partner directory | Contact info, resources, coverage area for mutual aid partners |

**Implementation complexity:** Medium — straightforward models. Real-time notification and cross-organization data sharing raise security/privacy considerations.

**Feature flag:** `MODULE_MUTUAL_AID_ENABLED`

---

### 16. Public-Facing Community Engagement

**Gap:** A public portal exists with API keys and access logs, but its content surface is unclear.

**What competitors offer:**
- Department roster (name, rank, photo — opt-in)
- Upcoming public events and community education calendar
- Online fire inspection scheduling for business owners
- Burn permit applications
- Community risk information (smoke detector programs, fire safety tips)
- Online donation/fundraising pages
- Department statistics (response times, call volume, ISO rating)
- Social media integration
- Recruitment portal

**Proposed scope:**

| Component | Description |
|-----------|-------------|
| Public events page | Pull from Events module, filtered to public-facing events |
| Recruitment landing page | Job/volunteer openings with online application (feeds into Membership Pipeline) |
| Fire safety resources | Static content management for safety tips, seasonal alerts |
| Online scheduling | Allow business owners to request fire inspections or permit appointments |
| Department stats | Auto-generated community report card (if/when incident data exists) |

**Implementation complexity:** Small-Medium — mostly leveraging existing data through the Public Portal infrastructure. The online scheduling integration with CRR is the most involved piece.

---

### 17. Document Workflow & Digital Signatures

**Gap:** Documents module handles storage but lacks approval workflows and signatures.

**What competitors offer:**
- Multi-step approval workflows (draft -> review -> approve -> publish)
- Digital/electronic signatures for forms and policies
- Automatic routing based on document type
- Version comparison (diff view)
- Retention policies with automatic archival

**Proposed scope:**

| Component | Description |
|-----------|-------------|
| `DocumentWorkflow` model | Document type, steps (review -> approve -> publish), required approvers per step |
| `DocumentApproval` model | Document, step, approver, decision (approved/rejected/returned), comments, date |
| `DigitalSignature` model | Document/form submission, signer, signature data (canvas capture or typed), IP address, timestamp |
| Retention rules | `RetentionPolicy` model: document type, retention period, action at expiry (archive/delete/review) |

**Implementation complexity:** Medium — workflow engine is the most complex piece. Digital signatures have legal considerations (may need to comply with ESIGN Act / UETA).

---

### 18. Budget & Financial Tracking

**Gap:** No financial management beyond Stripe payment processing.

**What competitors offer:**
- Departmental budget with line items
- Purchase order workflow (request -> approve -> order -> receive)
- Expense tracking with receipt upload
- Budget vs. actual reporting
- Integration with grant expenditure tracking

**Proposed scope:**

| Component | Description |
|-----------|-------------|
| `Budget` model | Fiscal year, total amount, status (draft/approved/active/closed) |
| `BudgetLineItem` model | Budget, category, description, budgeted amount, spent-to-date |
| `PurchaseOrder` model | Vendor, line items, total, requester, approver, status (requested/approved/ordered/received/closed) |
| `Expense` model | Budget line, amount, date, vendor, description, receipt attachment, PO reference |
| Reports | Budget variance report, spending by category, monthly trend |

**Implementation complexity:** Medium — standard financial CRUD with approval workflow. Integration with Grants module provides additional value.

**Feature flag:** `MODULE_BUDGET_ENABLED`

---

### 19. After-Action Review (AAR) System

**Gap:** No structured post-incident review process.

**What competitors offer:**
- Structured AAR forms (what was planned, what happened, what went well, what needs improvement)
- Linkage to specific incidents
- Action item generation from AARs (feeds into training needs)
- Anonymous feedback collection from responders
- Trend analysis across AARs to identify systemic issues

**Proposed scope:**

| Component | Description |
|-----------|-------------|
| `AfterActionReview` model | Incident reference, date, facilitator, summary, strengths, improvements, lessons learned |
| `AARParticipant` model | AAR, member (optional — can be anonymous) |
| `AARActionItem` model | AAR, description, assigned to, due date, status, training recommendation |
| `AARFeedback` model | AAR, anonymous free-text feedback, rating (1-5) |
| Training integration | Convert AAR action items into training requirements/sessions |

**Implementation complexity:** Small-Medium — clean standalone module with optional integration to Training and (future) Incidents.

**Feature flag:** `MODULE_AAR_ENABLED`

---

### 20. Small but Impactful Enhancements

These don't require new modules but would add meaningful value:

#### a. Dark Mode / Accessibility Improvements
**Status:** Dark mode and high-contrast mode already exist via ThemeContext.
**Enhancement:** Conduct WCAG 2.1 AA audit; add screen-reader landmarks; ensure all interactive elements have visible focus indicators; test with major screen readers.

#### b. Multi-Language Support (i18n)
**Gap:** No internationalization framework.
**Proposal:** Add `react-i18next` for frontend string externalization. Priority languages: English, Spanish (large firefighter demographics). Backend error messages should also be translatable.
**Complexity:** Medium (touching many files, but mechanically straightforward).

#### c. Bulk Import/Export Tools
**Gap:** No easy way to bulk-load existing department data.
**Proposal:** CSV import wizards for members, apparatus, inventory, hydrants, certifications. Column mapping UI. Validation preview before commit. CSV/Excel export for all major data tables.
**Complexity:** Small-Medium per entity.

#### d. Audit Log Viewer
**Gap:** Audit logs are captured but there may not be a user-facing viewer.
**Proposal:** Searchable, filterable audit log page for admins. Filter by user, action type, date range, resource. Export capability.
**Complexity:** Small — data already exists, just needs a frontend.

#### e. Customizable Dashboard Widgets
**Gap:** Dashboard exists but may have a fixed layout.
**Proposal:** Let users pin/unpin widgets, rearrange via drag-and-drop, and set personal default views.
**Complexity:** Small-Medium — frontend only.

#### f. Calendar Integration (iCal/Google Calendar)
**Gap:** Events exist but don't sync to external calendars.
**Proposal:** Generate `.ics` feeds per member (their events + assigned shifts). Allow Google Calendar / Outlook subscription.
**Complexity:** Small — iCal generation is well-documented and straightforward.

#### g. Automated Report Scheduling
**Gap:** Reports exist but must be manually generated.
**Proposal:** Allow admins to schedule reports (daily/weekly/monthly) with automatic email delivery. Useful for: training compliance, apparatus readiness, staffing summaries.
**Complexity:** Small — leverage existing Celery task queue and email infrastructure.

#### h. Member Self-Service Profile
**Gap:** Members may not be able to update their own contact info, emergency contacts, certifications.
**Proposal:** Self-service profile page where members can update phone, email, address, emergency contacts, upload certification documents (pending admin verification).
**Complexity:** Small.

#### i. Announcement Banner System
**Gap:** Department messages exist but may lack visual urgency tiers.
**Proposal:** Persistent banner at top of app for critical announcements (station closures, weather alerts, policy changes). Auto-dismiss after acknowledgment. Configurable urgency level (info/warning/critical) with matching color scheme.
**Complexity:** Small.

#### j. Equipment Barcode/QR Labels
**Gap:** Inventory exists but physical asset identification is manual.
**Proposal:** Generate printable barcode/QR labels for inventory items. Scan to pull up item details, check in/out, log maintenance.
**Complexity:** Small — barcode generation libraries are readily available.

---

## Prioritization Recommendation

Based on industry alignment, competitive differentiation, and implementation feasibility:

### Tier 1 — Highest Impact (address biggest gaps)
1. **Incident Reporting & NERIS** — the core function every department needs
2. **Certification & Credential Management** — critical for compliance and safety
3. **SOG/SOP Policy Management** — low-hanging fruit extending existing Documents module

### Tier 2 — High Value (differentiation)
4. **Hydrant Management & Pre-Incident Planning** — key for ISO and operational readiness
5. **Volunteer Hours & LOSAP Tracking** — high value for the volunteer department audience
6. **Real-Time Dashboard & KPI Analytics** — makes existing data actionable
7. **Member Wellness** — increasingly expected; strong mission alignment

### Tier 3 — Strategic Expansion
8. **Community Risk Reduction & Inspections** — large scope but high value
9. **Fundraising & Donations** — flag already exists; complete the module
10. **Grant Tracking** — pairs well with Fundraising and Budget
11. **Advanced Scheduling** — extends existing module with fire-service specifics
12. **After-Action Reviews** — small effort, high value for learning culture

### Tier 4 — Long-Term Vision
13. **ISO Rating Analytics** — powerful once underlying data modules exist
14. **CAD Integration** — vendor-specific, high complexity, high value
15. **Multi-Department / Mutual Aid** — cross-org complexity
16. **Budget & Financial Tracking** — broad scope, may overlap with existing department tools
17. **Document Workflow & Digital Signatures** — legal complexity
18. **Public Community Engagement** — extend existing portal

### Quick Wins (can be done independently, any time)
- Calendar integration (iCal feeds)
- Audit log viewer
- Announcement banners
- Equipment barcode/QR labels
- Automated report scheduling
- Bulk import/export tools
- Member self-service profile

---

## Sources

- [SafetyCulture — Best Fire Department Software of 2026](https://safetyculture.com/apps/fire-department-software)
- [EPR FireWorks — Fire Department RMS Guide](https://eprfireworks.com/blog/a-complete-guide-to-choosing-the-right-fire-department-records-management-system/)
- [EPR FireWorks — Essential RMS Features](https://eprfireworks.com/blog/5-essential-features-of-record-management-software-fire-departments-must-have/)
- [EPR FireWorks — NERIS Module](https://eprfireworks.com/neris-module/)
- [EPR FireWorks — Fire Prevention Software Features](https://eprfireworks.com/blog/top-features-to-look-for-in-fire-prevention-software/)
- [ESO — Fire Department Software](https://www.eso.com/fire/)
- [First Due — Fire and EMS RMS](https://www.firstdue.com)
- [First Due — Hydrant Software](https://www.firstdue.com/products/hydrants)
- [First Due — Pre-Incident Planning](https://www.firstdue.com/products/preincidentplanning)
- [First Due — LOSAP Scheduling](https://www.firstdue.com/news/losap)
- [First Due — ISO Preparation](https://www.firstdue.com/news/how-to-prepare-for-an-iso-inspection)
- [ImageTrend — Fire Department Software](https://www.imagetrend.com/who-we-serve/fire-department-software/)
- [Alpine Software (RedAlert) — All-in-One Fire Department Software](https://alpinesoftware.com/)
- [USFA — NERIS](https://www.usfa.fema.gov/nfirs/neris/)
- [NERIS Official](https://neris.fsri.org)
- [Esri — Community Risk Reduction](https://www.esri.com/en-us/industries/fire-rescue-ems/strategies/community-risk-reduction)
- [NFPA — Community Risk Reduction](https://www.nfpa.org/education-and-research/community-risk-reduction)
- [Cordico — First Responder Wellness App](https://cordico.com/wellness-app/)
- [Mindbase — Proactive First Responder Wellness](https://getmindbase.com/)
- [PowerDMS — Firefighter Mental Wellness](https://www.powerdms.com/policy-learning-center/mental-wellness-app-reduce-firefighter-burnout-boost-well-being)
- [PowerDMS — Rethinking SOPs/SOGs](https://www.powerdms.com/policy-learning-center/rethinking-sops/sogs-in-the-fire-service)
- [FR Health — First Responder Wellness](https://frhealth.com/)
- [PSTrax — Vehicle Tracking](https://pstrax.com/vehicle-checks/)
- [Vector Solutions — Fire Asset Management](https://www.vectorsolutions.com/resources/blogs/fire-department-asset-management-software/)
- [AngelTrack — Fire Crew Scheduling](https://angeltrack.com/features/fire-department-scheduling-software/)
- [AngelTrack — Fire Fleet Management](https://angeltrack.com/fire-fleet-management-software/)
- [FlowMSP — GIS Pre-Plans](https://flowmsp.com/blog/gis-mapping-solutions/)
- [StreetWise CADLink — ISO Rating Improvements](https://www.streetwisecadlink.com/news/iso-rating-improvements-how-data-accuracy-drives-better-department-scores)
- [Emergent — ISO Fire Department Ratings](https://www.emergent.tech/blog/iso-fire-department-ratings)
- [Fire Station Software](https://firestationsoftware.com/)
- [Responserack — Volunteer Fire Department Software Guide](https://www.responserack.com/fire-department-software/)
- [GetApp — Fire Department Software Reviews](https://www.getapp.com/government-social-services-software/fire-department/)
- [Capterra — Fire Department Software](https://www.capterra.com/fire-department-software/)
