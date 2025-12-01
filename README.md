# 🚒 Fire Department Intranet Platform

## 🌟 Project Overview

This is an internal intranet built using **Python/Django** and **MySQL** designed to manage daily operations, track compliance, coordinate events, and handle official department governance (meetings and voting).

The architecture is designed for **flexibility** and **integration**:

  * **Hosting-Agnostic Documents:** Links to external hosts (SharePoint, Google Drive, Nextcloud).
  * **Granular Security:** Uses Object-Level Permissions for sensitive records.
  * **API-First Approach:** Enables easy connection to platforms like Vector Solutions and Salesforce.
  * **Responsive Design:** Optimized for desktop and mobile access, with an API backbone for a future native mobile app.

-----

## 🚀 Getting Started

### Prerequisites

  * **Python 3.9+**
  * **MySQL Server** (5.7+)
  * **pip** (Python package installer)

### ⚙️ Local Setup

1.  **Clone the Repository:**

    ```bash
    git clone https://github.com/thegspiro/fd-intranet
    cd fd-intranet
    ```

2.  **Create and Activate Virtual Environment:**

    ```bash
    python -m venv venv
    source venv/bin/activate  # Linux/macOS
    # .\venv\Scripts\activate  # Windows
    ```

3.  **Install Dependencies:**
    The project relies on `Django`, `mysqlclient`, `python-dotenv`, `django-guardian`, and `djangorestframework`.

    ```bash
    pip install -r requirements.txt
    ```

4.  **Database Configuration (Crucial for Security):**
    Copy the provided template to create your local secrets file. **This file MUST NOT be committed to Git.**

    ```bash
    cp env.template .env
    # Edit the .env file with your local MySQL and Django SECRET_KEY values.
    ```

5.  **Run Migrations:**

    ```bash
    python manage.py makemigrations
    python manage.py migrate
    ```

6.  **Create Superuser:**

    ```bash
    python manage.py createsuperuser
    ```

7.  **Run the Server:**

    ```bash
    python manage.py runserver
    ```

    The application will run at `http://127.0.0.1:8000/`.

-----

## 🔒 Configuration and Security Notes

### 1\. Initial Setup Wizard (First Run)

The system is configured to run a guided **Setup Wizard** on the first Superuser login. This process collects critical site variables:

| Variable Collected | Purpose |
| :--- | :--- |
| **Department Name, Timezone** | General utility and scheduling. |
| **Operational Scope** | Defines primary function: `FIRE_ONLY`, `FIRE_EMS`, or `EMS_ONLY`. |
| **Primary/Secondary Color** | Branding for all templates (HEX codes). |
| **Logo Upload** | Department visual identity. |
| **Initial Roles & Categories** | Auto-creates all 15 specific roles and initial document categories. |

### 2\. Object-Level Permissions (OLP)

The platform uses **`django-guardian`** to implement granular security.

  * **Usage:** Used specifically on the **`PersonnelRecord`** model (Annual Reviews, Certifications).
  * **Visibility:** Access is restricted on a **per-record basis** (e.g., only the Chief, the member, and the Compliance Officer can view a specific annual review document).

### 3\. API Security

All external APIs (using DRF) must be protected:

  * **Authentication:** Use **Token Authentication** or **API Key authentication** for machine-to-machine access.
  * **Transport:** **Always** deploy the production environment over **HTTPS**.

-----

## 🏗️ Application Structure and Core Models

### 1\. `config` App

  * **`SiteConfiguration` (Singleton):** Stores design variables, operational scope, and timezone settings.

### 2\. `accounts` App

  * **`FireDeptUser`:** Custom user model with `badge_number`, `certification_level`, etc.
  * **`PersonnelRecord`:** Tracks sensitive records with OLP enforced security.

### 3\. `tasks` App

Tracks operational checks and equipment status.

  * **`Equipment`:** Tracks all departmental apparatus (e.g., E1, M5, Reserve Engine) using a flexible `equipment_type` field, regardless of the overall `operational_scope`.
  * **`TaskTemplate` / `TaskInstance`:** Defines recurring checks and assigns them to users/equipment.

### 4\. `documents` App

  * **`Document`:** Stores metadata and the `file_url` (external link). Uses `is_archived` and `supersedes_document` to maintain a chain of **version history**.

### 5\. `meetings` App (New Governance Module)

Handles official business, attendance, and secure voting.

  * **`Meeting` / `Attendance`:** Tracks meeting structure and who was physically present.
  * **`Motion`:** Defines the vote question, duration, and **eligible voting roles** (Django Groups).
  * **`Ballot`:** Stores the unique, single-use token sent via email and the final vote choice.

-----

## 🗳️ Detailed Voting Logic and Permissions

The custom voting program is tightly integrated with the Role/Group system to ensure legitimacy.

### A. Role-Based Generation

When a vote is initiated, the system automatically filters eligible voters based on two criteria:

1.  **Attendance:** Must have an `Attendance` record for the relevant `Meeting`.
2.  **Role Eligibility:** The user must belong to one of the **`Motion.eligible_roles`** (e.g., only "Captain" and "Lieutenant" can vote on promotions).

### B. Voting Workflow

1.  **Initiation:** **Secretary, President, or Assistant Secretary** create the `Motion` and select eligible roles.
2.  **Ballots:** Unique `Ballot` objects are generated for each eligible attendee with a secure, single-use `unique_token`.
3.  **Email:** Ballots are sent via email with the unique link.
4.  **Confirmation:** Results are tabulated automatically upon deadline, but must be **manually confirmed** by an officer before any subsequent events (like creating a new task or policy document) are triggered.

-----

## 🔌 API Integration Points (DRF)

The platform exposes REST APIs for streamlined data exchange.

| Purpose | App / Model | API Endpoint Example | External Platform Example |
| :--- | :--- | :--- | :--- |
| **Personnel Sync** | `accounts.FireDeptUser` | `/api/v1/personnel/list/` | Vector Solutions (Training Roster) |
| **Training Compliance** | `accounts.PersonnelRecord` | `/api/v1/events/certs/` (POST) | Vector Solutions (Reporting course completion) |
| **Operational Status** | `tasks.Equipment` | `/api/v1/equipment/status/` | Mobile App / Dispatch Systems |
| **Fundraising/CRM** | `events.Event` | `/api/v1/metrics/events/` | Salesforce (Pulling event dates/goals) |

-----

## 💻 Key Management Links

  * **Custom Management Dashboard:** `http://127.0.0.1:8000/accounts/management/`
  * **Django Admin (Superuser Only):** `http://127.0.0.1:8000/admin/`
