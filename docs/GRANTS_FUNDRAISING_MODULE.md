# Grants & Fundraising Module — Research & Design Document

## Executive Summary

This document captures research findings and design recommendations for the Grants & Fundraising module in The Logbook. The module aims to provide volunteer and career fire departments with an integrated system for managing grant applications, fundraising campaigns, donor relationships, and financial reporting — all within their existing intranet platform.

The fire service faces a unique funding landscape: volunteer departments often operate with minimal municipal funding, relying heavily on federal grants (AFG, SAFER, FP&S), private foundation grants, and community fundraising. Most departments currently manage these processes with spreadsheets, paper files, and disconnected tools. This module can be a game-changer.

---

## Table of Contents

1. [Industry Landscape & Funding Sources](#1-industry-landscape--funding-sources)
2. [Existing Codebase Foundation](#2-existing-codebase-foundation)
3. [Competitive Analysis](#3-competitive-analysis)
4. [Module Architecture & Features](#4-module-architecture--features)
5. [Grant Management System](#5-grant-management-system)
6. [Fundraising Campaign Engine](#6-fundraising-campaign-engine)
7. [Donor Management (Mini-CRM)](#7-donor-management-mini-crm)
8. [Public Donation Portal](#8-public-donation-portal)
9. [Reporting & Compliance](#9-reporting--compliance)
10. [Cross-Platform Integration Points](#10-cross-platform-integration-points)
11. [Out-of-the-Box Ideas](#11-out-of-the-box-ideas)
12. [Data Model Additions](#12-data-model-additions)
13. [Implementation Phases](#13-implementation-phases)

---

## 1. Industry Landscape & Funding Sources

### 1.1 Federal Grant Programs

#### FEMA Assistance to Firefighters Grant (AFG)
- **Purpose:** Equipment, PPE, training, vehicles, wellness programs, facility modifications
- **FY 2024 funding:** $291.6 million across 1,678 awards
- **Eligibility:** Career, volunteer, and combination fire departments
- **Cost share:** Requires local match (varies by population served)
- **Micro grants option:** Federal share up to $75,000 with additional award consideration
- **Key requirement:** Recipients must report to NFIRS/NERIS for the entire grant period
- **Application platform:** FEMA GO (fema.gov)
- **Reporting:** Performance reports required every 6 months

#### FEMA SAFER (Staffing for Adequate Fire and Emergency Response)
- **Purpose:** Hiring firefighters (career) and recruiting/retaining volunteers
- **FY 2024 funding:** $324 million across 207 awards
- **Two activities:**
  - *Hiring:* Salary and benefits for new positions
  - *Recruitment & Retention (R&R):* Programs to attract and keep volunteer firefighters
- **Cost share:** No cost share for R&R activity
- **Period of performance:** 36 months + 180-day recruitment period
- **Goal:** Compliance with NFPA 1710/1720 staffing standards

#### FEMA Fire Prevention & Safety (FP&S)
- **Purpose:** Fire prevention projects, firefighter health and safety R&D
- **Minimum allocation:** 10% of total AFG appropriation
- **Eligibility:** Fire departments, nonprofits, national/state/local organizations

#### USDA Community Facilities Direct Loan & Grant Program
- **Purpose:** Essential community facilities in rural areas (fire stations, equipment, vehicles)
- **Grant levels:** Up to 75% for communities with population under 5,000
- **Population cap:** Communities of 20,000 or fewer
- **Applications:** Accepted year-round (Oct 1 - Sep 30)
- **Key requirement:** Must demonstrate inability to finance commercially

#### FEMA Hazard Mitigation Assistance (BRIC, STRLF, HMGP)
- **Purpose:** Resilience upgrades to existing fire stations
- **Limitation:** Cannot fund new construction, only modifications

#### HUD Community Development Block Grant (CDBG)
- **Purpose:** Flexible community development funding
- **Fire-eligible:** Equipment and facilities under Public Facilities category

### 1.2 Private Foundation Grants

#### Firehouse Subs Public Safety Foundation
- **Grant range:** $15,000–$40,000
- **Focus:** Lifesaving equipment (SCBA, thermal cameras, extrication tools, AEDs, radios, bunker gear)
- **Eligibility:** Fire departments, EMS, law enforcement, schools, nonprofits
- **Geographic focus:** Within 60 miles of a Firehouse Subs restaurant (but rural/volunteer exceptions exist)
- **Application cycle:** Quarterly, 600 applications accepted per quarter (first-come)
- **Wait period:** 2 years between successful applications
- **Portal:** grants.firehousesubs.com

#### Other Notable Private Sources
- **National Volunteer Fire Council (NVFC)** — various programs and partnerships
- **State fire marshal programs** — vary by state (e.g., Florida Firefighter Assistance Grant)
- **Volunteer Fire Assistance (VFA)** — federal/state 50/50 match for wildland equipment
- **Insurance company grants** — FM Global, State Farm, etc.
- **Local community foundations** — varies by region
- **Corporate giving programs** — utility companies, major employers

### 1.3 Common Fundraising Methods for Volunteer Departments

#### Traditional
- Pancake breakfasts, spaghetti dinners, chicken BBQs
- Boot drives (roadside collections)
- Fire prevention open houses
- Golf outings, fishing derbies
- Raffles, 50/50 drawings, basket auctions
- Car washes, yard sales
- Annual fund drives (mail campaigns)
- Memorial runs/walks

#### Modern/Digital
- Online donation pages with QR codes
- Peer-to-peer fundraising campaigns
- Text-to-give programs
- Recurring monthly giving programs ("Sustainer" programs)
- Social media campaigns
- Crowdfunding (GoFundMe, GiveButter)
- Silent auction platforms
- Event ticketing with digital payment
- Corporate sponsorship/matching programs

### 1.4 Key Challenges for Volunteer Departments

1. **Limited volunteer capacity** — Few members have grant-writing expertise or time
2. **Complex federal requirements** — SAM.gov registration, NFIRS reporting, environmental/historic preservation compliance
3. **Match funding pressure** — Many grants require local cost share that small budgets can't absorb
4. **Tracking burden** — Performance reports, receipts, compliance documentation across multiple grants
5. **Deadline management** — Missing application windows for annual-cycle grants
6. **Donor fatigue** — Small communities with repeated asks
7. **Financial transparency** — Requirements for 501(c)(3) and 501(c)(4) compliance, tax receipts
8. **Data for applications** — Grants increasingly require data (call volume, response times, ISO ratings) that departments struggle to compile

---

## 2. Existing Codebase Foundation

### 2.1 What Already Exists

The platform has significant groundwork for this module:

**Database tables** (migration `20260201_0017`):
- `fundraising_campaigns` — campaign management with types, goals, statuses, public page support
- `donors` — full donor CRM with contact info, giving history, tags, communication preferences
- `donations` — individual donation records with payment methods, recurring support, dedications, tax receipts
- `pledges` — commitment tracking with payment schedules and reminders
- `fundraising_events` — event-based fundraising (dinners, galas, auctions, raffles)

**Permissions system** (`core/permissions.py`):
- `fundraising.view` — View fundraising data
- `fundraising.manage` — Manage fundraising activities
- Role assignments: `treasurer`, `fundraising_chair`

**Feature flag**: `MODULE_FUNDRAISING_ENABLED = False` (ready to toggle)

**Module definition** (`types/modules.ts`):
- Listed as optional module with `comingSoon: true`
- Route: `/grants`
- Features listed: grant tracking, campaigns, budget, donors, reporting, deadline reminders

**Event type**: `FUNDRAISER` event type already exists in the events system

### 2.2 What Needs to Be Built

The existing DB tables cover fundraising campaigns and donations well. The following areas need new tables and/or significant additions:

- **Grant management** — No tables exist for tracking grant applications, compliance, reporting
- **Budget/expense tracking** — No tables for departmental budgets tied to grants
- **Grant opportunity library** — No database of available grants
- **Document attachments** — Need to link documents module to grant applications
- **Email/notification templates** — Automated reminders, thank-you letters, receipts
- **Public donation portal** — Frontend pages for public-facing donation collection
- **Stripe integration** — Payment processing for online donations (Stripe already in the stack)
- **Reporting engine** — Financial reports, grant compliance reports, donor analytics

---

## 3. Competitive Analysis

### 3.1 Fire Department Management Software (Existing Players)

| Software | Grant Features | Fundraising | Pricing |
|----------|---------------|-------------|---------|
| Station Boss | ISO audit data, grant application support | None | ~$50/mo |
| Emergency Reporting | Data for grant applications | None | Varies |
| ImageTrend | Compliance reporting for grants | None | Enterprise |
| First Due | Equipment/compliance data | None | Enterprise |

**Key insight:** None of the existing fire department management platforms offer integrated grant management or fundraising tools. This is a major differentiator opportunity.

### 3.2 Grant Management Software (Nonprofit Sector)

| Software | Key Features | Pricing |
|----------|-------------|---------|
| Bloomerang | Grant tracking, donor CRM, relationship mapping | $125/mo+ |
| Neon CRM | Donor management, grant tracking, workflows | $99/mo+ |
| DonorPerfect | Foundation profiles, grant pipeline | $99/mo+ |
| AmpliFund | Deadline alerts, compliance tracking, task workflows | Custom |
| Instrumentl | Grant discovery, deadline tracking, funder matching | $179/mo+ |
| Good Grants | Simple workflow, small org friendly | Free tier |

**Key insight:** These tools are generic nonprofits — none understand fire service grant programs specifically. They also represent additional subscriptions ($100-200+/month) on top of existing department software.

### 3.3 Fundraising Platforms

| Platform | Key Features | Fees |
|----------|-------------|------|
| Zeffy | Zero-fee donations, events, recurring, P2P | 0% |
| BetterWorld | Free platform, 95% donor-covered fees | 0% (2.9%+$0.30 CC) |
| GiveButter | Donation pages, events, auctions, P2P | 1-5% |
| GoFundMe | Crowdfunding, large donor network | 2.9%+$0.30 |
| Donorbox | Tiered donations, recurring, embeddable | 1.5%+ |

**Key insight:** Departments currently must use separate platforms for fundraising, creating data silos. Integrating fundraising into the department intranet keeps everything in one place.

### 3.4 The Logbook's Competitive Advantage

Building this into The Logbook offers something **no competitor provides**:

1. **Integrated data** — Grant applications can auto-pull call volume, training hours, equipment inventory, staffing data, and ISO information directly from other modules
2. **Fire-service specific** — Pre-loaded knowledge of AFG, SAFER, FP&S programs and their requirements
3. **No additional subscription** — Built into the platform departments already use
4. **Cross-module workflows** — Fundraising events tied to the events module, equipment purchases tied to inventory, training grants tied to training records
5. **Unified donor/member database** — Community members who donate can optionally be linked to prospective member pipeline

---

## 4. Module Architecture & Features

### 4.1 Module Structure

```
frontend/src/modules/grants-fundraising/
├── index.ts
├── routes.tsx
├── pages/
│   ├── GrantsDashboardPage.tsx        # Overview with KPIs
│   ├── GrantsListPage.tsx             # All grant applications
│   ├── GrantDetailPage.tsx            # Single grant application view
│   ├── GrantApplicationPage.tsx       # Create/edit grant application
│   ├── GrantOpportunitiesPage.tsx     # Browse available grants
│   ├── CampaignsListPage.tsx          # All fundraising campaigns
│   ├── CampaignDetailPage.tsx         # Single campaign view
│   ├── CampaignFormPage.tsx           # Create/edit campaign
│   ├── DonorsListPage.tsx             # Donor directory
│   ├── DonorDetailPage.tsx            # Individual donor profile
│   ├── DonationsListPage.tsx          # All donations log
│   ├── DonationFormPage.tsx           # Record a donation
│   ├── PledgesPage.tsx                # Pledge tracking
│   ├── FundraisingEventsPage.tsx      # Event-based fundraising
│   ├── ReportsPage.tsx                # Financial reports
│   └── SettingsPage.tsx               # Module configuration
├── components/
│   ├── GrantPipeline.tsx              # Kanban-style grant tracker
│   ├── CampaignProgressCard.tsx       # Thermometer/progress display
│   ├── DonorCard.tsx                  # Donor summary card
│   ├── DonationTable.tsx              # Filterable donation list
│   ├── GrantCalendar.tsx              # Deadline calendar view
│   ├── FundingSourceBreakdown.tsx     # Pie/bar chart of revenue sources
│   ├── GrantChecklist.tsx             # Application requirements checklist
│   ├── DonorAcknowledgmentForm.tsx    # Thank-you/receipt generator
│   └── QuickDonationWidget.tsx        # Fast manual entry widget
├── services/
│   └── api.ts
├── store/
│   ├── grantsStore.ts
│   └── fundraisingStore.ts
├── types/
│   └── index.ts
└── utils/
    └── grantHelpers.ts
```

### 4.2 Permission Model

```
fundraising.view          — View campaigns, donations, donors, reports
fundraising.manage        — Create/edit campaigns, record donations, manage donors
fundraising.grants.view   — View grant applications (may want separate from donations)
fundraising.grants.manage — Create/edit grant applications, manage compliance
fundraising.admin         — Module settings, integrations, delete records
```

### 4.3 Navigation Structure

```
/grants                              → Dashboard (overview)
/grants/applications                 → Grant applications list
/grants/applications/new             → New grant application
/grants/applications/:id             → Grant detail
/grants/opportunities                → Grant opportunity browser
/grants/campaigns                    → Fundraising campaigns list
/grants/campaigns/new                → New campaign
/grants/campaigns/:id                → Campaign detail
/grants/donations                    → Donations log
/grants/donations/new                → Record donation
/grants/donors                       → Donor directory
/grants/donors/:id                   → Donor profile
/grants/pledges                      → Pledge tracking
/grants/events                       → Fundraising events
/grants/reports                      → Financial reports
/grants/settings                     → Module settings
```

---

## 5. Grant Management System

### 5.1 Grant Opportunity Library

A curated, searchable database of grant programs relevant to fire/EMS departments:

**Pre-loaded grant programs:**
- FEMA AFG (annual cycle, typically opens Jan-Feb)
- FEMA SAFER (annual cycle)
- FEMA FP&S (annual cycle)
- USDA Community Facilities
- Firehouse Subs Public Safety Foundation (quarterly)
- State-specific programs (configurable)

**For each opportunity:**
- Grant program name and agency
- Description and eligible uses
- Typical award range
- Eligibility criteria
- Application deadline (recurring or fixed)
- Required documents checklist
- Match/cost-share requirements
- Application URL
- Tips and notes
- Tags (equipment, staffing, training, prevention, facilities)

**Smart features:**
- Deadline notifications (30/14/7/1 day reminders)
- Eligibility pre-screening based on department profile (population served, volunteer vs. career, rural vs. urban)
- "Recommended for you" based on department needs and recent purchases/inventory gaps
- Community-contributed opportunities (departments can add local/state grants)

### 5.2 Grant Application Tracker

Track applications through a pipeline with kanban and table views:

**Pipeline stages:**
1. **Researching** — Evaluating fit, gathering info
2. **Preparing** — Writing application, gathering documentation
3. **Internal Review** — Department leadership approval
4. **Submitted** — Application filed
5. **Under Review** — Grantor is reviewing
6. **Awarded** — Grant received
7. **Denied** — Application unsuccessful
8. **Active** — Grant period in progress, funds being spent
9. **Reporting** — Performance reports due
10. **Closed** — Grant period complete, all reports filed

**For each application:**
- Linked grant opportunity
- Application status (pipeline stage)
- Amount requested / Amount awarded
- Match amount required / Match source
- Key dates (deadline, submission date, award date, start date, end date)
- Assigned team members
- Required documents checklist with upload links (integrates with Documents module)
- Notes and activity log
- Budget breakdown
- Compliance tasks and reporting schedule
- Related equipment/training/staffing (links to other modules)

### 5.3 Grant Compliance Tracker

Once awarded, track compliance obligations:

- **Reporting schedule** — Auto-generated task list for required reports (e.g., AFG requires semi-annual performance reports)
- **Spending tracker** — Log expenditures against grant budget categories
- **Document repository** — Store receipts, invoices, bid documents, progress reports
- **NFIRS/NERIS compliance** — Status indicator showing whether incident reporting requirements are being met (links to future Incidents module)
- **Audit preparation** — One-click export of all grant documentation
- **Timeline view** — Visual representation of grant period with milestones

### 5.4 Application Data Auto-Population

**This is a key differentiator.** Grant applications require extensive data that already exists elsewhere in The Logbook:

| Application Field | Auto-populated From |
|-------------------|-------------------|
| Department name, address, FDID | Organization settings |
| Population served | Organization profile |
| Number of members (career/volunteer) | Membership module |
| Call volume / incident data | Incidents module (future) or manual entry |
| Current apparatus inventory | Apparatus module |
| Equipment inventory | Inventory module |
| Training hours completed | Training module |
| Certifications held | Training/compliance module |
| ISO rating | Organization settings |
| Current staffing levels | Scheduling module |
| Response time data | Incidents module (future) or manual entry |
| Station/facility condition | Facilities module |
| Annual budget | Financial settings |

This eliminates the painful data-gathering process that causes many departments to skip grant applications entirely.

---

## 6. Fundraising Campaign Engine

### 6.1 Campaign Types

Building on the existing `fundraising_campaigns` table:

| Type | Description | Example |
|------|-------------|---------|
| `general` | Unrestricted fund drives | Annual fund drive |
| `equipment` | Targeted equipment purchase | New SCBA purchase |
| `apparatus` | Vehicle acquisition | Engine replacement fund |
| `facilities` | Building projects | Station renovation |
| `training` | Training programs/gear | Training prop construction |
| `community` | Community outreach | Smoke alarm installation program |
| `memorial` | Memorial/tribute | Line-of-duty memorial |
| `event` | Event-based | Annual dinner dance |
| `emergency` | Urgent/disaster relief | Storm damage repair |
| `capital` | Multi-year capital project | New station build |
| `match` | Grant match funding | AFG cost-share campaign |

### 6.2 Campaign Features

- **Progress tracking** — Real-time thermometer/progress bar toward goal
- **Donation tiers** — Suggested amounts with impact descriptions (e.g., "$50 = one set of gloves", "$500 = one SCBA mask")
- **Public campaign page** — Shareable URL for community visibility (via Public Portal module)
- **QR code generation** — For flyers, boot drives, events, and apparatus
- **Social sharing** — Pre-formatted share links for Facebook, Twitter/X, email
- **Recurring giving** — Monthly/quarterly/annual recurring donation support
- **Dedication/memorial** — "In honor of" and "In memory of" donation options
- **Matching campaigns** — "Grant match" type where community donations fulfill a grant's cost-share requirement
- **Multi-channel tracking** — Track whether donations came from online, mail, in-person, event
- **Expense tracking** — Log expenses against fundraising events to calculate net revenue
- **Photo/video updates** — Campaign updates with media to show donors impact

### 6.3 Fundraising Events Integration

Link fundraising directly to the Events module:

- Create a fundraising event that appears on both the events calendar and the fundraising dashboard
- Track ticket sales, sponsorships, auction revenue, and expenses
- Use event RSVP and check-in features for attendance
- Post-event revenue reconciliation
- Sponsor recognition management

---

## 7. Donor Management (Mini-CRM)

### 7.1 Donor Profiles

Building on the existing `donors` table:

- **Contact information** — Name, email, phone, address (encrypted at rest for HIPAA-adjacent privacy)
- **Giving history** — Complete donation timeline with amounts, campaigns, methods
- **Donor classification** — Individual, business, foundation, government
- **Engagement level** — New, active, lapsed, major donor (auto-calculated)
- **Communication log** — Record of thank-you letters, calls, emails
- **Tags** — Customizable tagging (e.g., "board member", "community leader", "annual giver")
- **Relationships** — Link donors to other donors (spouse, company contacts)
- **Opt-in preferences** — Email, mail, phone communication preferences
- **Prospective member link** — Option to invite engaged community donors into the prospective member pipeline

### 7.2 Donor Segmentation

- **By giving level:** Major ($1,000+), mid-level ($100-999), grassroots ($1-99)
- **By frequency:** One-time, recurring, annual
- **By campaign:** Which campaigns they've supported
- **By recency:** Active (last 12 months), lapsed (12-24 months), dormant (24+ months)
- **By type:** Individual, business, foundation
- **By source:** Online, event, mail, in-person

### 7.3 Donor Communication

- **Automated thank-you emails** — Triggered on donation receipt (customizable template via Communications module)
- **Tax receipt generation** — Year-end giving statements for 501(c)(3) organizations
- **Pledge reminders** — Automated reminders for outstanding pledges
- **Campaign updates** — Bulk email updates to campaign donors
- **Lapsed donor re-engagement** — Automated outreach to donors who haven't given in 12+ months
- **Birthday/anniversary** — Optional personal touches

---

## 8. Public Donation Portal

### 8.1 Public-Facing Pages

Leverage the existing Public Portal module to create:

- **Department donation page** — Branded landing page with active campaigns
- **Individual campaign pages** — Dedicated pages per campaign with progress, story, photos
- **Donation form** — Secure, mobile-optimized form with:
  - Suggested amounts with impact descriptions
  - Custom amount field
  - Recurring giving toggle
  - Dedication options
  - Donor information (or anonymous)
  - Payment via Stripe (already in the stack)
- **Thank-you page** — Post-donation confirmation with receipt and sharing options

### 8.2 Payment Processing

Leverage existing Stripe integration:

- **One-time payments** — Stripe Checkout or Payment Intents
- **Recurring donations** — Stripe Subscriptions
- **Payment methods** — Credit/debit cards, ACH bank transfers, Apple Pay, Google Pay
- **Fee handling** — Option for donors to cover processing fees
- **Refund management** — Process refunds through admin interface
- **PCI compliance** — Stripe handles card data; no PII stored on our servers

### 8.3 QR Code Donation System

Generate QR codes that link to donation pages:

- **Use cases:**
  - Printed on apparatus/vehicles ("Support your local fire department")
  - At community events and open houses
  - On fundraising mailers and flyers
  - Boot drive signs (instead of/alongside cash collection)
  - Station signage
  - Social media posts
- **Tracking:** Each QR code has a unique campaign/source tag for analytics

---

## 9. Reporting & Compliance

### 9.1 Financial Reports

- **Revenue summary** — Total donations by period, campaign, source, method
- **Campaign performance** — Goal vs. actual, cost to raise a dollar, ROI on fundraising events
- **Donor analytics** — New vs. returning, average gift size, donor retention rate, lifetime value
- **Grant pipeline** — Applications submitted, success rate, total awarded, pending
- **Year-over-year trends** — Multi-year comparison of fundraising performance
- **Expense reports** — Fundraising costs, event expenses, net revenue
- **Budget vs. actual** — If budget tracking is implemented

### 9.2 Tax & Compliance Reports

- **Year-end giving statements** — Individual donor summaries for tax purposes
- **990 Schedule B preparation** — Major donor reporting for IRS Form 990
- **Grant expenditure reports** — Spending against grant budgets with categories
- **Audit trail** — Complete log of all financial transactions with user attribution
- **Receipt log** — Track which donors received acknowledgment letters

### 9.3 Dashboard KPIs

The grants dashboard should surface:

- Total funds raised (YTD, last 12 months)
- Active campaigns with progress bars
- Upcoming grant deadlines (next 90 days)
- Pending grant applications
- Active grants and their spend-down status
- Recent donations (last 30 days)
- Donor retention rate
- Top campaigns by amount raised
- Pledges outstanding

---

## 10. Cross-Platform Integration Points

This is where the module truly differentiates from standalone tools:

### 10.1 Events Module
- Create fundraising events that appear on the department calendar
- Use event RSVP and QR check-in for ticketed fundraisers
- Track attendance and correlate with donations
- Auto-create fundraising events when campaign type is "event"

### 10.2 Apparatus Module
- Link grant applications to specific apparatus needs
- When a grant funds equipment, auto-update apparatus records with purchase info
- Use current apparatus data (age, condition, mileage) to justify grant applications
- Track apparatus purchased with grant funds for compliance

### 10.3 Inventory Module
- Same as apparatus — link grants to equipment purchases
- Auto-populate grant applications with current inventory gaps
- Track grant-funded equipment for compliance

### 10.4 Training Module
- Link SAFER/AFG training grants to training records
- Demonstrate training activity in grant applications
- Track training purchased with grant funds

### 10.5 Membership Module
- Use staffing data for SAFER applications
- Link donors to member records if they join
- Track volunteer hours for grant compliance

### 10.6 Documents Module
- Store grant application documents, award letters, compliance reports
- Template library for common grant documents
- Version control for application drafts

### 10.7 Communications Module
- Email templates for donor thank-you letters, pledge reminders, campaign updates
- Automated notification workflows
- Tax receipt email templates

### 10.8 Scheduling Module
- Track volunteer hours contributed to grant-funded activities
- Use staffing data for SAFER compliance

### 10.9 Reports Module
- Financial reports integrated into the main reporting dashboard
- Grant-specific report templates

### 10.10 Notifications Module
- Grant deadline approaching
- New donation received
- Pledge payment due
- Campaign milestone reached (25%, 50%, 75%, 100%)
- Grant status change
- Compliance report due

### 10.11 Public Portal Module
- Public donation pages
- Campaign landing pages
- Donor wall / recognition page

---

## 11. Out-of-the-Box Ideas

### 11.1 "Grant Application Wizard"
A step-by-step wizard that walks departments through federal grant applications:
- Pre-fills organizational data from The Logbook
- Provides writing prompts and example narratives
- Checklist of required documents with links to upload
- Auto-calculates budget categories from department data
- Saves progress and allows collaboration
- Could include AI-assisted narrative generation (future)

### 11.2 "Community Supporter" Program
A membership/subscription model for community support:
- Community members sign up for monthly recurring donations ($5, $10, $25/month)
- Receive a "Community Supporter" digital badge/card
- Get quarterly updates on how funds are used
- Invited to special department events (open houses, ride-alongs)
- Recognition on public portal "supporter wall"
- Different tiers with increasing benefits (Bronze/Silver/Gold/Platinum)

### 11.3 "Round-Up" Donation Integration
Partner with local businesses:
- QR codes at checkout counters
- "Round up your purchase" programs
- Business matches customer donations
- Automated monthly settlement

### 11.4 "Impact Tracker"
Show donors exactly what their money bought:
- "$50 bought 2 smoke alarms that were installed at 123 Main St"
- "Your $500 helped purchase SCBA equipment used in 47 calls this year"
- Visual timeline of purchases and their community impact
- Photo updates from equipment in action

### 11.5 "Grant Match Challenge"
When a department receives a grant with a cost-share requirement:
- Automatically create a "match campaign" showing the community exactly how much needs to be raised
- "The federal government will give us $200,000 if we can raise $20,000 locally"
- Real-time progress toward the match with a deadline countdown
- Powerful motivator — donors see their dollar multiplied 10x

### 11.6 "Apparatus Fund" Savings Tracker
For long-term capital planning:
- Dedicated fund for apparatus replacement
- Visualize progress toward a target (e.g., "new engine: $850,000")
- Show how current savings + potential grants could close the gap
- Monthly contribution tracking from operational budget

### 11.7 "Donor-Connected Prospective Members"
When community donors show high engagement:
- Track donation frequency and engagement
- Offer pathway to become a volunteer member
- Link to the Prospective Members pipeline module
- "Your biggest supporters might be your next volunteers"

### 11.8 "Boot Drive Digital" Companion
Modernize the traditional boot drive:
- QR code stickers for boot drive signs
- Real-time donation tracking for live events
- Digital + cash tracking in one dashboard
- Automatic thank-you messages for digital donors
- Geo-tagged donation locations for optimizing future drive locations

### 11.9 "Grant Success Stories" Knowledge Base
Community-contributed best practices:
- Departments share successful grant narratives (anonymized)
- Tips for specific grant programs
- Common pitfalls to avoid
- Recommended vendors for grant-funded purchases
- Could be a premium/community feature

### 11.10 "Fundraising Gamification"
Motivate the department's fundraising team:
- Leaderboard for members who bring in donations
- Campaign milestone celebrations (confetti animation at 50%, 100%)
- "Streak" tracking for recurring donor retention
- Annual fundraising goals with department-wide progress
- Badge system for members (e.g., "$1,000 Club", "Grant Writer")

### 11.11 "Smart Grant Recommendations"
Based on department profile and data:
- "You have 3 SCBA units expiring in 6 months — AFG applications open in 2 months"
- "Your training hours are above average — highlight this in your next AFG narrative"
- "Based on your call volume growth, you may qualify for SAFER hiring"
- "Firehouse Subs applications open next quarter — your thermal cameras are 8 years old"

### 11.12 "Donation Kiosk Mode"
For use at events, open houses, and the station:
- Full-screen tablet-optimized donation form
- Large buttons for suggested amounts
- Quick card tap via Stripe Terminal (future)
- Anonymous mode available
- Auto-returns to landing screen after 30 seconds

---

## 12. Data Model Additions

### 12.1 New Tables Needed

```
grant_opportunities          — Library of available grant programs
grant_applications           — Individual grant applications
grant_application_documents  — Documents attached to applications
grant_budgets                — Budget line items for grant applications
grant_expenditures           — Spending against grant budgets
grant_compliance_tasks       — Compliance/reporting obligations
grant_notes                  — Activity log for grant applications
fundraising_settings         — Module configuration per organization
donation_receipts            — Generated tax receipts
campaign_updates             — Updates/posts on campaigns
campaign_sponsors            — Sponsor tracking for campaigns/events
```

### 12.2 Existing Tables to Extend

The existing fundraising tables from migration `20260201_0017` provide a solid foundation. Consider adding:

**`fundraising_campaigns`:**
- `campaign_subtype` — For more granular categorization (e.g., boot drive vs. mail campaign under "general")
- `expense_total` — Running expense total for net revenue calculation
- `qr_code_url` — Generated QR code for the campaign
- `social_share_text` — Pre-formatted social media text
- `match_grant_id` — Link to grant application if this is a match campaign
- `recurring_donors_count` — Count of active recurring donors

**`donors`:**
- `engagement_score` — Calculated engagement level
- `prospective_member_id` — Link to prospective member pipeline
- `last_communication_date` — When last contacted
- `preferred_communication` — Email, mail, phone, text
- `employer_name` — For corporate matching
- `employer_match_eligible` — Boolean

**`donations`:**
- `source_type` — online, event, mail, in-person, kiosk, qr_code
- `campaign_source_tag` — UTM-style source tracking
- `donor_covered_fees` — Whether donor elected to cover processing fees
- `fee_amount` — Processing fee amount
- `net_amount` — Amount after fees
- `stripe_payment_intent_id` — Link to Stripe
- `grant_id` — If this donation is a grant match contribution

---

## 13. Implementation Phases

### Phase 1: Foundation (MVP)
**Goal:** Core grant tracking and manual donation management

- Grant application tracker (pipeline view + table view)
- Basic grant opportunity library (pre-loaded federal programs)
- Manual donation recording (existing tables)
- Donor management (existing tables)
- Campaign management (existing tables)
- Basic dashboard with KPIs
- Fundraising permissions enforcement
- Module settings page

### Phase 2: Public Donations & Automation
**Goal:** Accept online donations and automate communications

- Public donation portal pages
- Stripe payment integration for online donations
- Recurring donation support (Stripe Subscriptions)
- QR code generation for campaigns
- Automated thank-you emails
- Tax receipt generation
- Pledge tracking and reminders
- Campaign progress/thermometer widgets

### Phase 3: Grant Intelligence & Compliance
**Goal:** Smart grant management and compliance tracking

- Grant compliance task manager
- Grant spending tracker
- Auto-population of grant application data from other modules
- Grant deadline notification system
- Document management integration
- Grant budget planning tool
- Semi-annual performance report templates

### Phase 4: Advanced Features
**Goal:** Differentiation and delight

- Grant application wizard with guided workflows
- Community Supporter subscription program
- Donor segmentation and analytics
- Fundraising event management integration
- Advanced reporting and financial analytics
- Impact tracker
- Grant match challenge campaigns
- Boot Drive Digital companion
- Kiosk mode for in-person donations

### Phase 5: Community & Intelligence (Future)
**Goal:** Network effects and smart recommendations

- Smart grant recommendations based on department data
- Grant success stories knowledge base
- Fundraising gamification
- Corporate matching program support
- Multi-department grant collaboration
- AI-assisted grant narrative writing

---

## Sources & References

- [FEMA Assistance to Firefighters Grants Program](https://www.fema.gov/grants/preparedness/firefighters)
- [FEMA AFG Application Details](https://www.fema.gov/grants/preparedness/firefighters/assistance-grants)
- [FEMA SAFER Grants](https://www.fema.gov/grants/preparedness/firefighters/safer)
- [USDA Community Facilities Program](https://www.rd.usda.gov/programs-services/community-facilities/community-facilities-direct-loan-grant-program)
- [Firehouse Subs Public Safety Foundation](https://firehousesubsfoundation.org/)
- [Firehouse Subs Grant Portal](https://grants.firehousesubs.com/)
- [Congressional Research Service — Federal Programs for Firefighters](https://www.congress.gov/crs-product/IF12806)
- [SAFER Grant FAQ (FY 2024)](https://www.fema.gov/sites/default/files/documents/fema_gpd_safer-faqs_fy24.pdf)
- [Lexipol — Maximizing SAFER Grants for Volunteer Departments](https://www.lexipol.com/resources/blog/maximizing-the-impact-of-safer-grants-strengthening-volunteer-fire-departments/)
- [Fire Rescue 1 — Fundraising Ideas](https://www.firerescue1.com/fundraising/19-unique-fundraising-ideas-for-your-volunteer-fire-department)
- [GoFundMe — Fire Department Fundraising Guide](https://www.gofundme.com/c/blog/fire-department-fundraising-ideas)
- [Zeffy — Zero-Fee Fundraising for Volunteer Fire Departments](https://www.zeffy.com/fundraise/volunteer-fire-departments)
- [BetterWorld — Free Fundraising Software](https://betterworld.org/organizations/volunteer-fire-departments/)
- [Donorbox — Fire Station Fundraising Ideas](https://donorbox.org/nonprofit-blog/fire-station-fundraising-ideas)
- [DonorPerfect — Grant Management Tips](https://www.donorperfect.com/nonprofit-technology-blog/fundraising-software/grant-management-tips/)
- [Neon One — Grant Management Software Guide](https://neonone.com/resources/blog/grant-management-software/)
- [USFA — Fire Service Grants](https://www.usfa.fema.gov/a-z/grants/)
- [NVFC — National Volunteer Fire Council](https://www.nvfc.org)
- [AFG & SAFER Reauthorization (CFSI)](https://cfsi.org/legislation-advocacy/current-legislation/afg-and-safer/)
- [Rural Fire Department Resources — USDA NAL](https://www.nal.usda.gov/rural-development-communities/rural-fire-department-resources-local-officials)
