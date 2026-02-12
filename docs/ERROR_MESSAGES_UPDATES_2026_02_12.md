# Error Message Updates - February 12, 2026

## Overview

This document tracks all error message improvements implemented on **February 12, 2026** as part of the security hardening and error message review.

---

## Summary of Changes

### Security Hardening Error Messages
1. Password reset token errors - Now explain expiry duration and next steps
2. Session expiry errors - Now show time limit and data retention info
3. Logout errors - Now provide workaround actions
4. Token refresh errors - Non-technical language
5. Production security errors - Include fix commands

### Frontend Error Message Improvements
6. Member pages - More descriptive with connection check guidance
7. Role management - Context-aware suggestions
8. Settings pages - Consistent "check connection" pattern
9. Training pages - Specify what failed to load
10. Inventory pages - Guide users to check input
11. Elections pages - Consistent messaging

---

## Detailed Changes

### 1. Password Reset Token Messages

**Files Changed**:
- `backend/app/services/auth_service.py`
- `backend/app/api/v1/endpoints/auth.py`

**Before**:
```
"Invalid or expired reset token"
"Reset token has expired. Please request a new one."
"Token is required"
```

**After**:
```
"This password reset link is invalid or has already been used. Please request a new reset link from the login page."
"This password reset link has expired. Reset links are valid for 30 minutes. Please request a new one from the login page."
"Invalid password reset link. Please request a new reset link from the login page."
```

**Key Improvements**:
- Shows expiry duration (30 minutes)
- Tells user where to go (login page)
- Explains possible causes (already used, expired)

---

### 2. Logout Error Messages

**Files Changed**:
- `backend/app/api/v1/endpoints/auth.py`

**Before**:
```
"Logout failed"
"Invalid authorization header"
```

**After**:
```
"Unable to end your session. Please close your browser and log in again."
"Unable to process logout. Please clear your browser data and log in again."
```

**Key Improvements**:
- Provides workaround actions
- Non-technical language

---

### 3. Token Refresh Messages

**Before**:
```
"Invalid refresh token"
```

**After**:
```
"Your session has expired. Please log in again."
```

---

### 4. Onboarding Error Messages

**Files Changed**:
- `backend/app/api/v1/onboarding.py`

**Before**:
```
"Session expired. Please restart onboarding."
"Organization must be created first"
"Organization not found"
"Failed to create admin user. Please try again or contact support."
```

**After**:
```
"Your onboarding session has expired due to inactivity (30-minute limit). Please refresh the page to start a new session. Your previously saved progress will be retained."
"Organization must be created before adding an admin user. Please complete the organization setup step first."
"Organization not found. The organization setup may not have completed. Please go back and complete the organization setup step."
"Failed to create admin user due to an unexpected error. Please try again. If the problem persists, check the server logs or contact support."
```

---

### 5. Frontend Error Message Standardization

**Pattern adopted**: "Unable to [action]. Please [suggested fix]."

**Files Changed** (12 files):
- `MemberListPage.tsx`
- `Members.tsx`
- `MembersAdminPage.tsx` (5 messages)
- `RoleManagementPage.tsx` (3 messages)
- `SettingsPage.tsx` (2 messages)
- `InventoryPage.tsx` (3 messages)
- `TrainingOfficerDashboard.tsx`
- `MemberProfilePage.tsx` (2 messages)
- `MemberTrainingHistoryPage.tsx`
- `ElectionsPage.tsx`

**Before → After Examples**:

| Before | After |
|--------|-------|
| `Failed to load data. Please try again later.` | `Unable to load members and roles. Please check your connection and refresh the page.` |
| `Failed to save roles. Please try again.` | `Unable to save role assignments. Please check your connection and try again.` |
| `Failed to load members. Please try again later.` | `Unable to load the member directory. Please check your connection and refresh the page.` |
| `Failed to delete role. Please try again.` | `Unable to delete the role. It may still be assigned to users.` |
| `Failed to load member information.` | `Unable to load member information. The member may not exist or you may not have access.` |
| `Failed to load training data. Please try again.` | `Unable to load training dashboard data. Please check your connection and refresh the page.` |

**Key Improvements**:
- Uses "Unable to" instead of "Failed to" (less alarming)
- Specifies what data/resource was affected
- Suggests checking connection as first step
- Some messages explain possible causes (e.g., role still assigned to users)

---

## Error Message Standards (Updated)

### Format
```
"Unable to [action]. [Cause or context]. [Suggested fix]."
```

### Guidelines
1. **Be specific**: Say what failed, not just "an error occurred"
2. **Explain why** (when possible): "It may still be assigned to users"
3. **Suggest action**: "Please check your connection and refresh the page"
4. **Avoid jargon**: "Your session has expired" not "Invalid refresh token"
5. **Show limits**: "Reset links are valid for 30 minutes"
6. **Use "Unable to"** instead of "Failed to" for softer tone

---

**Document Version**: 1.0
**Date**: 2026-02-12
**Total Messages Updated**: 25+
