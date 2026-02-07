# Error Message Updates - February 7, 2026

## Overview

This document tracks all error message improvements implemented on **February 7, 2026**. These improvements significantly enhance user experience by providing clearer, more actionable error messages.

---

## Summary of Changes

### Critical Fixes (Completed)
1. ✅ Organization form validation - Lists all specific errors
2. ✅ SMTP error mapping - User-friendly messages instead of raw exceptions
3. ✅ Password validation - Shows count and all issues
4. ✅ Missing SMTP fields - Lists specific missing fields
5. ✅ Admin user creation - Contextual suggestions
6. ✅ Role save errors - Shows backend details

### Medium Priority Fixes (Completed)
7. ✅ Email/username duplicate clarification - Specific values and suggestions
8. ✅ Soft-delete filtering - Only checks active users
9. ✅ Network error standardization - Comprehensive error handler
10. ✅ Module configuration errors - Already showing backend details

---

## Detailed Changes

### 1. Email/Username Duplicate Errors

**Files Changed**:
- `backend/app/services/auth_service.py:243,254`
- `backend/app/services/auth.py:87,97`

**Before**:
```
"Username already exists"
"Email already exists"
```

**After**:
```
"Username 'admin' is already taken. Try a different username like 'admin2' or 'admin_fcvfd'."
"Email 'user@example.com' is already registered. Use a different email address or contact your administrator if this is your account."
```

**Key Improvements**:
- ✅ Shows specific conflicting value
- ✅ Provides actionable suggestions
- ✅ **CRITICAL**: Now filters by `deleted_at.is_(None)` - soft-deleted users no longer block new accounts
- ✅ Context-aware (different messages for onboarding vs admin creation)

**Impact**:
- Users immediately know which username/email is taken
- Suggestions help resolve issue without trial-and-error
- Prevents false duplicates from deleted accounts

---

### 2. Network/API Error Standardization

**New File**: `frontend/src/modules/onboarding/utils/errorHandler.ts` (250+ lines)

**Purpose**: Standardizes all API errors into user-friendly messages across the entire application.

#### Features:

**HTTP Status Code Mapping**:
```typescript
400/422 → "Invalid request. Please check your input and try again."
401     → "Session expired. Please log in again."
403     → "Access denied. You don't have permission to perform this action."
404     → "[Resource] not found. It may have been deleted or moved."
409     → "This item already exists. Please use a different value."
429     → "Too many requests. Please wait a moment and try again."
500     → "Server error occurred. Please try again later or contact support."
502-504 → "Server is temporarily unavailable. Please try again in a few moments."
```

**Network Error Handling**:
```typescript
"Failed to fetch"  → "Cannot connect to server. Please check your internet connection and try again."
Timeout           → "Request timed out. The server is responding slowly. Please try again."
CORS error        → "Connection blocked by security policy. Please contact your administrator."
```

**Technical Jargon Filtering**:

Automatically filters out technical terms:
- ❌ "stack trace", "exception", "null pointer", "errno", "syscall"
- ✅ Converts to: "An unexpected error occurred. Please try again."

**Database Error Translation**:
```typescript
"(pymysql.err.OperationalError) (2003, \"Can't connect...\")"
→ "Database connection error. Please try again in a moment."

"(IntegrityError) duplicate key..."
→ "This item already exists. Please use a different value."
```

**Step-Specific Guidance**:
```typescript
getOnboardingErrorMessage(error, 'smtp')
// → Adds: "Tip: Gmail and Outlook require app-specific passwords."

getOnboardingErrorMessage(error, 'organization')
// → Adds: "Tip: Try adding your location or year (e.g., 'FCVFD 2024')."

getOnboardingErrorMessage(error, 'admin')
// → Adds: "Tip: Try variations like adding numbers or your organization name."
```

#### Functions Provided:

1. **handleApiError(error, context?)** - Main error handler
   ```typescript
   const message = handleApiError(error, 'save organization');
   // Returns: "Failed to save organization. Please try again."
   ```

2. **formatValidationErrors(errors[])** - Formats Pydantic/FastAPI errors
   ```typescript
   const errors = [
     {loc: ['body', 'username'], msg: 'field required'},
     {loc: ['body', 'email'], msg: 'field required'}
   ];
   formatValidationErrors(errors);
   // Returns: "Please fix the following errors:\n• Username: field required\n• Email: field required"
   ```

3. **getOnboardingErrorMessage(error, step?)** - With step-specific tips
   ```typescript
   getOnboardingErrorMessage(authError, 'email');
   // Returns error + SMTP-specific troubleshooting tip
   ```

4. **Helper Functions**:
   - `isNetworkError(error)` - Check if it's a connectivity issue
   - `isAuthError(error)` - Check if it's authentication (401/403)
   - `isValidationError(error)` - Check if it's validation (400/422)

#### Usage Example:

```typescript
import { handleApiError, getOnboardingErrorMessage } from '../utils/errorHandler';

try {
  await apiClient.createOrganization(data);
} catch (error) {
  // Simple usage
  const message = handleApiError(error);
  toast.error(message);

  // With context
  const message = handleApiError(error, 'create organization');

  // Onboarding-specific (adds tips)
  const message = getOnboardingErrorMessage(error, 'organization');
}
```

---

### 3. Soft-Delete User Filtering

**Problem**: Deleted users were blocking new accounts with same username/email

**Fix**: Added `deleted_at.is_(None)` filter to user existence checks

**Files Changed**:
- `backend/app/services/auth.py:80-97`
- Already correct in `backend/app/services/auth_service.py:239,250`

**Before**:
```python
existing_user = await self.db.execute(
    select(User).where(
        User.organization_id == organization_id,
        User.username == username
    )
)
```

**After**:
```python
existing_user = await self.db.execute(
    select(User).where(
        User.organization_id == organization_id,
        User.username == username,
        User.deleted_at.is_(None)  # Only check active users
    )
)
```

**Impact**:
- Usernames and emails from deleted accounts can now be reused
- Prevents confusing "already exists" errors for deleted accounts
- Aligns with soft-delete pattern used throughout application

---

## Error Message Quality Improvements

### Before (Quality Breakdown):
```
✅ Good: 30 errors (49%)
⚠️  Needs Improvement: 20 errors (33%)
❌ Poor: 11 errors (18%)

Total: 61 errors cataloged
```

### After (2026-02-07 Updates):
```
✅ Good: 40 errors (66%) ⬆️ +17%
⚠️  Needs Improvement: 14 errors (23%) ⬇️ -10%
❌ Poor: 7 errors (11%) ⬇️ -7%

Total: 61 errors cataloged
```

**Improvement**: +17 percentage points in "Good" error messages

---

## Error Message Standards (Established)

All new and updated error messages follow this format:

```
[What failed]: [Specific reason]. [Action to fix].
```

### Examples:

#### ✅ **Good** (New Standard):
```
"Username 'admin' is already taken. Try 'admin2' or 'admin_fcvfd'."
"Cannot connect to server. Please check your internet connection and try again."
"Image too large: 7.50MB (max 5MB). Reduce image size and try again."
"SMTP authentication failed. Verify your username and password. For Gmail, use app-specific password."
```

#### ❌ **Old** (Being Phased Out):
```
"Username already exists"
"Failed to fetch"
"Invalid image"
"Unexpected error"
```

---

## Developer Guidelines

### When Adding New Error Messages:

1. **Be Specific**: Show the actual value that's wrong
   ```
   ❌ "Email invalid"
   ✅ "Email 'invalid-email' is not valid. Must be in format: user@domain.com"
   ```

2. **Suggest Solutions**: Tell user what to do
   ```
   ❌ "Port number invalid"
   ✅ "Port number must be 1-65535. Common ports: 587 (TLS), 465 (SSL)"
   ```

3. **Filter Technical Jargon**: Users shouldn't see:
   - Stack traces
   - Exception names
   - Database error codes
   - System error numbers

4. **Provide Context**: What were they trying to do?
   ```
   ❌ "Not found"
   ✅ "Organization 'FCVFD' not found. It may have been deleted or moved."
   ```

5. **Use Error Handler**: Don't reinvent the wheel
   ```typescript
   import { handleApiError } from '../utils/errorHandler';

   try {
     await someApiCall();
   } catch (error) {
     const message = handleApiError(error, 'save data');
     toast.error(message);
   }
   ```

---

## Testing Error Messages

### Manual Testing Checklist:

**Duplicate Errors**:
- [ ] Try creating user with existing username
- [ ] Try creating user with existing email
- [ ] Verify suggestions are shown
- [ ] Verify soft-deleted users don't block

**Network Errors**:
- [ ] Disconnect internet, try API call → "Cannot connect to server..."
- [ ] Stop backend, try API call → "Server is temporarily unavailable..."
- [ ] Slow network, cause timeout → "Request timed out..."

**Validation Errors**:
- [ ] Submit invalid email → Shows format requirement
- [ ] Submit weak password → Shows all missing requirements
- [ ] Submit incomplete form → Lists all missing fields

**SMTP Errors**:
- [ ] Wrong credentials → "Authentication failed. Verify username/password..."
- [ ] Wrong port → "Cannot connect to mail server..."
- [ ] SSL mismatch → "SSL/TLS version mismatch. Try changing..."

---

## Related Documentation

- [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) - **NEW** Comprehensive troubleshooting guide
- [`ERROR_MESSAGES_COMPLETE.md`](./ERROR_MESSAGES_COMPLETE.md) - Complete error catalog
- [`ERROR_MESSAGES_LOGO_UPLOAD.md`](./ERROR_MESSAGES_LOGO_UPLOAD.md) - Logo upload errors
- [`ENUM_CONVENTIONS.md`](./ENUM_CONVENTIONS.md) - Enum conventions and validation

---

## Code References

### Backend Files Modified:
```
backend/app/services/auth.py (lines 80-97)
backend/app/services/auth_service.py (lines 243, 254)
```

### Frontend Files Added/Modified:
```
frontend/src/modules/onboarding/utils/errorHandler.ts (NEW - 250+ lines)
frontend/src/modules/onboarding/utils/index.ts (export added)
frontend/src/modules/onboarding/pages/AdminUserCreation.tsx (import added)
```

---

## Rollout Status

**Date**: 2026-02-07
**Status**: ✅ **COMPLETED** and committed to `claude/review-onboarding-process-Tbq3c`

**Commits**:
1. `4dba94c` - Fix organization_type enum case mismatch
2. `e51ff44` - Add comprehensive enum consistency safeguards
3. `91e747e` - Implement medium priority error message improvements

**Next Steps**:
1. Monitor user feedback on new error messages
2. Continue improving remaining "Needs Improvement" errors
3. Add more step-specific guidance as needed
4. Consider adding inline error messages (not just toasts)

---

**Document Version**: 1.0
**Last Updated**: 2026-02-07
**Author**: Claude (Sonnet 4.5)
**Status**: Implementation Complete
