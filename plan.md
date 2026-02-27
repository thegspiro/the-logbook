# Plan: Platform Analytics Dashboard

## Overview
Add a new **Platform Analytics** page at `/admin/platform-analytics` accessible to IT admins (`settings.manage` permission). This gives a bird's-eye view of platform adoption, user engagement, module usage, and system health — standard KPIs for intranet/SaaS platforms, tailored for fire department operations.

The existing **QR Code Analytics** page remains untouched.

## Data Points (informed by industry standards)

Based on intranet analytics best practices and fire department software standards:

### Section 1: User Adoption & Activity
| Metric | Source | Why it matters |
|--------|--------|----------------|
| Total users | `users` table count | Platform scale |
| Active users (logged in last 30 days) | `users.last_login_at` | Adoption rate — intranet benchmark is 75-80% weekly |
| Inactive users (no login in 30+ days) | Derived | Identifies disengaged members |
| New users (created last 30 days) | `users.created_at` | Growth trend |
| Login trend (daily logins, past 30 days) | `users.last_login_at` grouped by date | Engagement over time |
| Adoption rate % | `(active / total) * 100` | Key intranet KPI |

### Section 2: Module Usage
| Metric | Source | Why it matters |
|--------|--------|----------------|
| Module name + enabled status | `config.py` feature flags | Shows which modules are turned on |
| Record count per module | Count rows in each module's table | Shows actual usage vs just "enabled" |
| Last activity date per module | Most recent `created_at` in each table | Is the module actively being used? |

Modules to track: Events, Training, Scheduling, Inventory, Meetings, Elections, Forms, Documents, Apparatus

### Section 3: Operational Activity
| Metric | Source | Why it matters |
|--------|--------|----------------|
| Total events | `events` table count | Core platform activity |
| Events last 30 days | `events.created_at` filtered | Recent activity volume |
| Total check-ins | `event_attendance` count | Engagement with events |
| Training hours (last 30 days) | Training records | Compliance tracking — key for fire depts |
| Forms submitted (last 30 days) | `form_submissions` count | Content engagement |

### Section 4: System Health
| Metric | Source | Why it matters |
|--------|--------|----------------|
| Errors last 7 days | `error_logs` count | System reliability |
| Error trend (daily, past 7 days) | `error_logs.created_at` grouped | Spotting regressions |
| Top error types | `error_logs.error_type` grouped | Prioritize fixes |

### Section 5: Content & Documents
| Metric | Source | Why it matters |
|--------|--------|----------------|
| Total documents | `documents` table count | Content volume |
| Documents uploaded (last 30 days) | `documents.created_at` filtered | Content freshness |

---

## Backend Changes

### 1. New Pydantic schema
**File:** `backend/app/schemas/platform_analytics.py` (new)

```python
class DailyCount(BaseModel):
    date: str           # YYYY-MM-DD
    count: int

class ModuleUsage(BaseModel):
    name: str           # e.g. "Training", "Events"
    enabled: bool
    record_count: int
    last_activity: Optional[datetime]

class PlatformAnalyticsResponse(BaseModel):
    # User Adoption
    total_users: int
    active_users: int
    inactive_users: int
    new_users_last_30_days: int
    adoption_rate: float          # percentage
    login_trend: list[DailyCount] # past 30 days

    # Module Usage
    modules: list[ModuleUsage]

    # Operational Activity
    total_events: int
    events_last_30_days: int
    total_check_ins: int
    training_hours_last_30_days: float
    forms_submitted_last_30_days: int

    # System Health
    errors_last_7_days: int
    error_trend: list[DailyCount]
    top_error_types: dict[str, int]  # type -> count

    # Content
    total_documents: int
    documents_last_30_days: int

    generated_at: datetime
```

### 2. New endpoint: `GET /api/v1/platform-analytics`
**File:** `backend/app/api/v1/endpoints/platform_analytics.py` (new)

- **Permission:** `settings.manage`
- Queries each model independently with isolated try/catch per section
- Returns all-zero defaults if a module's table isn't available

### 3. Register in API router
**File:** `backend/app/api/v1/api.py` — add the new router with prefix `/platform-analytics`

---

## Frontend Changes

### 4. New page: `PlatformAnalyticsPage.tsx`
**File:** `frontend/src/pages/PlatformAnalyticsPage.tsx` (new)

Layout (following existing dashboard patterns):

1. **Header** — "Platform Analytics" title + last-refreshed timestamp + Export button
2. **Adoption cards** — 4 stat cards: Total Users, Active Users, Adoption Rate %, New Members
3. **Login trend chart** — 30-day bar chart of daily logins
4. **Module usage grid** — Cards per module showing enabled/disabled, record count, last activity
5. **Operational stats** — Events, Check-ins, Training Hours, Forms submitted
6. **System health** — Error count + 7-day trend + top error types
7. **Content stats** — Document counts

Auto-refresh every 60 seconds. Export data as JSON.

### 5. Frontend API service
**File:** `frontend/src/services/api.ts` — add `platformAnalyticsService` with `getAnalytics()` method

### 6. Route + Navigation
- **`App.tsx`**: Add lazy import + route at `/admin/platform-analytics` with `settings.manage`
- **`SideNavigation.tsx`**: Add "Platform Analytics" in Organization Settings (above QR Code Analytics), using `BarChart3` icon
- **`TopNavigation.tsx`**: Same
- **`routePrefetch.ts`**: Add prefetch entry

---

## What stays the same
- The existing **QR Code Analytics** page (`/admin/analytics`) is untouched
- No changes to existing endpoints, models, or services
- No new database tables needed — all queries use existing tables
