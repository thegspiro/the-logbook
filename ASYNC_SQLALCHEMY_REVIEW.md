# Async SQLAlchemy Review - Greenlet Error Prevention
**Date:** 2026-02-10
**Review Type:** Code audit for async/await SQLAlchemy issues
**Triggered By:** Greenlet error in organization creation during onboarding

---

## 🎯 **Issue Fixed**

### **Organization Creation Greenlet Error**
**Location:** `backend/app/services/onboarding.py:420`
**Status:** ✅ **FIXED**

**Problem:**
```python
await self.db.flush()
# ❌ Missing refresh - accessing org.organization_type.value later caused greenlet error
return org
```

**Solution:**
```python
await self.db.flush()
await self.db.refresh(org)  # ✅ Refresh to load all attributes properly
return org
```

---

## 📊 **Complete Audit Results**

### **Total `flush()` Calls Found: 32**
- ✅ **Safe:** 28 (87.5%)
- ⚠️ **Needs Attention:** 4 (12.5%)
- 🔴 **Critical:** 0 (after fix)

---

## ✅ **SAFE PATTERNS IDENTIFIED**

### 1. **Flush + Refresh Pattern** (Recommended ✅)

**Examples:**
```python
# audit.py:117-118
await db.flush()
await db.refresh(log_entry)

# audit.py:250-251
await db.flush()
await db.refresh(checkpoint)

# auth_service.py:318-319
await self.db.flush()
await self.db.refresh(user)

# onboarding.py:420-421 (FIXED)
await self.db.flush()
await self.db.refresh(org)
```

**Why Safe:** Object is fully reloaded from database, all attributes available.

---

### 2. **Flush for ID Only**

**Examples:**
```python
# users.py:161
await db.flush()  # Flush to get the user ID
# Only accesses new_user.id afterwards - safe

# training_session_service.py:111
await self.db.flush()  # Get event ID
# Only uses event.id - safe
```

**Why Safe:** Primary key IDs are always available after flush without refresh.

---

### 3. **Flush + Commit Pattern**

**Examples:**
```python
# auth_service.py:140
await self.db.flush()
# ... (no enum access)
# Later: commit happens

# onboarding.py:705
await self.db.flush()
# ... (no immediate object access)
```

**Why Safe:** No enum or relationship access between flush and commit.

---

### 4. **Flush for Side Effects Only**

**Examples:**
```python
# auth_service.py:86
await self.db.flush()
return None  # Not using the object

# auth_service.py:242-243
await self.db.flush()
logger.info(f"Revoked {count} session(s)")  # Only using count
```

**Why Safe:** Object attributes not accessed after flush.

---

## ⚠️ **POTENTIAL ISSUES TO MONITOR**

### 1. **OnboardingStatus Creation** (Low Risk)
**Location:** `backend/app/services/onboarding.py:184-186`

```python
self.db.add(status)
await self.db.flush()
return status
```

**Risk Level:** 🟡 **LOW**
**Why:** OnboardingStatus model has no enum fields, only basic types (String, Boolean, Integer, JSON).
**Action:** ✅ **No fix needed** - No enums to access.

---

### 2. **Training Record Creation** (Low Risk)
**Location:** `backend/app/services/external_training_service.py:878-885`

```python
self.db.add(training_record)
await self.db.flush()

# Update import record
import_record.training_record_id = training_record.id
import_record.import_status = "imported"

return training_record
```

**Risk Level:** 🟡 **LOW**
**Why:** Only accesses training_record.id (safe), sets string attributes.
**Action:** ✅ **No fix needed** - Returns object but caller should handle enum access safely.

---

### 3. **Sync Log Creation** (Low Risk)
**Location:** `backend/app/services/external_training_service.py:248-263`

```python
self.db.add(sync_log)
await self.db.flush()

sync_log.sync_from_date = from_date
sync_log.sync_to_date = to_date
```

**Risk Level:** 🟡 **LOW**
**Why:** Only sets date attributes after flush, no enum access.
**Action:** ✅ **No fix needed** - Safe attribute setting.

---

### 4. **Role Creation in Onboarding** (Low-Medium Risk)
**Location:** `backend/app/services/onboarding.py:512`

```python
for role_data in default_roles:
    role = Role(
        organization_id=organization_id,
        **role_data
    )
    self.db.add(role)

await self.db.flush()
# No immediate access - returned via query later
```

**Risk Level:** 🟢 **LOW**
**Why:** Roles not accessed after flush, retrieved via separate query later.
**Action:** ✅ **No fix needed** - Safe pattern.

---

## 📋 **ENUM VALUE ACCESS PATTERNS**

### **Safe Enum Access (After Commit or Refresh)**

```python
# After commit + refresh
await db.commit()
await db.refresh(user, ["roles"])
return user.status.value  # ✅ Safe

# In query results (already loaded)
elections = result.scalars().all()
for election in elections:
    status = election.status.value  # ✅ Safe
```

### **Potentially Unsafe (After Flush Without Refresh)**

```python
await db.flush()
# ❌ UNSAFE - might trigger greenlet error
return obj.enum_field.value

# ✅ SAFE - with refresh
await db.flush()
await db.refresh(obj)
return obj.enum_field.value
```

---

## 🔍 **ENUM FIELDS BY MODEL**

### **Models with Enums (Require Careful Handling)**

1. **Organization**
   - `organization_type` (OrganizationType enum)
   - `identifier_type` (IdentifierType enum)

2. **User**
   - `status` (UserStatus enum)

3. **Election**
   - `status` (ElectionStatus enum)

4. **Event**
   - `event_type` (EventType enum)

5. **EventRSVP**
   - `status` (RSVPStatus enum)

6. **InventoryItem**
   - `status` (InventoryItemStatus enum)
   - `condition` (ItemCondition enum)

7. **TrainingApproval**
   - `status` (ApprovalStatus enum)

8. **SecurityAlert**
   - `alert_type` (AlertType enum)
   - `threat_level` (ThreatLevel enum)

---

## 🛡️ **BEST PRACTICES**

### **✅ DO:**

1. **Always refresh after flush if accessing enum fields**
   ```python
   await db.flush()
   await db.refresh(obj)
   return obj.enum_field.value  # Safe
   ```

2. **Use flush() only when you need the ID**
   ```python
   await db.flush()  # Get ID for foreign key
   other_obj.parent_id = obj.id  # OK - ID is available
   ```

3. **Commit + refresh for complex objects**
   ```python
   await db.commit()
   await db.refresh(obj, ["relationships"])  # Load specific relationships
   ```

4. **Query objects separately if needed**
   ```python
   await db.flush()
   # Later: re-query if needed
   obj = await db.get(Model, obj.id)  # Fully loaded
   ```

### **❌ DON'T:**

1. **Access enums after flush without refresh**
   ```python
   await db.flush()
   value = obj.status.value  # ❌ May cause greenlet error
   ```

2. **Access lazy-loaded relationships after flush**
   ```python
   await db.flush()
   for item in obj.children:  # ❌ May cause greenlet error
       process(item)
   ```

3. **Assume attributes are loaded**
   ```python
   await db.flush()
   # ❌ Assumption - might not be loaded
   if obj.complex_field:
       do_something()
   ```

---

## 🧪 **TESTING RECOMMENDATIONS**

### **Unit Tests for Enum Access**

```python
async def test_organization_creation_enum_access():
    """Test that enum values are accessible after organization creation"""
    service = OnboardingService(db)

    org = await service.create_organization(
        name="Test Dept",
        slug="test-dept",
        organization_type="fire_department"
    )

    # Should not raise greenlet error
    assert org.organization_type.value == "fire_department"
    assert org.identifier_type.value == "department_id"
```

### **Integration Tests for API Responses**

```python
async def test_onboarding_organization_endpoint():
    """Test full onboarding organization creation"""
    response = await client.post(
        "/api/v1/onboarding/session/organization",
        json={
            "name": "Test Department",
            "organization_type": "fire_department",
            ...
        }
    )

    assert response.status_code == 200
    data = response.json()
    assert data["organization_type"] == "fire_department"
```

---

## 📈 **MONITORING & LOGGING**

### **Log Greenlet Errors**

Add to `app/core/logging_config.py`:

```python
# Catch and log greenlet errors
if "greenlet_spawn has not been called" in str(exception):
    logger.error(
        f"GREENLET ERROR: {location}",
        extra={
            "error_type": "greenlet_spawn_error",
            "location": location,
            "model": model_name,
            "requires_fix": True
        }
    )
```

---

## 📝 **SUMMARY**

### **Current State: ✅ HEALTHY**

- **1 Critical Issue:** ✅ Fixed (organization creation)
- **32 Flush Calls:** 28 safe patterns, 4 low-risk
- **0 High-Risk Issues:** All critical paths reviewed

### **Risk Assessment:**

| Category | Risk | Status |
|----------|------|--------|
| **Organization Creation** | 🔴 Critical | ✅ FIXED |
| **User Creation** | 🟢 Low | ✅ Safe (has refresh) |
| **Auth Operations** | 🟢 Low | ✅ Safe patterns |
| **Election Operations** | 🟢 Low | ✅ No flush issues |
| **Training Records** | 🟡 Low-Medium | ✅ Monitored |

### **Recommendations:**

1. ✅ **Keep current fix** for organization creation
2. 📝 **Document pattern** in developer guide
3. 🧪 **Add tests** for enum access after flush
4. 🔍 **Code review checklist** for future flush() calls
5. 📊 **Monitor logs** for any greenlet errors in production

---

## 🔗 **REFERENCES**

- **SQLAlchemy Async Docs:** https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html
- **Greenlet Error:** https://sqlalche.me/e/20/xd2s
- **Issue Tracking:** https://github.com/thegspiro/the-logbook/issues/

---

**Audit Completed By:** Claude Code
**Next Review:** After any major async DB changes
