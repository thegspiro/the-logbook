# Module Configuration

The Logbook uses a modular architecture — enable only the modules your organization needs.

---

## Enabling/Disabling Modules

### During Onboarding

The onboarding wizard includes a **Module Selection** step where you choose which modules to enable. You can also configure each module's settings during onboarding.

### After Onboarding

Navigate to **Settings > Modules** to enable or disable modules at any time. Changes take effect immediately.

### Via Environment Variables

Set module toggles in your `.env` file:

```bash
MODULE_TRAINING_ENABLED=true
MODULE_COMPLIANCE_ENABLED=true
MODULE_SCHEDULING_ENABLED=true
MODULE_ELECTIONS_ENABLED=true
MODULE_EVENTS_ENABLED=true
MODULE_INVENTORY_ENABLED=true
MODULE_FACILITIES_ENABLED=false
MODULE_APPARATUS_ENABLED=false
MODULE_ADMIN_HOURS_ENABLED=false
```

---

## Available Modules

### Core (Always Enabled)

| Module | Description |
|--------|-------------|
| **Members** | Member directory, profiles, admin management, audit history |
| **Dashboard** | Organization dashboard with module-specific widgets |
| **Documents** | File storage with folder hierarchy |
| **Notifications** | In-app and email notification system |
| **Settings** | Organization and system configuration |

### Optional Modules

| Module | Description | Dependencies |
|--------|-------------|-------------|
| **[Training](Module-Training)** | Training records, requirements, programs, compliance | — |
| **[Compliance](Module-Compliance)** | Compliance matrix, competency tracking, cert alerts | Training |
| **[Scheduling](Module-Scheduling)** | Shift scheduling, signup, swap/time-off requests | — |
| **[Events](Module-Events)** | Event management, QR check-in, reminders | — |
| **[Elections](Module-Elections)** | Ranked-choice voting, ballot forensics | — |
| **[Inventory](Module-Inventory)** | Equipment tracking, assignments, pool items, labels | — |
| **[Facilities](Module-Facilities)** | Building management, maintenance, inspections | — |
| **[Apparatus](Module-Apparatus)** | Vehicle management, crew positions, maintenance | — |
| **Forms** | Custom form builder with public forms and QR codes | — |
| **Meeting Minutes** | Meeting minutes with templates and publish workflow | — |
| **[Admin Hours](Module-Admin-Hours)** | Administrative hours tracking with QR code clock-in/clock-out | — |
| **Prospective Members** | Applicant pipeline with stages and election packages | — |

### Module Interactions

Some modules provide enhanced functionality when used together:

- **Scheduling + Apparatus**: Shifts can be linked to vehicles
- **Training + Events**: Events generate training sessions for attendance credit
- **Training + Scheduling**: Shift reports auto-credit training programs
- **Compliance + Training**: Compliance draws from training data
- **Elections + Prospective Members**: Pipeline stages can trigger election packages
- **Facilities vs Locations**: Facilities module replaces the lightweight Locations page
- **Apparatus Full vs Basic**: When disabled, a lightweight Apparatus Basic page is available
- **Elections + Meetings**: Elections can be linked to meeting records for procedural compliance

---

## Module-Specific Configuration

Each module may have its own settings page accessible after enabling:

| Module | Settings Location |
|--------|------------------|
| Training | Training Admin > Settings |
| Scheduling | Scheduling > Settings tab |
| Events | Events Admin > Settings |
| Inventory | Inventory Admin > Settings |
| Facilities | Facilities > Settings |
| Admin Hours | Admin Hours > Manage (categories, approval settings) |

---

**See also:** [Environment Variables](Configuration-Environment) | [Security Configuration](Configuration-Security)
