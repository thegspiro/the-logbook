# Logo Upload Error Messages

## Overview

This document describes all error messages users will see when uploading logos, ensuring they understand why their upload was rejected and what the limits are.

A logo is checked in two places, by the same server validation (`validate_logo_image`):

- **The setup wizard** — chosen on the Organization step, validated when the organization is saved and again when the last step saves the department's details.
- **Settings → General → Profile** — since 2026-09-28. Choosing a new logo saves it on its own and shows it only after the server accepts it. A refused image is reported in a toast with the server's reason (the same `Invalid image: …` messages below; fallback "That image could not be used as the logo.") and is not saved. A logo given as a link rather than a file is refused with "Upload the logo as a PNG or JPEG file rather than a link." A logo already stored is not re-checked until it is changed, so a department whose logo predates the check can still save its profile.

The accepted image is re-encoded before it is stored. Emails link to a rendering of it rather than embedding it — see [TROUBLESHOOTING.md → The Department Logo Is Missing From Emails](./TROUBLESHOOTING.md#the-department-logo-is-missing-from-emails).

---

## Frontend Validation Errors (Immediate)

These errors appear immediately when selecting a file in the setup wizard, before uploading to the server. They were reworded on 2026-09-29. The Settings picker does no checking of its own (it accepts any `image/*`) and relies on the server's refusal.

### File Size Too Large

**Message**: `"The logo must be smaller than 5MB"`

**Trigger**: User selects a file larger than 5MB

**Location**: `frontend/src/modules/onboarding/utils/validation.ts` (`isValidImageFile`)

**Example**:

```
❌ The logo must be smaller than 5MB
```

---

### Invalid File Type

**Message**: `"Upload a PNG, JPG, or WebP image"`

**Trigger**: User selects a file that isn't PNG/JPG/WebP

**Location**: `frontend/src/modules/onboarding/utils/validation.ts` (`isValidImageFile`)

**Example**:

```
❌ Upload a PNG, JPG, or WebP image
```

The wizard accepts WebP here, but the server accepts only PNG and JPEG, so a WebP logo passes this check and is then refused on save with "Unsupported image type".

---

### Invalid File Extension

**Message**: `"The file name must end in .png, .jpg, .jpeg, or .webp"`

**Trigger**: The file name has no extension, or one outside that list

**Location**: `frontend/src/modules/onboarding/utils/validation.ts` (`isValidImageFile`)

**Example**:

```
❌ The file name must end in .png, .jpg, .jpeg, or .webp
```

---

### Large File Warning (Non-blocking)

**Message**: `"This image is large. A smaller one will load faster."`

**Trigger**: File is between 2MB and 5MB

**Location**: `frontend/src/modules/onboarding/utils/validation.ts` (`isValidImageFile`)

**Example**:

```
⚠️  This image is large. A smaller one will load faster.
```

---

## Backend Validation Errors (During Save)

These errors appear when the backend processes the image — after **Continue** or **Finish setup** in the wizard, or as soon as a new logo is chosen on **Settings → General → Profile**. Each is an HTTP 400 whose detail is `Invalid image: ` followed by the reason from `backend/app/utils/image_validator.py`.

### Image Too Large

**Message**: `"Invalid image: Image too large: {actual_size}MB (max {limit}MB)"`

**Trigger**: File exceeds 5MB after base64 decoding

**Location**: `backend/app/utils/image_validator.py:153-155`

**Example**:

```
❌ Invalid image: Image too large: 7.50MB (max 5MB)
```

**Details**:

- Shows actual file size with 2 decimal places
- Shows the maximum allowed size
- Clear actionable message

---

### Unsupported Image Type

**Message**: `"Invalid image: Unsupported image type: {detected_type}. Only PNG and JPEG are allowed."`

**Trigger**: File is not actually a PNG or JPEG (detected via magic bytes)

**Location**: `backend/app/utils/image_validator.py:166-169`

**Examples**:

```
❌ Invalid image: Unsupported image type: image/svg+xml. Only PNG and JPEG are allowed.
❌ Invalid image: Unsupported image type: image/gif. Only PNG and JPEG are allowed.
❌ Invalid image: Unsupported image type: application/pdf. Only PNG and JPEG are allowed.
```

**Details**:

- Shows the actual detected file type
- Lists allowed formats
- Prevents file type spoofing

---

### Image Dimensions Too Small

**Message**: `"Invalid image: Image too small: {width}x{height}. Minimum {min}x{min}"`

**Trigger**: Image dimensions are less than 16x16 pixels

**Location**: `backend/app/utils/image_validator.py:236-239`

**Example**:

```
❌ Invalid image: Image too small: 8x8. Minimum 16x16
```

**Details**:

- Shows actual image dimensions
- Shows minimum required dimensions
- Prevents tracking pixels

---

### Image Dimensions Too Large

**Message**: `"Invalid image: Image too large: {width}x{height}. Maximum {max}x{max}"`

**Trigger**: Image dimensions exceed 4096x4096 pixels

**Location**: `backend/app/utils/image_validator.py:243-246`

**Example**:

```
❌ Invalid image: Image too large: 8000x8000. Maximum 4096x4096
```

**Details**:

- Shows actual image dimensions
- Shows maximum allowed dimensions
- Prevents memory exhaustion attacks

---

### Decompression Bomb Detected

**Message**: `"Invalid image: Potential decompression bomb detected. Image rejected."`

**Trigger**: Image would decompress to excessive size (>178 million pixels)

**Location**: `backend/app/utils/image_validator.py:219-221`

**Example**:

```
❌ Invalid image: Potential decompression bomb detected. Image rejected.
```

**Details**:

- Prevents DoS attacks via malicious images
- Detects images that are small when compressed but huge when decompressed
- Clear security-focused message

---

### Invalid or Corrupted Image

**Message**: `"Invalid image: Invalid or corrupted image"`

**Trigger**: Image fails Pillow's validation or loading

**Location**: `backend/app/utils/image_validator.py:228`

**Example**:

```
❌ Invalid image: Invalid or corrupted image
```

**Details**:

- Pillow's own error is logged on the server, not shown to the user
- Catches malformed files

---

### Blocked Image Format

**Message**: `"Invalid image: {format} format is not allowed for security reasons"`

**Trigger**: Image is in a blocked format (SVG, GIF, TIFF, BMP, etc.)

**Location**: `backend/app/utils/image_validator.py:212-214`

**Examples**:

```
❌ Invalid image: SVG format is not allowed for security reasons
❌ Invalid image: GIF format is not allowed for security reasons
❌ Invalid image: TIFF format is not allowed for security reasons
```

**Details**:

- Explicitly states security concern
- Lists the blocked format
- Prevents vector-based attacks (SVG with scripts)

---

### Invalid Base64 Encoding

**Message**: `"Invalid image: Invalid base64 encoding"`

**Trigger**: Base64 data is malformed or corrupted

**Location**: `backend/app/utils/image_validator.py:141`

**Example**:

```
❌ Invalid image: Invalid base64 encoding
```

**Details**:

- Catches data corruption during transmission
- The decoder's own error is logged on the server, not shown to the user

---

### Empty Image File

**Message**: `"Invalid image: Image file is empty"`

**Trigger**: File has 0 bytes

**Location**: `backend/app/utils/image_validator.py:148`

**Example**:

```
❌ Invalid image: Image file is empty
```

**Details**:

- Simple, clear message
- Prevents empty file uploads

---

### File Type Could Not Be Detected

**Message**: `"Invalid image: Failed to detect file type"`

**Trigger**: The magic-byte check itself failed (the reason is logged on the server)

**Location**: `backend/app/utils/image_validator.py:180`

---

### Logo Given as a Link (Settings Only)

**Message**: `"Upload the logo as a PNG or JPEG file rather than a link."`

**Trigger**: The logo value sent to `PATCH /api/v1/organization/profile` starts with `http://` or `https://`

**Location**: `backend/app/api/v1/endpoints/organizations.py` (`update_organization_profile`)

**Details**:

- The logo must be a file the server can validate and re-encode; an image hosted elsewhere could not be served through the email logo route
- Unlike the others, this message has no `Invalid image:` prefix

---

## Error Display in UI

### Organization Setup Page (Choosing the File)

- Errors displayed via `toast.error()` (red toast notification)
- Appears immediately when file is selected
- Frontend validation only (no API call yet)

**User Flow**:

1. User selects file via file picker or drag-and-drop on the wizard's Organization step
2. Frontend validates immediately
3. If invalid, toast error appears
4. File is rejected, no preview shown

---

### NavigationChoice Page (During Save)

- Errors displayed via `toast.error()` after API call
- Shows backend validation errors
- Includes detailed error message from server

**User Flow**:

1. User clicks **Finish setup** on the last step
2. API call to `/api/v1/onboarding/session/department`
3. Backend validates logo
4. If invalid, error returned in response
5. Toast error displays backend message
6. User remains on page to fix issue

**Code** (`NavigationChoice.tsx`):

```typescript
} else if (error) {
  // Display the actual error message from the backend
  toast.error(error);
}
```

---

### OrganizationSetup Page (During Organization Creation)

- Errors displayed via `toast.error()` after API call
- Shows detailed backend validation errors
- Includes actual error message (not generic)

**User Flow**:

1. User fills organization form with logo
2. User clicks **Continue**
3. API call to `/api/v1/onboarding/session/organization`
4. Backend validates and sanitizes logo
5. If invalid, detailed error returned
6. Toast error displays: "Invalid image: [specific reason]"
7. User can fix issue and retry

**Code** (`OrganizationSetup.tsx`, `handleContinue`):

```typescript
} catch (err: unknown) {
  console.error('Failed to save organization:', err);
  // Show the actual error message from the backend (includes validation details)
  const errorMessage = getErrorMessage(err, 'Could not save the organization. Try again.');
  toast.error(errorMessage);
}
```

---

### Settings → General → Profile (Changing the Logo Later)

- Since 2026-09-28. Choosing a file saves the logo on its own, straight away
- The new logo is shown only after the server accepts it; the stored copy is the server's re-encoded one
- A 400 is shown in a toast with the server's reason and the image is dropped, not retried (fallback text: "That image could not be used as the logo.")
- A network failure is left to the page's save indicator to retry
- Requires `settings.manage`

**Code** (`SettingsPage.tsx`, `saveLogo`):

```typescript
} catch (err: unknown) {
  if (toAppError(err).status !== 400) throw err;
  toast.error(getErrorMessage(err, 'That image could not be used as the logo.'));
}
```

---

## Error Message Examples by Scenario

### Scenario 1: User Uploads 10MB Photo

**What happens**:

1. Frontend checks size → `10485760 bytes > 5242880 bytes`
2. Toast error: `"The logo must be smaller than 5MB"`
3. File rejected immediately, no upload

**User sees**:

```
❌ The logo must be smaller than 5MB
```

---

### Scenario 2: User Uploads SVG File

**What happens**:

1. Frontend checks MIME type → `image/svg+xml` not in allowed list
2. Toast error: `"Upload a PNG, JPG, or WebP image"`
3. File rejected immediately

**User sees**:

```
❌ Upload a PNG, JPG, or WebP image
```

If bypassed (e.g., via API manipulation), backend catches it:

```
❌ Invalid image: Unsupported image type: image/svg+xml. Only PNG and JPEG are allowed.
```

---

### Scenario 3: User Uploads Malware Renamed to logo.png

**What happens**:

1. Frontend checks extension → `✓ .png`
2. Frontend checks MIME → `✓ image/png` (spoofed)
3. File passes frontend validation
4. Backend receives base64 data
5. Backend decodes and checks magic bytes
6. Magic bytes reveal actual type: `application/x-executable`
7. Backend rejects with error

**User sees** (during save):

```
❌ Invalid image: Unsupported image type: application/x-executable. Only PNG and JPEG are allowed.
```

---

### Scenario 4: User Uploads Decompression Bomb

**What happens**:

1. Frontend checks size → `✓ 50KB` (small compressed size)
2. Frontend checks type → `✓ image/png`
3. File passes frontend validation
4. Backend receives and decodes
5. Pillow attempts to load image
6. Detects decompression bomb (would expand to 500GB)
7. `Image.DecompressionBombError` raised
8. Backend rejects

**User sees**:

```
❌ Invalid image: Potential decompression bomb detected. Image rejected.
```

---

### Scenario 5: User Uploads 8000x8000 Pixel Image

**What happens**:

1. Frontend checks size → `✓ 3MB` (within limit)
2. Frontend checks type → `✓ image/jpeg`
3. File passes frontend validation
4. Backend validates dimensions
5. `8000 > 4096` (exceeds MAX_DIMENSION)
6. Backend rejects

**User sees**:

```
❌ Invalid image: Image too large: 8000x8000. Maximum 4096x4096
```

---

## Summary of Limits

| Limit          | Value        | Error Message Includes        |
| -------------- | ------------ | ----------------------------- |
| Max file size  | 5MB          | Actual size + limit           |
| Max dimensions | 4096x4096    | Actual dimensions + limit     |
| Min dimensions | 16x16        | Actual dimensions + limit     |
| Allowed types  | PNG, JPEG    | Detected type + allowed types |
| Max pixels     | ~178 million | Decompression bomb warning    |

---

## Testing Error Messages

To verify all error messages work correctly:

### Test 1: File Too Large

```bash
# Create 10MB file
dd if=/dev/zero of=large.png bs=1M count=10

# Upload → Should see:
# ❌ The logo must be smaller than 5MB
```

### Test 2: Wrong File Type

```bash
# Upload PDF or text file
# Should see:
# ❌ Upload a PNG, JPG, or WebP image
```

### Test 3: Backend Validation

```bash
# Use curl to bypass frontend:
curl -X POST http://localhost:3001/api/v1/onboarding/session/department \
  -d '{"name":"Test","logo":"data:image/svg+xml;base64,..."}'

# Should return 400 with:
# {"detail":"Invalid image: Unsupported image type: image/svg+xml. Only PNG and JPEG are allowed."}
```

---

## Accessibility

All error messages:

- ✅ Display via `toast.error()` (high contrast red)
- ✅ Include ❌ icon for visual indication
- ✅ Contain specific details, not generic "Error"
- ✅ Explain both what's wrong AND what the limit is
- ✅ Use clear, non-technical language where possible
- ✅ Persist until user dismisses (not auto-hide)

---

## Future Enhancements

Potential improvements:

1. **Inline validation feedback** - Show error below upload field
2. **Suggested fixes** - "Try reducing image size to 4MB or less"
3. **Auto-resize option** - "Image is 8000x8000. Resize to 4096x4096?"
4. **File size indicator** - Show size as user selects file
5. **Drag-drop rejection feedback** - Highlight drop zone in red

---

**Document Version**: 1.0
**Last Updated**: 2026-09-30
**Related**: SECURITY_IMAGE_UPLOADS.md
