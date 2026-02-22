# The Logbook - Complete Error Message Catalog & Troubleshooting Guide

## Overview

This document catalogs **every error message** in The Logbook application (110+ errors across all modules), provides troubleshooting steps for each, and identifies messages that need improvement.

**Purpose**:
- ✅ Complete error message reference
- ✅ Troubleshooting guide for users
- ✅ Quality assessment for each message
- ✅ Roadmap for improvements
- ✅ Consistency standards

**Quality Ratings**:
- ✅ **GOOD** - Clear, specific, actionable
- ⚠️ **NEEDS IMPROVEMENT** - Vague or missing details
- ❌ **POOR** - Generic or unhelpful

---

## Table of Contents

1. [Logo Upload Errors](#logo-upload-errors)
2. [Email Configuration Errors](#email-configuration-errors)
3. [Form Validation Errors](#form-validation-errors)
4. [Password Validation Errors](#password-validation-errors)
5. [User Authentication Errors](#user-authentication-errors)
6. [Session & CSRF Errors](#session--csrf-errors)
7. [Database Errors](#database-errors)
8. [Organization Setup Errors](#organization-setup-errors)
9. [Role & Permission Errors](#role--permission-errors)
10. [Module Configuration Errors](#module-configuration-errors)
11. [Network & Connectivity Errors](#network--connectivity-errors)
12. [File System Errors](#file-system-errors)
13. [Documents Module Errors](#documents-module-errors)
14. [Meetings Module Errors](#meetings-module-errors)
15. [Scheduling Module Errors](#scheduling-module-errors)
16. [Reports Module Errors](#reports-module-errors)
17. [Notifications Module Errors](#notifications-module-errors)
18. [Inventory Module Errors](#inventory-module-errors)

---

## Logo Upload Errors

**Status**: ✅ GOOD - Recently improved with detailed messages

See separate document: [`docs/ERROR_MESSAGES_LOGO_UPLOAD.md`](./ERROR_MESSAGES_LOGO_UPLOAD.md)

### Summary of Logo Errors

| Error | Quality | Troubleshooting |
|-------|---------|-----------------|
| File size too large | ✅ GOOD | Resize image or compress before uploading |
| Unsupported file type | ✅ GOOD | Convert to PNG or JPEG |
| Image dimensions too large | ✅ GOOD | Resize to max 4096x4096 |
| Decompression bomb | ✅ GOOD | Use a different image source |
| Corrupted image | ✅ GOOD | Re-save image or try different file |

---

## Email Configuration Errors

### SMTP Connection Errors

#### 1. Missing Required Fields
**Message**: `"Please fill in all SMTP configuration fields"`

**Quality**: ⚠️ **NEEDS IMPROVEMENT** - Doesn't specify which fields

**Current Behavior**:
- Location: `frontend/src/modules/onboarding/pages/EmailConfiguration.tsx:91`
- Triggered when: Any required SMTP field is empty
- User sees: Generic message, no field list

**Should Say**:
```
"Missing required SMTP fields: Server Address, Port, Username"
```

**Troubleshooting**:
1. Check that SMTP server address is filled
2. Verify port number is set (usually 587 for TLS, 465 for SSL)
3. Ensure username and password are provided
4. Confirm "From Email" address is set

**Fix Priority**: HIGH

---

#### 2. Invalid Port Number
**Message**: `"Please enter a valid port number (1-65535)"`

**Quality**: ✅ **GOOD** - Shows valid range

**Current Behavior**:
- Location: `frontend/src/modules/onboarding/pages/EmailConfiguration.tsx:97`
- Triggered when: Port is not a number or outside 1-65535 range
- User sees: Clear constraint message

**Troubleshooting**:
1. Common SMTP ports:
   - **587**: STARTTLS (recommended)
   - **465**: SSL/TLS
   - **25**: Legacy (often blocked)
2. Check with your email provider for correct port
3. Verify port isn't blocked by firewall

**Fix Priority**: NONE - Already good

---

#### 3. SMTP Authentication Failed
**Message**: `"Authentication failed: [raw exception]"`

**Quality**: ⚠️ **NEEDS IMPROVEMENT** - Shows raw error

**Current Behavior**:
- Location: `backend/app/api/v1/test_email_helper.py:118`
- Triggered when: Username/password incorrect or auth method unsupported
- User sees: Technical exception like `(535, b'5.7.8 Username and Password not accepted')`

**Should Say**:
```
"SMTP authentication failed. Verify your username and password are correct."
```

**Troubleshooting**:
1. **Double-check credentials**: Username and password are case-sensitive
2. **App-specific password required**: Gmail and Outlook require app passwords, not your regular account password
3. **Two-factor authentication**: If enabled, generate an app-specific password
4. **Username format**: Some servers require full email address, others just username
5. **Account status**: Verify account isn't locked or disabled

**Fix Priority**: HIGH - Very common error

---

#### 4. Connection Refused
**Message**: `"SMTP error: [Errno 111] Connection refused"`

**Quality**: ⚠️ **NEEDS IMPROVEMENT** - Technical error code

**Current Behavior**:
- Location: `backend/app/api/v1/test_email_helper.py:130`
- Triggered when: Cannot connect to SMTP server
- User sees: Raw socket error

**Should Say**:
```
"Cannot connect to mail server at {host}:{port}. Verify the server address and port are correct."
```

**Troubleshooting**:
1. **Check server address**: Ensure no typos in hostname (e.g., `smtp.gmail.com`)
2. **Verify port**: Common ports are 587 (TLS) or 465 (SSL)
3. **Firewall**: Server firewall may be blocking outbound SMTP connections
4. **Network**: Check internet connectivity
5. **Server status**: Mail server might be down - check provider status page

**Fix Priority**: HIGH - Common during initial setup

---

#### 5. SMTP Timeout
**Message**: `"Connection timed out after {timeout} seconds"`

**Quality**: ⚠️ **NEEDS IMPROVEMENT** - Should suggest next steps

**Current Behavior**:
- Location: `backend/app/api/v1/test_email_helper.py:138`
- Triggered when: Server doesn't respond within timeout
- User sees: Timeout duration but no guidance

**Should Say**:
```
"Connection to {host}:{port} timed out. The server is unreachable or responding slowly. Check your server address and network connection."
```

**Troubleshooting**:
1. **Slow server**: Mail server is overloaded or responding slowly
2. **Wrong hostname**: Server address is incorrect
3. **Firewall blocking**: Network firewall blocking SMTP traffic
4. **DNS issues**: Hostname not resolving correctly
5. **Try again**: Temporary network congestion

**Fix Priority**: MEDIUM

---

#### 6. SSL/TLS Error
**Message**: `"Unexpected error: [SSL: WRONG_VERSION_NUMBER]"`

**Quality**: ⚠️ **NEEDS IMPROVEMENT** - Cryptic SSL error

**Current Behavior**:
- Location: `backend/app/api/v1/test_email_helper.py:142`
- Triggered when: TLS/SSL version mismatch
- User sees: Technical SSL exception

**Should Say**:
```
"SSL/TLS error. Try changing the encryption method (TLS on port 587, SSL on port 465)."
```

**Troubleshooting**:
1. **Port/encryption mismatch**:
   - Port 587 → Use **STARTTLS** encryption
   - Port 465 → Use **SSL/TLS** encryption
   - Port 25 → Usually **no encryption** or STARTTLS
2. **Server requirements**: Check provider documentation for encryption method
3. **Try both**: Test with STARTTLS and SSL/TLS to see which works
4. **Update certificates**: Server may have outdated SSL certificates

**Fix Priority**: HIGH - Common misconfiguration

---

### Gmail OAuth Errors

#### 7. Missing Google Client ID/Secret
**Message**: `"Google OAuth is not configured. Missing required credentials."`

**Quality**: ⚠️ **NEEDS IMPROVEMENT** - Should link to setup guide

**Current Behavior**:
- Location: `backend/app/api/v1/test_email_helper.py:177`
- Triggered when: OAuth environment variables not set
- User sees: Generic "not configured" message

**Should Say**:
```
"Google OAuth credentials missing. Set up OAuth in Google Cloud Console and add credentials to your .env file. See: [documentation link]"
```

**Troubleshooting**:
1. **Create OAuth credentials**:
   - Go to [Google Cloud Console](https://console.cloud.google.com)
   - Create OAuth 2.0 Client ID
   - Set redirect URI to your app URL
2. **Add to .env file**:
   ```
   GOOGLE_CLIENT_ID=your_client_id
   GOOGLE_CLIENT_SECRET=your_client_secret
   ```
3. **Restart backend** to load new environment variables
4. **Enable Gmail API** in Google Cloud Console

**Fix Priority**: MEDIUM - Add documentation link

---

#### 8. Invalid Google Client ID Format
**Message**: `"Invalid Google Client ID format"`

**Quality**: ✅ **GOOD** - Specific validation failure

**Current Behavior**:
- Location: `backend/app/api/v1/test_email_helper.py:192`
- Triggered when: Client ID doesn't match Google's format
- User sees: Clear validation message

**Troubleshooting**:
1. **Verify format**: Google Client IDs end with `.apps.googleusercontent.com`
2. **Check copy/paste**: Ensure no extra spaces or characters
3. **Regenerate**: Create new OAuth credentials if corrupted
4. **Environment variable**: Verify correct variable name in .env

**Fix Priority**: NONE - Already good

---

#### 9. Google OAuth Token Exchange Failed
**Message**: `"Failed to exchange authorization code for tokens: {error}"`

**Quality**: ⚠️ **NEEDS IMPROVEMENT** - Raw error details

**Current Behavior**:
- Location: `backend/app/api/v1/test_email_helper.py:204`
- Triggered when: OAuth token exchange fails
- User sees: Raw API error response

**Should Say**:
```
"Google authentication failed. The authorization code may have expired. Try reconnecting your Google account."
```

**Troubleshooting**:
1. **Authorization code expired**: Valid for ~10 minutes - start over
2. **Redirect URI mismatch**: Verify redirect URI in Google Console matches app
3. **Invalid client credentials**: Double-check Client ID and Secret
4. **Revoked access**: User may have revoked app access in Google Account settings
5. **Try again**: Click "Connect with Google" to restart OAuth flow

**Fix Priority**: MEDIUM

---

### Microsoft OAuth Errors

#### 10. Missing Microsoft Credentials
**Message**: `"Microsoft OAuth is not configured. Missing required credentials (client_id, client_secret, tenant_id)."`

**Quality**: ✅ **GOOD** - Lists specific missing fields

**Current Behavior**:
- Location: `backend/app/api/v1/test_email_helper.py:309`
- Triggered when: Microsoft OAuth env vars not set
- User sees: Clear list of required credentials

**Troubleshooting**:
1. **Register app in Azure**:
   - Go to [Azure Portal](https://portal.azure.com)
   - Navigate to Azure Active Directory → App registrations
   - Create new registration
2. **Get credentials**:
   - **Client ID**: From app overview
   - **Client Secret**: Create in Certificates & secrets
   - **Tenant ID**: From app overview
3. **Add to .env**:
   ```
   MICROSOFT_CLIENT_ID=your_client_id
   MICROSOFT_CLIENT_SECRET=your_secret
   MICROSOFT_TENANT_ID=your_tenant_id
   ```
4. **Set redirect URI**: Add to app registration
5. **Grant permissions**: Add Mail.Send API permission

**Fix Priority**: NONE - Already good

---

#### 11. Microsoft OAuth Error Codes
**Message**: Maps specific error codes to readable messages

**Quality**: ✅ **GOOD** - Detailed error code mapping

**Current Behavior**:
- Location: `backend/app/api/v1/test_email_helper.py:408-415`
- Provides specific guidance for each error code

**Error Code Mappings**:

| Code | Message | Troubleshooting |
|------|---------|-----------------|
| `invalid_client` | Client authentication failed | Verify Client ID and Secret |
| `invalid_grant` | Authorization code expired or revoked | Restart OAuth flow |
| `invalid_request` | Request is missing a required parameter | Check OAuth configuration |
| `unauthorized_client` | Client not authorized for this grant type | Verify app permissions in Azure |
| `unsupported_grant_type` | Grant type not supported | Use authorization_code grant |

**Fix Priority**: NONE - Already good

---

## Form Validation Errors

### Department Information

#### 12. Department Name Required
**Message**: `"Please enter your department name"`

**Quality**: ✅ **GOOD** - Clear and direct

**Troubleshooting**: Enter your fire department or organization name

**Fix Priority**: NONE

---

#### 13. Department Name Too Short
**Message**: `"Department name must be at least 3 characters"`

**Quality**: ✅ **GOOD** - Shows minimum requirement

**Troubleshooting**: Use full department name, not abbreviation (e.g., "Fire Department" not "FD")

**Fix Priority**: NONE

---

#### 14. Department Name Too Long
**Message**: `"Department name must be less than 100 characters"`

**Quality**: ✅ **GOOD** - Shows maximum limit

**Troubleshooting**: Abbreviate or shorten the name to fit within 100 characters

**Fix Priority**: NONE

---

### Organization Setup

#### 15. Generic Form Validation Error
**Message**: `"Please fix the errors before continuing"`

**Quality**: ❌ **POOR** - No details about what's wrong

**Current Behavior**:
- Location: `frontend/src/modules/onboarding/pages/OrganizationSetup.tsx:561`
- Triggered when: Form has validation errors
- User sees: Generic message, no error list

**Should Say**:
```
"Please fix the following errors:
• Organization name is required
• Tax ID must be exactly 9 digits (currently 8)
• Physical address ZIP code is invalid"
```

**Troubleshooting**:
1. **Check required fields**: Name, type, timezone
2. **Validate formats**:
   - Tax ID: 9 digits (XX-XXXXXXX)
   - ZIP codes: 5 digits or ZIP+4 format
   - Phone: Valid format with area code
3. **Review addresses**: Complete street, city, state, ZIP

**Fix Priority**: **CRITICAL** - Users can't tell what's wrong

---

#### 16. Invalid Tax ID Format
**Message**: Currently not shown - validation exists but error not surfaced

**Quality**: ❌ **POOR** - Silent validation failure

**Should Say**:
```
"Tax ID must be exactly 9 digits in format XX-XXXXXXX"
```

**Troubleshooting**:
1. Format: 12-3456789 (2 digits, dash, 7 digits)
2. Numbers only (no letters)
3. For 501(c)(3) organizations (EIN format)

**Fix Priority**: HIGH

---

#### 17. Invalid Phone Number
**Message**: Currently not shown - needs validation

**Quality**: ❌ **POOR** - No validation implemented

**Should Say**:
```
"Phone number must be in format (XXX) XXX-XXXX or XXX-XXX-XXXX"
```

**Troubleshooting**:
1. Include area code
2. 10 digits total
3. Format: (555) 123-4567 or 555-123-4567

**Fix Priority**: MEDIUM

---

#### 18. Invalid ZIP Code
**Message**: Currently not shown - needs validation

**Quality**: ❌ **POOR** - No validation

**Should Say**:
```
"ZIP code must be 5 digits (XXXXX) or ZIP+4 format (XXXXX-XXXX)"
```

**Troubleshooting**:
1. 5-digit format: 22101
2. ZIP+4 format: 22101-1234
3. Numbers only

**Fix Priority**: MEDIUM

---

#### 19. Organization Name Already Exists
**Message**: Currently not implemented

**Quality**: ❌ **POOR** - No duplicate check

**Should Say**:
```
"Organization name 'Arlington Fire Department' is already in use. Names must be unique."
```

**Troubleshooting**:
1. Add distinguishing info (e.g., "Arlington Fire Department - Station 5")
2. Use abbreviation differently
3. Add city/county identifier

**Fix Priority**: MEDIUM

---

### Email Configuration

#### 20. From Email Invalid
**Message**: `"Please enter a valid email address"`

**Quality**: ✅ **GOOD** - Clear requirement

**Troubleshooting**:
1. Format: user@domain.com
2. Valid domain with TLD
3. No spaces or special characters except @ and .

**Fix Priority**: NONE

---

#### 21. From Email Required
**Message**: `"Please enter a from email address"`

**Quality**: ✅ **GOOD** - Specific field identified

**Troubleshooting**: Specify the email address that will appear in the "From" field of sent emails

**Fix Priority**: NONE

---

## Password Validation Errors

### Password Requirements

#### 22. Password Too Short
**Message**: `"Password must be at least 12 characters long"`

**Quality**: ✅ **GOOD** - Shows minimum length

**Current Behavior**:
- Location: `backend/app/core/security.py:142`
- Shows only this error even if multiple requirements fail

**Troubleshooting**: Increase password length to 12+ characters

**Fix Priority**: MEDIUM - Should show all failing requirements at once

---

#### 23. Missing Uppercase Letters
**Message**: `"Password must contain uppercase letters"`

**Quality**: ⚠️ **NEEDS IMPROVEMENT** - Should show examples

**Current Behavior**:
- Shown only if this is the first failing requirement
- No indication of how many needed

**Should Say**:
```
"Password must contain at least one uppercase letter (A-Z)"
```

**Troubleshooting**: Add at least one capital letter (A-Z)

**Fix Priority**: MEDIUM

---

#### 24. Missing Lowercase Letters
**Message**: `"Password must contain lowercase letters"`

**Quality**: ⚠️ **NEEDS IMPROVEMENT**

**Should Say**:
```
"Password must contain at least one lowercase letter (a-z)"
```

**Troubleshooting**: Add at least one lowercase letter (a-z)

**Fix Priority**: MEDIUM

---

#### 25. Missing Numbers
**Message**: `"Password must contain numbers"`

**Quality**: ⚠️ **NEEDS IMPROVEMENT**

**Should Say**:
```
"Password must contain at least one number (0-9)"
```

**Troubleshooting**: Add at least one digit (0-9)

**Fix Priority**: MEDIUM

---

#### 26. Missing Special Characters
**Message**: `"Password must contain special characters"`

**Quality**: ⚠️ **NEEDS IMPROVEMENT** - Should list valid characters

**Should Say**:
```
"Password must contain at least one special character (!@#$%^&*()_+-=[]{}:\"\\|,.<>?/)"
```

**Troubleshooting**: Add a special character like !@#$%^&*

**Fix Priority**: MEDIUM

---

#### 27. Sequential Characters
**Message**: `"Password cannot contain sequential characters (abc, 123)"`

**Quality**: ✅ **GOOD** - Shows examples

**Troubleshooting**:
1. Avoid: abc, xyz, 123, 456, qwerty
2. Mix characters: a1b2c3 instead of abc123

**Fix Priority**: NONE

---

#### 28. Repeated Characters
**Message**: `"Password cannot contain 3 or more repeated characters"`

**Quality**: ✅ **GOOD** - Shows limit

**Troubleshooting**:
1. Avoid: aaa, 111, !!!
2. Maximum 2 consecutive same characters

**Fix Priority**: NONE

---

#### 29. Common Password
**Message**: `"Password is too common. Please choose a more unique password."`

**Quality**: ⚠️ **NEEDS IMPROVEMENT** - Should suggest alternatives

**Should Say**:
```
"This password is too common and easily guessed. Create a unique password combining unrelated words, numbers, and symbols."
```

**Troubleshooting**:
1. Don't use: password123, admin2024, qwerty, etc.
2. Use passphrase: Combine random words (e.g., "Correct!Horse$Battery9Staple")
3. Avoid personal info: names, birthdates, addresses

**Fix Priority**: MEDIUM

---

#### 30. Keyboard Patterns
**Message**: `"Password cannot contain keyboard patterns (qwerty, asdf)"`

**Quality**: ✅ **GOOD** - Shows examples

**Troubleshooting**:
1. Avoid keyboard rows: qwerty, asdfgh, zxcvbn
2. Avoid keyboard patterns: 1qaz2wsx, qwertyuiop

**Fix Priority**: NONE

---

### Password Validation - Multiple Errors

**Issue**: Currently returns first error only

**Location**: `backend/app/core/security.py:174`

**Should Return All Errors**:
```
"Password requirements not met:
 • Must be at least 12 characters (currently 8)
 • Must contain uppercase letters
 • Must contain numbers
 • Must contain special characters (!@#$%^&*)"
```

**Fix Priority**: **HIGH** - Poor UX to fix one error at a time

---

## User Authentication Errors

### Login Errors

#### 31. Incorrect Credentials
**Message**: `"Incorrect username or password"`

**Quality**: ✅ **GOOD** - Doesn't reveal which is wrong (security)

**Current Behavior**:
- Location: `backend/app/api/v1/endpoints/auth.py:123`
- Intentionally vague for security

**Troubleshooting**:
1. **Check username**: Case-sensitive, no spaces
2. **Verify password**: Ensure caps lock is off
3. **Try password reset**: If forgotten
4. **Check account status**: May be inactive

**Fix Priority**: NONE - Intentionally vague for security

---

#### 32. Account Inactive
**Message**: `"Account is inactive. Please contact an administrator."`

**Quality**: ✅ **GOOD** - Clear action required

**Troubleshooting**:
1. Contact system administrator
2. Account may be:
   - Suspended
   - Pending approval
   - Disabled due to inactivity
   - Soft-deleted

**Fix Priority**: NONE

---

### User Registration Errors

#### 33. Username Already Exists
**Message**: `"Username already exists"`

**Quality**: ⚠️ **NEEDS IMPROVEMENT** - Should clarify scope

**Current Behavior**:
- Location: `backend/app/services/auth_service.py:243`
- Checks across all users (including soft-deleted)

**Should Say**:
```
"Username 'john_doe' is already in use. Choose a different username."
```

**For soft-deleted users**:
```
"Username 'john_doe' is reserved from a previous account. Choose a different username or contact an administrator to reactivate."
```

**Troubleshooting**:
1. Try variations: john.doe, jdoe, john_doe2
2. Add numbers: john_doe1, john_doe24
3. Contact admin if you previously had this username

**Fix Priority**: MEDIUM - Confusing for soft-deleted accounts

---

#### 34. Email Already Exists
**Message**: `"Email already exists"`

**Quality**: ⚠️ **NEEDS IMPROVEMENT** - Should clarify scope

**Current Behavior**:
- Location: `backend/app/services/auth_service.py:254`
- Checks all users including soft-deleted

**Should Say**:
```
"Email 'user@example.com' is already registered. Use a different email or reset your password if this is your account."
```

**Troubleshooting**:
1. Use different email address
2. Check if you already have an account
3. Try password reset if you forgot credentials
4. Contact admin if account was deleted

**Fix Priority**: MEDIUM

---

#### 35. Invalid Email Format
**Message**: Currently handled by frontend, backend accepts anything

**Quality**: ⚠️ **NEEDS IMPROVEMENT** - Backend should validate

**Should Say**:
```
"Invalid email format. Must be in format: user@domain.com"
```

**Troubleshooting**:
1. Format: username@domain.tld
2. Valid characters: letters, numbers, dots, hyphens
3. Must have @ symbol and domain
4. Domain must have TLD (.com, .org, etc.)

**Fix Priority**: MEDIUM - Backend validation needed

---

#### 36. Invalid Username Format
**Message**: Currently handled by frontend only

**Quality**: ⚠️ **NEEDS IMPROVEMENT** - Backend should validate

**Should Say**:
```
"Username must be 3-20 characters. Letters, numbers, underscores, and hyphens only."
```

**Troubleshooting**:
1. Length: 3-20 characters
2. Allowed: a-z, A-Z, 0-9, _, -
3. No spaces or special characters
4. Cannot start or end with hyphen/underscore

**Fix Priority**: MEDIUM

---

### Admin User Creation (Onboarding)

#### 37. Generic User Creation Error
**Message**: Error from backend, displayed generically

**Quality**: ❌ **POOR** - No field-specific feedback

**Current Behavior**:
- Location: `frontend/src/modules/onboarding/pages/AdminUserCreation.tsx:171`
- Throws generic error without parsing backend response

**Should Parse and Show**:
```
"Username 'admin' is already taken. Try 'admin2' or 'admin_fcvfd'."
"Email 'admin@fcvfd.org' is already registered."
"Password does not meet requirements. See details above."
```

**Troubleshooting**:
1. **Username conflicts**: Try variations or add organization identifier
2. **Email conflicts**: Use different email or check existing accounts
3. **Password issues**: Review password requirements checklist
4. **Display name**: Should be full name (2-50 characters)

**Fix Priority**: **HIGH** - Critical onboarding step

---

## Session & CSRF Errors

#### 38. Session ID Required
**Message**: `"Session ID required. Please start onboarding first."`

**Quality**: ✅ **GOOD** - Clear action

**Troubleshooting**:
1. Click "Start Onboarding" button
2. Ensure browser cookies enabled
3. Don't block sessionStorage
4. Try different browser if issues persist

**Fix Priority**: NONE

---

#### 39. Invalid Session
**Message**: `"Invalid session. Please restart onboarding."`

**Quality**: ✅ **GOOD** - Clear action

**Troubleshooting**:
1. Session ID corrupted or tampered
2. Start new onboarding session
3. Clear browser cache/cookies
4. Use incognito/private window

**Fix Priority**: NONE

---

#### 40. Session Expired
**Message**: `"Session expired. Please restart onboarding."`

**Quality**: ✅ **GOOD** - Clear reason and action

**Troubleshooting**:
1. Sessions expire after inactivity
2. Restart onboarding process
3. Complete setup in one session if possible
4. Data may be preserved in browser storage

**Fix Priority**: NONE

---

#### 41. CSRF Validation Failed
**Message**: `"CSRF validation failed. Please refresh and try again."`

**Quality**: ✅ **GOOD** - Clear action

**Troubleshooting**:
1. Refresh the page (F5)
2. Try again after refresh
3. Clear browser cache
4. Check browser security extensions (may block)
5. Ensure JavaScript enabled

**Fix Priority**: NONE

---

## Database Errors

### Duplicate Entry Errors

#### 42. Apparatus Type Code Duplicate
**Message**: `"Apparatus type with code '{code}' already exists"`

**Quality**: ✅ **GOOD** - Shows conflicting value

**Troubleshooting**:
1. Use different code
2. Check existing apparatus types
3. Codes must be unique

**Fix Priority**: NONE

---

#### 43. Apparatus Unit Number Duplicate
**Message**: `"Apparatus with unit number '{unit_number}' already exists"`

**Quality**: ✅ **GOOD** - Shows conflict

**Troubleshooting**:
1. Use different unit number
2. Check existing apparatus
3. Unit numbers must be unique per organization

**Fix Priority**: NONE

---

### Foreign Key Violations

#### 44. Generic Foreign Key Error
**Message**: Not currently caught - database error shown

**Quality**: ❌ **POOR** - Technical database error

**Should Say**:
```
"Cannot delete [entity] because it is referenced by other records. Remove references first."
```

**Troubleshooting**:
1. Check what references this record
2. Delete dependent records first
3. Or update references to point elsewhere

**Fix Priority**: HIGH - Database errors confuse users

---

### Unique Constraint Violations

#### 45. Generic Unique Constraint Error
**Message**: Not currently caught - database error shown

**Quality**: ❌ **POOR** - Raw database error

**Should Say**:
```
"[Field name] must be unique. The value '[value]' is already in use."
```

**Troubleshooting**:
1. Identify which field is duplicate
2. Use different value
3. Check existing records

**Fix Priority**: HIGH

---

## Role & Permission Errors

#### 46. Failed to Save Role Configuration
**Message**: `"Failed to save role configuration. Please try again."`

**Quality**: ❌ **POOR** - No details

**Current Behavior**:
- Location: `frontend/src/modules/onboarding/pages/RoleSetup.tsx:440`
- Generic error regardless of actual issue

**Should Say**:
```
"Role name 'Admin' already exists. Choose a different name."
"View permissions are required. Select at least one View permission."
"Role description is required."
```

**Troubleshooting**:
1. **Duplicate names**: Use unique role names
2. **Missing permissions**: Assign at least View access
3. **Invalid combinations**: Manage requires View
4. **Description**: Provide meaningful description

**Fix Priority**: **HIGH** - Common configuration step

---

## Module Configuration Errors

#### 47. Failed to Save Module Configuration
**Message**: `"Failed to save module configuration"` (or empty error)

**Quality**: ❌ **POOR** - No details

**Current Behavior**:
- Location: `frontend/src/modules/onboarding/pages/ModuleSelection.tsx:108`
- Generic fallback message

**Should Say**:
```
"Module '[name]' requires '[dependency]' to be enabled first."
"At least one module must be enabled."
"Invalid module configuration: [specific error]"
```

**Troubleshooting**:
1. **Dependencies**: Enable required modules first (e.g., Elections may need User Management)
2. **Minimum required**: Some modules may be mandatory
3. **Conflicts**: Certain modules can't be used together

**Fix Priority**: MEDIUM

---

## Network & Connectivity Errors

#### 48. API Connection Failed
**Message**: Varies - often `"Failed to fetch"` or network error

**Quality**: ⚠️ **NEEDS IMPROVEMENT** - Browser default messages

**Should Say**:
```
"Cannot connect to server. Check your internet connection and try again."
"Server is not responding. Please try again in a few moments."
```

**Troubleshooting**:
1. **Check internet**: Verify network connection
2. **Server status**: Backend may be down
3. **Firewall**: Corporate firewall may block
4. **Retry**: Temporary network issue
5. **Browser console**: Check for CORS or network errors

**Fix Priority**: MEDIUM - Need consistent network error handling

---

#### 49. Request Timeout
**Message**: Browser default timeout error

**Quality**: ⚠️ **NEEDS IMPROVEMENT**

**Should Say**:
```
"Request timed out. The server is taking too long to respond. Try again."
```

**Troubleshooting**:
1. Server overloaded
2. Slow network connection
3. Large file upload (logo)
4. Database migration running
5. Retry request

**Fix Priority**: MEDIUM

---

#### 50. CORS Error
**Message**: Browser CORS error in console

**Quality**: ❌ **POOR** - Only visible in developer tools

**Should Say** (to user):
```
"Configuration error: Server access blocked. Contact your administrator."
```

**Troubleshooting** (for admins):
1. Add frontend URL to ALLOWED_ORIGINS in .env
2. Format: `http://localhost:3000,http://192.168.1.100:3000`
3. Restart backend after .env changes
4. Check CORS middleware configuration

**Fix Priority**: LOW - Admin issue, not user-facing

---

## File System Errors

#### 51. Failed to Read Image File
**Message**: `"Failed to read image file"`

**Quality**: ⚠️ **NEEDS IMPROVEMENT** - No details

**Current Behavior**:
- Location: `frontend/src/modules/onboarding/pages/DepartmentInfo.tsx:70`
- Generic FileReader error

**Should Say**:
```
"Cannot read file '[filename]'. The file may be corrupted or in an unsupported format."
"Permission denied reading '[filename]'. Try saving the file and uploading again."
```

**Troubleshooting**:
1. **Corrupted file**: Re-save image in photo editor
2. **Wrong format**: Convert to PNG or JPEG
3. **File permissions**: File may be read-protected
4. **Browser issue**: Try different browser
5. **Re-download**: If from internet, download again

**Fix Priority**: MEDIUM

---

## Summary Tables

### Error Quality by Category

| Category | Total Errors | ✅ Good | ⚠️ Needs Work | ❌ Poor |
|----------|--------------|---------|---------------|---------|
| Logo Upload | 12 | 12 | 0 | 0 |
| Email Config | 11 | 3 | 6 | 2 |
| Form Validation | 8 | 3 | 0 | 5 |
| Password | 10 | 4 | 5 | 1 |
| Authentication | 6 | 2 | 3 | 1 |
| Session/CSRF | 4 | 4 | 0 | 0 |
| Database | 4 | 2 | 0 | 2 |
| Roles | 1 | 0 | 0 | 1 |
| Modules | 1 | 0 | 0 | 1 |
| Network | 3 | 0 | 2 | 1 |
| File System | 1 | 0 | 1 | 0 |
| **TOTAL** | **61** | **30** | **17** | **14** |

**Overall Quality**: 49% Good, 28% Needs Work, 23% Poor

---

### Fix Priority Summary

| Priority | Count | Examples |
|----------|-------|----------|
| **CRITICAL** | 1 | Organization setup form errors |
| **HIGH** | 8 | SMTP errors, admin user creation, role config |
| **MEDIUM** | 11 | Password validation, email duplicates, modules |
| **LOW** | 1 | CORS (admin-facing) |
| **NONE** | 40 | Already good quality |

---

### Top 10 Errors to Fix

1. **Organization form validation** - Shows "fix errors" but doesn't list them (CRITICAL)
2. **SMTP authentication failed** - Raw exception shown to users (HIGH)
3. **Admin user creation** - Generic error, no field details (HIGH)
4. **Connection refused** - Technical error code, should explain (HIGH)
5. **Role save failed** - No details on what's wrong (HIGH)
6. **SSL/TLS error** - Cryptic SSL exception (HIGH)
7. **Password validation** - Only shows first error, not all (HIGH)
8. **Missing SMTP fields** - Doesn't specify which (HIGH)
9. **Email already exists** - Should explain soft-delete reservation (MEDIUM)
10. **Username already exists** - Should explain soft-delete reservation (MEDIUM)

---

## Error Message Standards

### Guidelines for All Error Messages

**DO**:
- ✅ Be specific about what failed
- ✅ Include actual values vs. expected values
- ✅ Provide clear next steps
- ✅ Use consistent tone and terminology
- ✅ Show limits and constraints
- ✅ List all failing validations at once

**DON'T**:
- ❌ Show raw exceptions or stack traces
- ❌ Use technical jargon (errno, SMTP codes, etc.)
- ❌ Say "Something went wrong" or "Error occurred"
- ❌ Reference server logs users can't access
- ❌ Show only first error when multiple exist
- ❌ Use vague terms like "invalid" without explanation

### Error Message Format

```
[What failed]: [Specific reason]. [Action to fix].

Example:
"Image too large: 7.50MB (max 5MB). Reduce image size and try again."
```

### Troubleshooting Section Format

Every error should have:
1. **Immediate fix**: Quick action user can take
2. **Common causes**: Why this happens
3. **Related issues**: Similar problems to check
4. **When to escalate**: Contact admin if needed

---

## Implementation Roadmap

### Phase 1: Critical Fixes (Week 1)
- Organization form validation error listing
- SMTP error message mapping
- Admin user creation field-specific errors

### Phase 2: High Priority (Week 2)
- Role configuration error details
- SSL/TLS error user-friendly messages
- Password validation show-all-errors
- Missing SMTP field listing

### Phase 3: Medium Priority (Week 3-4)
- Email/username duplicate clarification
- Module configuration error details
- Network error standardization
- File read error specifics

### Phase 4: Polish (Week 5)
- Consistent error formatting across app
- Comprehensive frontend validation
- Backend validation for all inputs
- Error message testing

---

## Related Documentation

- [`SECURITY_IMAGE_UPLOADS.md`](../SECURITY_IMAGE_UPLOADS.md) - Image security details
- [`ERROR_MESSAGES_LOGO_UPLOAD.md`](./ERROR_MESSAGES_LOGO_UPLOAD.md) - Logo upload errors
- [`ONBOARDING.md`](../ONBOARDING.md) - Onboarding module guide
- [`DEPLOYMENT.md`](../docs/DEPLOYMENT.md) - Deployment troubleshooting

---

**Document Version**: 1.1
**Last Updated**: 2026-02-12
**Total Errors Documented**: 75+
**Maintainer**: Development Team

---

## Security & Session Errors (Added 2026-02-12)

### Session Inactivity

#### 62. Inactivity Timeout
**Message**: `"You have been logged out due to inactivity."`

**Quality**: ✅ **GOOD** - Clear reason, appears on login redirect

**Current Behavior**:
- Location: `frontend/src/components/layout/AppLayout.tsx:33`
- Triggered when: No user activity (mouse/keyboard/scroll/touch) for 30 minutes
- User sees: Redirected to login page with message

**Troubleshooting**: Log in again. No data loss for saved work.

---

### Password Reset

#### 63. Invalid Reset Link
**Message**: `"Invalid password reset link. Please request a new reset link from the login page."`

**Quality**: ✅ **GOOD** - Clear action with guidance

**Current Behavior**:
- Location: `backend/app/api/v1/endpoints/auth.py:525`
- Triggered when: POST to validate-reset-token with missing token

---

#### 64. Expired Reset Token
**Message**: `"This password reset link has expired. Reset links are valid for 30 minutes. Please request a new one from the login page."`

**Quality**: ✅ **GOOD** - Shows expiry duration and next step

**Current Behavior**:
- Location: `backend/app/services/auth_service.py:602`
- Triggered when: Reset token older than 30 minutes

---

#### 65. Used/Invalid Reset Token
**Message**: `"This password reset link is invalid or has already been used. Please request a new reset link from the login page."`

**Quality**: ✅ **GOOD** - Covers both cases, clear next step

**Current Behavior**:
- Location: `backend/app/services/auth_service.py:592`
- Triggered when: Token not found (already used, or invalid)

---

### Logout Errors

#### 66. Logout Session Error
**Message**: `"Unable to end your session. Please close your browser and log in again."`

**Quality**: ✅ **GOOD** - Provides workaround

**Current Behavior**:
- Location: `backend/app/api/v1/endpoints/auth.py:253`
- Triggered when: Server-side session invalidation fails

---

#### 67. Logout Auth Error
**Message**: `"Unable to process logout. Please clear your browser data and log in again."`

**Quality**: ✅ **GOOD** - Provides alternative action

**Current Behavior**:
- Location: `backend/app/api/v1/endpoints/auth.py:244`
- Triggered when: Authorization header is malformed

---

### Token Refresh

#### 68. Expired Session (Token Refresh)
**Message**: `"Your session has expired. Please log in again."`

**Quality**: ✅ **GOOD** - Non-technical, clear action

**Current Behavior**:
- Location: `backend/app/api/v1/endpoints/auth.py:215`
- Triggered when: Refresh token is invalid/expired

---

### Onboarding Session

#### 69. Onboarding Session Expired
**Message**: `"Your onboarding session has expired due to inactivity (30-minute limit). Please refresh the page to start a new session. Your previously saved progress will be retained."`

**Quality**: ✅ **GOOD** - Shows time limit, reassures about data

**Current Behavior**:
- Location: `backend/app/api/v1/onboarding.py:432`
- Triggered when: Onboarding session exceeds 30-minute inactivity window

---

#### 70. Organization Must Be Created First
**Message**: `"Organization must be created before adding an admin user. Please complete the organization setup step first."`

**Quality**: ✅ **GOOD** - Guides user to correct step

---

#### 71. Organization Not Found During Admin Creation
**Message**: `"Organization not found. The organization setup may not have completed. Please go back and complete the organization setup step."`

**Quality**: ✅ **GOOD** - Explains likely cause and action

---

### Password Change

#### 72. Incorrect Current Password
**Message**: `"Current password is incorrect. Please verify your existing password and try again."`

**Quality**: ✅ **GOOD** - Clear and non-technical

---

### Production Security

#### 73. Missing Encryption Salt (Production)
**Message**: `"ENCRYPTION_SALT must be set in production. Generate one with: python -c \"import secrets; print(secrets.token_hex(16))\""`

**Quality**: ✅ **GOOD** - Includes generation command

**Current Behavior**:
- Location: `backend/app/core/security.py:201`
- Triggered when: ENCRYPTION_SALT env var not set in production
- Application will not start until configured

---

### Bulk Import

#### 74. Bulk Import Size Exceeded
**Message**: Pydantic validation error for list exceeding 500 items

**Quality**: ⚠️ **NEEDS IMPROVEMENT** - Pydantic default message

**Current Behavior**:
- Location: `backend/app/schemas/training.py:555`
- Triggered when: More than 500 external_import_ids submitted

**Troubleshooting**: Split imports into batches of 500 or fewer records.

---

## Documents Module Errors

### Document Operations

#### 75. Unable to Load Documents
**Message**: `"Unable to load documents. Please check your connection and try again."`

**Quality**: ✅ **GOOD** - Standard error pattern with action

**Current Behavior**:
- Location: `frontend/src/pages/DocumentsPage.tsx`
- Triggered when: GET `/api/v1/documents/` or `/api/v1/documents/summary` fails

**Troubleshooting**: Check network connection, verify backend is running, ensure `documents` table exists.

---

#### 76. Unable to Upload Document
**Message**: `"Unable to upload the document. Please check your input and try again."`

**Quality**: ✅ **GOOD** - Clear action guidance

**Current Behavior**:
- Location: `frontend/src/pages/DocumentsPage.tsx`
- Triggered when: POST `/api/v1/documents/` with FormData fails

**Troubleshooting**: Check file size limits, verify required fields (name), ensure folder exists.

---

#### 77. Unable to Create Folder
**Message**: `"Unable to create the folder. Please check your input and try again."`

**Quality**: ✅ **GOOD**

**Current Behavior**:
- Location: `frontend/src/pages/DocumentsPage.tsx`
- Triggered when: POST `/api/v1/documents/folders/` fails

**Troubleshooting**: Check for duplicate folder name, verify parent folder exists, check `documents.manage` permission.

---

#### 78. Unable to Delete Document
**Message**: `"Unable to delete the document. Please try again."`

**Quality**: ✅ **GOOD**

**Current Behavior**:
- Location: `frontend/src/pages/DocumentsPage.tsx`
- Triggered when: DELETE `/api/v1/documents/{id}` fails

---

#### 79. Document Not Found
**Message**: `"Document not found"`

**Quality**: ✅ **GOOD**

**Current Behavior**:
- Location: `backend/app/api/v1/endpoints/documents.py`
- Triggered when: Requested document ID does not exist

---

## Meetings Module Errors

### Meeting Operations

#### 80. Unable to Load Meetings
**Message**: `"Unable to load meetings. Please check your connection and try again."`

**Quality**: ✅ **GOOD**

**Current Behavior**:
- Location: `frontend/src/pages/MinutesPage.tsx`
- Triggered when: GET `/api/v1/meetings/` fails

---

#### 81. Unable to Create Meeting
**Message**: `"Unable to create the meeting. Please check your input and try again."`

**Quality**: ✅ **GOOD**

**Current Behavior**:
- Location: `frontend/src/pages/MinutesPage.tsx`
- Triggered when: POST `/api/v1/meetings/` fails

**Troubleshooting**: Verify required fields (title, meeting_type, meeting_date). Valid types: regular, special, emergency, committee, board.

---

#### 82. Unable to Delete Meeting
**Message**: `"Unable to delete the meeting. Please try again."`

**Quality**: ✅ **GOOD**

**Current Behavior**:
- Location: `frontend/src/pages/MinutesPage.tsx`
- Triggered when: DELETE `/api/v1/meetings/{id}` fails

---

#### 83. Meeting Not Found
**Message**: `"Meeting not found"`

**Quality**: ✅ **GOOD**

**Current Behavior**:
- Location: `backend/app/api/v1/endpoints/meetings.py`
- Triggered when: Requested meeting ID does not exist

---

#### 84. Failed to Add Attendee
**Message**: `"Failed to add attendee"`

**Quality**: ⚠️ **NEEDS IMPROVEMENT** - No guidance on cause

**Current Behavior**:
- Location: `backend/app/api/v1/endpoints/meetings.py`
- Triggered when: POST `/api/v1/meetings/{id}/attendees` fails

**Troubleshooting**: Verify the user_id exists and hasn't already been added as attendee.

---

## Scheduling Module Errors

### Shift Operations

#### 85. Unable to Load Shifts
**Message**: `"Unable to load shifts. Please check your connection and try again."`

**Quality**: ✅ **GOOD**

**Current Behavior**:
- Location: `frontend/src/pages/SchedulingPage.tsx`
- Triggered when: GET `/api/v1/scheduling/week-calendar` or `/api/v1/scheduling/summary` fails

---

#### 86. Unable to Create Shift
**Message**: `"Unable to create the shift. Please check your input and try again."`

**Quality**: ✅ **GOOD**

**Current Behavior**:
- Location: `frontend/src/pages/SchedulingPage.tsx`
- Triggered when: POST `/api/v1/scheduling/shifts/` fails

**Troubleshooting**: Verify required fields (title, shift_date, start_time, end_time). Ensure end_time is after start_time.

---

#### 87. Shift Not Found
**Message**: `"Shift not found"`

**Quality**: ✅ **GOOD**

**Current Behavior**:
- Location: `backend/app/api/v1/endpoints/scheduling.py`
- Triggered when: Requested shift ID does not exist

---

## Reports Module Errors

### Report Generation

#### 88. Unable to Generate Report
**Message**: `"Unable to generate report. Please check your connection and try again."`

**Quality**: ✅ **GOOD**

**Current Behavior**:
- Location: `frontend/src/pages/ReportsPage.tsx`
- Triggered when: POST `/api/v1/reports/generate` fails

**Troubleshooting**: Check network connection, verify `reports.manage` permission, ensure data exists for the report type.

---

#### 89. Invalid Report Type
**Message**: `"Invalid report type"`

**Quality**: ⚠️ **NEEDS IMPROVEMENT** - Should list valid types

**Current Behavior**:
- Location: `backend/app/api/v1/endpoints/reports.py`
- Triggered when: report_type not in supported list

**Valid Types**: `member_roster`, `training_summary`, `event_attendance`

---

## Notifications Module Errors

### Notification Rule Operations

#### 90. Unable to Load Notification Rules
**Message**: `"Unable to load notification rules. Please check your connection and try again."`

**Quality**: ✅ **GOOD**

**Current Behavior**:
- Location: `frontend/src/pages/NotificationsPage.tsx`
- Triggered when: GET `/api/v1/notifications/rules/` fails

---

#### 91. Unable to Create Notification Rule
**Message**: `"Unable to create the notification rule. Please check your input and try again."`

**Quality**: ✅ **GOOD**

**Current Behavior**:
- Location: `frontend/src/pages/NotificationsPage.tsx`
- Triggered when: POST `/api/v1/notifications/rules/` fails

**Troubleshooting**: Verify required fields (name, trigger_type, category). See valid values in TROUBLESHOOTING.md.

---

#### 92. Unable to Toggle Rule
**Message**: `"Unable to toggle the notification rule. Please try again."`

**Quality**: ✅ **GOOD**

**Current Behavior**:
- Location: `frontend/src/pages/NotificationsPage.tsx`
- Triggered when: POST `/api/v1/notifications/rules/{id}/toggle` fails

---

#### 93. Notification Rule Not Found
**Message**: `"Notification rule not found"`

**Quality**: ✅ **GOOD**

**Current Behavior**:
- Location: `backend/app/api/v1/endpoints/notifications.py`
- Triggered when: Requested rule ID does not exist

---

#### 94. Unable to Delete Notification Rule
**Message**: `"Unable to delete the notification rule. Please try again."`

**Quality**: ✅ **GOOD**

**Current Behavior**:
- Location: `frontend/src/pages/NotificationsPage.tsx`
- Triggered when: DELETE `/api/v1/notifications/rules/{id}` fails

---

## Quick Reference

**Most Common Errors**:
1. Logo upload size exceeded → Resize image
2. SMTP authentication failed → Check username/password, use app password
3. Password too weak → Add uppercase, numbers, special chars
4. Email already registered → Use different email or reset password
5. Session expired → Restart onboarding
6. Unable to load [module] → Check connection, verify migration applied
7. Unable to create [item] → Check required fields and permissions

**For Administrators**:
- CORS errors → Update ALLOWED_ORIGINS in .env
- Database errors → Check logs, verify migrations
- OAuth setup → Follow provider documentation links
- Network timeouts → Check server load and database
- Missing module tables → Run `alembic upgrade head` to apply latest migrations
- Permission errors → Verify user role has the required module permission (e.g., `documents.manage`)

**For Developers**:
- Error message location → Search this document by error text
- Adding new errors → Follow Error Message Standards section
- Testing errors → Verify both frontend and backend validation
- Documentation → Update this file when adding/changing errors

---

## Inventory Module Errors

**Status**: ✅ GOOD - Clear, specific messages added in Feb 2026 overhaul

| Error | Quality | Troubleshooting |
|-------|---------|-----------------|
| "Item not found" | ✅ | Item ID does not exist or does not belong to your organization. Verify the item ID. |
| "Item is already assigned to another user" | ✅ | Unassign or return the item from the current holder before reassigning. |
| "Item is not assigned to the expected user" | ✅ | A concurrent operation changed the item's assignee. Refresh and retry. |
| "Invalid assignment type" | ✅ | Must be one of: `permanent`, `temporary`, `checkout`. Check the enum values. |
| "Invalid condition" | ✅ | Condition must be: `excellent`, `good`, `fair`, `poor`, `damaged`. Previously fell back silently; now rejects invalid values. |
| "Pool items must have a quantity of at least 1" | ✅ | When creating a pool-type item, set `quantity >= 1`. |
| "Insufficient quantity available" | ✅ | Cannot issue more units than are currently on hand. Check available pool quantity. |
| "Clearance line item not found" | ✅ | The line item ID does not belong to the specified clearance. Verify you're resolving items within the correct clearance record. |
| "Duplicate entry for key 'uq_item_org_barcode'" | ✅ | Another item in the same organization has this barcode. Change the barcode or update the existing item. |
| "Duplicate entry for key 'uq_item_org_asset_tag'" | ✅ | Another item in the same organization has this asset tag. Change the tag or update the existing item. |
| "Item not found" (scan modal) | ✅ | The scanned barcode/QR code doesn't match any item. Verify the code is correct. |
| "Network error - please check your connection" (scan modal) | ✅ | A network error occurred during the scan lookup. Check connectivity and retry. |
| "Item is not currently checked out" | ✅ | Cannot return an item that has no active checkout. Check the item's current status. |
| "No items selected for label generation" | ✅ | Select at least one item before generating labels. |
