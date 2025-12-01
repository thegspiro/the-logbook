**🚒 Fire Department Intranet Platform**

**🌟 Project Overview**
This is an internal intranet built using Python/Django and MySQL designed to manage daily operations, track compliance, coordinate events, and handle official department governance (meetings and voting).

The architecture is designed for flexibility and integration:
**Hosting-Agnostic Documents:** Links to external hosts (SharePoint, Google Drive, Nextcloud).
**Granular Security:** Uses Object-Level Permissions for sensitive records.
**API-First Approach:** Enables easy connection to platforms like Vector Solutions and Salesforce.
**Responsive Design:** Optimized for desktop and mobile access, with an API backbone for a future native mobile app.

**🚀 Getting Started**
Prerequisites
Python 3.9
+MySQL Server (5.7+)
pip (Python package installer)

**⚙️ Local Setup**
1. Clone the Repository:
Bash
git clone https://github.com/thegspiro/fd-intranet
cd fd-intranet

2. Create and Activate Virtual Environment:
Bash
python -m venv venv
source venv/bin/activate  # Linux/macOS
# .\venv\Scripts\activate  # Windows

3. Install Dependencies:
The project relies on Django, mysqlclient, python-dotenv, django-guardian, and djangorestframework.
Bash
pip install -r requirements.txt

4. Database Configuration (Crucial for Security):Copy the provided template to create your local secrets file. This file MUST NOT be committed to Git.
Bash
cp env.template .env
# Edit the .env file with your local MySQL and Django SECRET_KEY values.

5. Run Migrations:
Bash
python manage.py makemigrations
python manage.py migrate

6. Create Superuser:
Bash
python manage.py createsuperuser
Run the Server:Bashpython manage.py runserver
The application will run at http://127.0.0.1:8000/.🔒 Configuration and Security Notes1. Initial Setup Wizard (First Run)The system is configured to run a guided Setup Wizard on the first Superuser login. This process collects critical site variables:Variable CollectedPurposeDepartment Name, TimezoneGeneral utility and scheduling.Operational ScopeDefines primary function: FIRE_ONLY, FIRE_EMS, or EMS_ONLY.Primary/Secondary ColorBranding for all templates (HEX codes).Logo UploadDepartment visual identity.Initial Roles & CategoriesAuto-creates all 15 specific roles and initial document categories.2. Object-Level Permissions (OLP)The platform uses django-guardian to implement granular security.Usage: Used specifically on the PersonnelRecord model (Annual Reviews, Certifications).Visibility: Access is restricted on a per-record basis (e.g., only the Chief, the member, and the Compliance Officer can view a specific annual review document).3. API SecurityAll external APIs (using DRF) must be protected:Authentication: Use Token Authentication or API Key authentication for machine-to-machine access.Transport: Always deploy the production environment over HTTPS.🏗️ Application Structure and Core Models1. config AppSiteConfiguration (Singleton): Stores design variables, operational scope, and timezone settings.2. accounts AppFireDeptUser: Custom user model with badge_number, certification_level, etc.PersonnelRecord: Tracks sensitive records with OLP enforced security.3. tasks AppTracks operational checks and equipment status.Equipment: Tracks all departmental apparatus (e.g., E1, M5, Reserve Engine) using a flexible equipment_type field, regardless of the overall operational_scope.TaskTemplate / TaskInstance: Defines recurring checks and assigns them to users/equipment.4. documents AppDocument: Stores metadata and the file_url (external link). Uses is_archived and supersedes_document to maintain a chain of version history.5. meetings App (New Governance Module)Handles official business, attendance, and secure voting.Meeting / Attendance: Tracks meeting structure and who was physically present.Motion: Defines the vote question, duration, and eligible voting roles.Ballot: Stores the unique, single-use token sent via email and the final vote choice.🗳️ Detailed Voting Logic and PermissionsThe custom voting program is tightly integrated with the Role/Group system to ensure legitimacy.A. Role-Based GenerationWhen a vote is initiated, the system automatically filters eligible voters based on two criteria:Attendance: Must have an Attendance record for the relevant Meeting.Role Eligibility: The user must belong to one of the Motion.eligible_roles (e.g., only "Captain" and "Lieutenant" can vote on promotions).B. Voting WorkflowInitiation: Secretary, President, or Assistant Secretary create the Motion and select eligible roles.Ballots: Unique Ballot objects are generated for each eligible attendee with a secure, single-use unique_token.Email: Ballots are sent via email with the unique link.Confirmation: Results are tabulated automatically upon deadline, but must be manually confirmed by an officer before any subsequent events (like creating a new task or policy document) are triggered.🔌 API Integration Points (DRF)The platform exposes REST APIs for streamlined data exchange.PurposeApp / ModelAPI Endpoint ExampleExternal Platform ExamplePersonnel Syncaccounts.FireDeptUser/api/v1/personnel/list/Vector Solutions (Training Roster)Training Complianceaccounts.PersonnelRecord/api/v1/events/certs/ (POST)Vector Solutions (Reporting course completion)Operational Statustasks.Equipment/api/v1/equipment/status/Mobile App / Dispatch SystemsFundraising/CRMevents.Event/api/v1/metrics/events/Salesforce (Pulling event dates/goals)💻 Key Management LinksCustom Management Dashboard: http://127.0.0.1:8000/accounts/management/Django Admin (Superuser Only): http://127.0.0.1:8000/admin/
