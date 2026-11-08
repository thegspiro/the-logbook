/**
 * MessageComposeForm
 *
 * Create a department message/announcement with audience targeting.
 *
 * Targeting contract: the backend's _is_targeted matches target_roles against
 * the member's role *ids* (rename-safe) and target_statuses against the
 * member's status value, so this form submits role ids and status values.
 * Getting this wrong would silently deliver a role-targeted message to nobody.
 */

import React, { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { messagesService, userService } from '../../../services/api';
import type { RoleOption, DepartmentMessageRecord } from '../../../services/adminServices';
import type { User } from '../../../types/user';
import { UserStatus } from '../../../constants/enums';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatForDateTimeInput, localToUTC } from '../../../utils/dateFormatting';
import { displayNameOf } from '../../../utils/memberName';
import { getErrorMessage } from '../../../utils/errorHandling';
import { FormField } from '../../../components/ux/FormField';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';
import toast from 'react-hot-toast';

interface MessageComposeFormProps {
  /** When provided, the form edits this message instead of creating a new one. */
  message?: DepartmentMessageRecord;
  onSaved: () => void;
  onCancel: () => void;
}

type TargetType = 'all' | 'roles' | 'statuses' | 'members';

const inputClass = 'form-input px-3 text-sm';
const checkboxClass = 'form-checkbox border-theme-surface-border';

type MessageField = 'title' | 'body' | 'priority' | 'target_type' | 'target' | 'scheduled_at' | 'expires_at';

/** Limits from MessageCreate / MessageUpdate in endpoints/messages.py (snake_case, no alias generator). */
const MESSAGE_FIELDS: Record<MessageField, ServerFieldSpec> = {
  title: { label: 'Title', maxLength: 500 },
  body: { label: 'Message', maxLength: 20000 },
  priority: { label: 'Priority' },
  target_type: { label: 'Audience' },
  target: { label: 'Audience', api: ['target_roles', 'target_statuses', 'target_member_ids'] },
  scheduled_at: { label: 'Scheduled time' },
  expires_at: { label: 'Expiry' },
};

/** In the order they appear, so the first failing one takes focus. */
const MESSAGE_FIELD_IDS: Record<MessageField, string> = {
  title: 'msg-title',
  body: 'msg-body',
  priority: 'msg-priority',
  target_type: 'msg-target',
  target: 'msg-target-list',
  scheduled_at: 'msg-schedule',
  expires_at: 'msg-expires',
};

/** The payload keys each form field writes, so a refused one can be left out of an edit. */
const MESSAGE_FIELD_KEYS: Record<MessageField, readonly string[]> = {
  title: ['title'],
  body: ['body'],
  priority: ['priority'],
  target_type: ['target_type', 'target_roles', 'target_statuses', 'target_member_ids'],
  target: ['target_type', 'target_roles', 'target_statuses', 'target_member_ids'],
  scheduled_at: ['scheduled_at'],
  expires_at: ['expires_at'],
};

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: UserStatus.ACTIVE, label: 'Active' },
  { value: UserStatus.PROBATIONARY, label: 'Probationary' },
  { value: UserStatus.LEAVE, label: 'Leave' },
  { value: UserStatus.INACTIVE, label: 'Inactive' },
  { value: UserStatus.RETIRED, label: 'Retired' },
];

const MessageComposeForm: React.FC<MessageComposeFormProps> = ({ message, onSaved, onCancel }) => {
  const tz = useTimezone();
  const isEditing = Boolean(message);
  const [title, setTitle] = useState(message?.title ?? '');
  const [body, setBody] = useState(message?.body ?? '');
  const [priority, setPriority] = useState<string>(message?.priority ?? 'normal');
  const [targetType, setTargetType] = useState<TargetType>(message?.target_type ?? 'all');
  const [targetRoles, setTargetRoles] = useState<string[]>(message?.target_roles ?? []);
  const [targetStatuses, setTargetStatuses] = useState<string[]>(message?.target_statuses ?? []);
  const [targetMembers, setTargetMembers] = useState<string[]>(message?.target_member_ids ?? []);
  const [isPinned, setIsPinned] = useState(message?.is_pinned ?? false);
  const [isPersistent, setIsPersistent] = useState(message?.is_persistent ?? false);
  const [requiresAck, setRequiresAck] = useState(message?.requires_acknowledgment ?? false);
  const [expiresAt, setExpiresAt] = useState(message?.expires_at ? formatForDateTimeInput(message.expires_at, tz) : '');
  const [scheduledAt, setScheduledAt] = useState(
    message?.scheduled_at ? formatForDateTimeInput(message.scheduled_at, tz) : ''
  );

  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [members, setMembers] = useState<User[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<MessageField, string>>>({});
  const [savedExcept, setSavedExcept] = useState(false);
  const clearError = (field: MessageField) => setFieldErrors((prev) => ({ ...prev, [field]: undefined }));

  const showErrors = (next: Partial<Record<MessageField, string>>) => {
    setFieldErrors(next);
    const first = (Object.keys(MESSAGE_FIELD_IDS) as MessageField[]).find((field) => next[field]);
    if (first) window.setTimeout(() => document.getElementById(MESSAGE_FIELD_IDS[first])?.focus(), 0);
  };

  useEffect(() => {
    void (async () => {
      try {
        const [roleList, memberList] = await Promise.all([messagesService.getAvailableRoles(), userService.getUsers()]);
        setRoles(roleList);
        setMembers(memberList);
        // A message keeps the ids it was written with, so a role deleted or a
        // member removed since then is still in its stored audience. Nothing
        // here can show or untick it, so drop it rather than send it back on
        // save. A legacy entry stored as a role *name* becomes that role's id,
        // which is what the checkboxes compare against.
        const roleIdByKey = new Map<string, string>();
        for (const role of roleList) {
          roleIdByKey.set(role.id, role.id);
          roleIdByKey.set(role.name, role.id);
        }
        const memberIds = new Set(memberList.map((m) => m.id));
        setTargetRoles((prev) => {
          const kept = prev.flatMap((entry) => {
            const roleId = roleIdByKey.get(entry);
            return roleId ? [roleId] : [];
          });
          return [...new Set(kept)];
        });
        setTargetMembers((prev) => prev.filter((id) => memberIds.has(id)));
      } catch {
        // Targeting dropdowns are optional; the form still works for "all".
      }
    })();
  }, []);

  const toggle = (list: string[], value: string): string[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const refused: Partial<Record<MessageField, string>> = {};
    if (!title.trim()) refused.title = 'Give the message a title.';
    if (!body.trim()) refused.body = 'Write the message.';
    if (targetType === 'roles' && targetRoles.length === 0) refused.target = 'Select at least one role to target.';
    if (targetType === 'statuses' && targetStatuses.length === 0) {
      refused.target = 'Select at least one status to target.';
    }
    if (targetType === 'members' && targetMembers.length === 0) {
      refused.target = 'Select at least one member to target.';
    }
    // A new message is posted to members the moment it saves, so nothing is
    // created until every field is acceptable (owner rule of 2026-11-05).
    if (!isEditing && Object.keys(refused).length > 0) {
      showErrors(refused);
      return;
    }

    setSubmitting(true);
    setError(null);
    setSavedExcept(false);
    setFieldErrors({});
    try {
      if (isEditing && message) {
        // On edit, send every target list explicitly (null when not applicable)
        // so switching the audience type clears the now-irrelevant targeting
        // instead of leaving stale role/status/member arrays behind.
        const update: Record<string, unknown> = {
          title: title.trim(),
          body: body.trim(),
          priority,
          target_type: targetType,
          target_roles: targetType === 'roles' ? targetRoles : null,
          target_statuses: targetType === 'statuses' ? targetStatuses : null,
          target_member_ids: targetType === 'members' ? targetMembers : null,
          is_pinned: isPinned,
          is_persistent: isPersistent,
          requires_acknowledgment: requiresAck,
          expires_at: expiresAt ? localToUTC(expiresAt, tz) : null,
          scheduled_at: scheduledAt ? localToUTC(scheduledAt, tz) : null,
        };
        await saveEdit(message.id, update, refused);
        return;
      }

      // Build the create payload conditionally — omitting optional keys rather
      // than sending undefined (exactOptionalPropertyTypes) and only attaching
      // the audience list relevant to the chosen target type.
      const payload: Parameters<typeof messagesService.createMessage>[0] = {
        title: title.trim(),
        body: body.trim(),
        priority,
        target_type: targetType,
        is_pinned: isPinned,
        is_persistent: isPersistent,
        requires_acknowledgment: requiresAck,
      };
      if (targetType === 'roles') payload.target_roles = targetRoles;
      if (targetType === 'statuses') payload.target_statuses = targetStatuses;
      if (targetType === 'members') payload.target_member_ids = targetMembers;
      // datetime-local is interpreted in the org timezone; send a UTC instant.
      if (expiresAt) payload.expires_at = localToUTC(expiresAt, tz);
      if (scheduledAt) payload.scheduled_at = localToUTC(scheduledAt, tz);

      await messagesService.createMessage(payload);
      toast.success(scheduledAt ? 'Message scheduled' : 'Message posted');
      onSaved();
    } catch (err: unknown) {
      const mapped = mapServerFieldErrors(err, MESSAGE_FIELDS);
      if (mapped && Object.keys(mapped.fieldErrors).length > 0) {
        showErrors({ ...refused, ...mapped.fieldErrors });
        setError(mapped.unmatched.length ? mapped.unmatched.join(' ') : null);
        return;
      }
      // The server's reason first: an expiry in the past or before the
      // scheduled time is refused with a message saying so, and "Try again"
      // would send the officer round the same failure.
      setError(
        getErrorMessage(
          err,
          isEditing ? 'Unable to save your changes. Try again.' : 'Unable to post the message. Try again.'
        )
      );
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Saving an edit is a single save (owner rule of 2026-11-05): a field this
   * form or the server refuses is left out, so the message keeps its stored
   * value, the rest is written, and the form stays open with the field
   * flagged until it is fixed.
   */
  const saveEdit = async (
    messageId: string,
    update: Record<string, unknown>,
    refusedHere: Partial<Record<MessageField, string>>
  ) => {
    let refused = refusedHere;
    const without = () => {
      const rest = { ...update };
      for (const field of Object.keys(refused) as MessageField[]) {
        for (const key of MESSAGE_FIELD_KEYS[field]) delete rest[key];
      }
      return rest;
    };
    try {
      await messagesService.updateMessage(messageId, without());
    } catch (err: unknown) {
      const mapped = mapServerFieldErrors(err, MESSAGE_FIELDS);
      if (!mapped || Object.keys(mapped.fieldErrors).length === 0 || mapped.unmatched.length > 0) {
        throw err;
      }
      refused = { ...refused, ...mapped.fieldErrors };
      await messagesService.updateMessage(messageId, without());
    }
    if (Object.keys(refused).length > 0) {
      showErrors(refused);
      setSavedExcept(true);
      return;
    }
    toast.success('Message updated');
    onSaved();
  };

  const filteredMembers = members.filter((m) => {
    if (!memberSearch.trim()) return true;
    const q = memberSearch.toLowerCase();
    const name = displayNameOf(m).toLowerCase();
    const legalName = `${m.first_name ?? ''} ${m.last_name ?? ''}`.toLowerCase();
    return name.includes(q) || legalName.includes(q) || (m.membership_number ?? '').toLowerCase().includes(q);
  });

  // The audience list's refusal is announced on the group, since no one
  // checkbox in it is the one at fault.
  const targetFieldsetProps = {
    id: MESSAGE_FIELD_IDS.target,
    tabIndex: -1,
    'aria-describedby': fieldErrors.target ? 'msg-target-error' : undefined,
  };
  const targetError = fieldErrors.target ? (
    <p id="msg-target-error" className="mb-2 text-sm text-red-800 dark:text-red-300">
      {fieldErrors.target}
    </p>
  ) : null;

  return (
    <form onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-4">
      {savedExcept && (
        <p role="status" className="alert-warning text-theme-text-primary text-sm">
          Saved, except the field flagged below, which keeps its stored value. Fix it and save again.
        </p>
      )}
      {error && (
        <div role="alert" className="alert-danger text-theme-text-primary text-sm">
          {error}
        </div>
      )}

      <FormField
        label="Title"
        required
        error={fieldErrors.title}
        id="msg-title"
        maxLength={MESSAGE_FIELDS.title.maxLength}
        count={title.length}
      >
        {(field) => (
          <input
            {...field}
            type="text"
            autoComplete="off"
            className={inputClass}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              clearError('title');
            }}
          />
        )}
      </FormField>

      <FormField
        label="Message"
        required
        error={fieldErrors.body}
        id="msg-body"
        maxLength={MESSAGE_FIELDS.body.maxLength}
        count={body.length}
      >
        {(field) => (
          <textarea
            {...field}
            className={inputClass}
            rows={5}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              clearError('body');
            }}
          />
        )}
      </FormField>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Priority" error={fieldErrors.priority} id="msg-priority">
          {(field) => (
            <select
              {...field}
              className={inputClass}
              value={priority}
              onChange={(e) => {
                setPriority(e.target.value);
                clearError('priority');
              }}
            >
              <option value="normal">Normal</option>
              <option value="important">Important</option>
              <option value="urgent">Urgent</option>
            </select>
          )}
        </FormField>
        <FormField label="Audience" error={fieldErrors.target_type} id="msg-target">
          {(field) => (
            <select
              {...field}
              className={inputClass}
              value={targetType}
              onChange={(e) => {
                setTargetType(e.target.value as TargetType);
                clearError('target_type');
                clearError('target');
              }}
            >
              <option value="all">Everyone</option>
              <option value="roles">By role</option>
              <option value="statuses">By status</option>
              <option value="members">Specific members</option>
            </select>
          )}
        </FormField>
      </div>

      {targetType === 'roles' && (
        <fieldset {...targetFieldsetProps} className="border-theme-surface-border rounded-md border p-3">
          <legend className="text-theme-text-secondary px-1 text-sm font-medium">Roles</legend>
          {targetError}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {roles.map((r) => (
              <label key={r.id} className="touch:min-h-11 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className={checkboxClass}
                  checked={targetRoles.includes(r.id)}
                  onChange={() => {
                    setTargetRoles((prev) => toggle(prev, r.id));
                    clearError('target');
                  }}
                />
                {r.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {targetType === 'statuses' && (
        <fieldset {...targetFieldsetProps} className="border-theme-surface-border rounded-md border p-3">
          <legend className="text-theme-text-secondary px-1 text-sm font-medium">Statuses</legend>
          {targetError}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {STATUS_OPTIONS.map((s) => (
              <label key={s.value} className="touch:min-h-11 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className={checkboxClass}
                  checked={targetStatuses.includes(s.value)}
                  onChange={() => {
                    setTargetStatuses((prev) => toggle(prev, s.value));
                    clearError('target');
                  }}
                />
                {s.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {targetType === 'members' && (
        <fieldset {...targetFieldsetProps} className="border-theme-surface-border rounded-md border p-3">
          <legend className="text-theme-text-secondary px-1 text-sm font-medium">
            Members ({targetMembers.length} selected)
          </legend>
          {targetError}
          <input
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className={`${inputClass} mb-2`}
            aria-label="Search members"
            placeholder="Search members…"
            value={memberSearch}
            onChange={(e) => setMemberSearch(e.target.value)}
          />
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {filteredMembers.map((m) => (
              <label key={m.id} className="touch:min-h-11 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className={checkboxClass}
                  checked={targetMembers.includes(m.id)}
                  onChange={() => {
                    setTargetMembers((prev) => toggle(prev, m.id));
                    clearError('target');
                  }}
                />
                {displayNameOf(m)}
                {m.membership_number ? ` (#${m.membership_number})` : ''}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div className="flex flex-wrap gap-4">
        <label className="touch:min-h-11 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className={checkboxClass}
            checked={isPinned}
            onChange={(e) => setIsPinned(e.target.checked)}
          />
          Pin to top
        </label>
        <label className="touch:min-h-11 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className={checkboxClass}
            checked={isPersistent}
            onChange={(e) => setIsPersistent(e.target.checked)}
          />
          Keep in inbox after it is read
        </label>
        <label className="touch:min-h-11 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className={checkboxClass}
            checked={requiresAck}
            onChange={(e) => setRequiresAck(e.target.checked)}
          />
          Require acknowledgment
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          label="Schedule for later (optional)"
          error={fieldErrors.scheduled_at}
          id="msg-schedule"
          hint="Leave blank to publish immediately."
        >
          {(field) => (
            <input
              {...field}
              type="datetime-local"
              className={inputClass}
              value={scheduledAt}
              onChange={(e) => {
                setScheduledAt(e.target.value);
                clearError('scheduled_at');
              }}
            />
          )}
        </FormField>
        <FormField label="Expires (optional)" error={fieldErrors.expires_at} id="msg-expires">
          {(field) => (
            <input
              {...field}
              type="datetime-local"
              className={inputClass}
              value={expiresAt}
              onChange={(e) => {
                setExpiresAt(e.target.value);
                clearError('expires_at');
              }}
            />
          )}
        </FormField>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="border-theme-surface-border text-theme-text-secondary inline-flex items-center gap-1 rounded-md border px-4 py-2 text-sm font-medium"
        >
          <X className="h-4 w-4" aria-hidden="true" />
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="btn-info inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {isEditing ? 'Save changes' : scheduledAt ? 'Schedule message' : 'Post message'}
        </button>
      </div>
    </form>
  );
};

export default MessageComposeForm;
