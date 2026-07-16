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
import toast from 'react-hot-toast';

interface MessageComposeFormProps {
  /** When provided, the form edits this message instead of creating a new one. */
  message?: DepartmentMessageRecord;
  onSaved: () => void;
  onCancel: () => void;
}

type TargetType = 'all' | 'roles' | 'statuses' | 'members';

const inputClass =
  'w-full rounded-md border border-theme-surface-border bg-theme-surface px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-theme-focus-ring';
const labelClass = 'block text-sm font-medium text-theme-text-primary mb-1';
const checkboxClass = 'form-checkbox border-theme-surface-border';

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
  const [expiresAt, setExpiresAt] = useState(
    message?.expires_at ? formatForDateTimeInput(message.expires_at, tz) : '',
  );

  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [members, setMembers] = useState<User[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [roleList, memberList] = await Promise.all([messagesService.getAvailableRoles(), userService.getUsers()]);
        setRoles(roleList);
        setMembers(memberList);
      } catch {
        // Targeting dropdowns are optional; the form still works for "all".
      }
    })();
  }, []);

  const toggle = (list: string[], value: string): string[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) {
      setError('Title and message body are required.');
      return;
    }
    if (targetType === 'roles' && targetRoles.length === 0) {
      setError('Select at least one role to target.');
      return;
    }
    if (targetType === 'statuses' && targetStatuses.length === 0) {
      setError('Select at least one status to target.');
      return;
    }
    if (targetType === 'members' && targetMembers.length === 0) {
      setError('Select at least one member to target.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      if (isEditing && message) {
        // On edit, send every target list explicitly (null when not applicable)
        // so switching the audience type clears the now-irrelevant targeting
        // instead of leaving stale role/status/member arrays behind.
        await messagesService.updateMessage(message.id, {
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
        });
        toast.success('Message updated');
        onSaved();
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

      await messagesService.createMessage(payload);
      toast.success('Message posted');
      onSaved();
    } catch {
      setError(
        isEditing
          ? 'Unable to save your changes. Please try again.'
          : 'Unable to post the message. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const filteredMembers = members.filter((m) => {
    if (!memberSearch.trim()) return true;
    const q = memberSearch.toLowerCase();
    const name = `${m.first_name ?? ''} ${m.last_name ?? ''}`.toLowerCase();
    return name.includes(q) || (m.membership_number ?? '').toLowerCase().includes(q);
  });

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
      {error && (
        <div
          role="alert"
          className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300"
        >
          {error}
        </div>
      )}

      <div>
        <label htmlFor="msg-title" className={labelClass}>
          Title
        </label>
        <input
          id="msg-title"
          className={inputClass}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={255}
        />
      </div>

      <div>
        <label htmlFor="msg-body" className={labelClass}>
          Message
        </label>
        <textarea
          id="msg-body"
          className={inputClass}
          rows={5}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="msg-priority" className={labelClass}>
            Priority
          </label>
          <select
            id="msg-priority"
            className={inputClass}
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            <option value="normal">Normal</option>
            <option value="important">Important</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
        <div>
          <label htmlFor="msg-target" className={labelClass}>
            Audience
          </label>
          <select
            id="msg-target"
            className={inputClass}
            value={targetType}
            onChange={(e) => setTargetType(e.target.value as TargetType)}
          >
            <option value="all">Everyone</option>
            <option value="roles">By role</option>
            <option value="statuses">By status</option>
            <option value="members">Specific members</option>
          </select>
        </div>
      </div>

      {targetType === 'roles' && (
        <fieldset className="border-theme-surface-border rounded-md border p-3">
          <legend className="text-theme-text-secondary px-1 text-sm font-medium">Roles</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {roles.map((r) => (
              <label key={r.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className={checkboxClass}
                  checked={targetRoles.includes(r.id)}
                  onChange={() => setTargetRoles((prev) => toggle(prev, r.id))}
                />
                {r.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {targetType === 'statuses' && (
        <fieldset className="border-theme-surface-border rounded-md border p-3">
          <legend className="text-theme-text-secondary px-1 text-sm font-medium">Statuses</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {STATUS_OPTIONS.map((s) => (
              <label key={s.value} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className={checkboxClass}
                  checked={targetStatuses.includes(s.value)}
                  onChange={() => setTargetStatuses((prev) => toggle(prev, s.value))}
                />
                {s.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {targetType === 'members' && (
        <fieldset className="border-theme-surface-border rounded-md border p-3">
          <legend className="text-theme-text-secondary px-1 text-sm font-medium">
            Members ({targetMembers.length} selected)
          </legend>
          <input
            className={`${inputClass} mb-2`}
            placeholder="Search members…"
            value={memberSearch}
            onChange={(e) => setMemberSearch(e.target.value)}
          />
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {filteredMembers.map((m) => (
              <label key={m.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className={checkboxClass}
                  checked={targetMembers.includes(m.id)}
                  onChange={() => setTargetMembers((prev) => toggle(prev, m.id))}
                />
                {(m.first_name ?? '') + ' ' + (m.last_name ?? '')}
                {m.membership_number ? ` (#${m.membership_number})` : ''}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className={checkboxClass}
            checked={isPinned}
            onChange={(e) => setIsPinned(e.target.checked)}
          />
          Pin to top
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className={checkboxClass}
            checked={isPersistent}
            onChange={(e) => setIsPersistent(e.target.checked)}
          />
          Persistent
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className={checkboxClass}
            checked={requiresAck}
            onChange={(e) => setRequiresAck(e.target.checked)}
          />
          Require acknowledgment
        </label>
      </div>

      <div>
        <label htmlFor="msg-expires" className={labelClass}>
          Expires (optional)
        </label>
        <input
          id="msg-expires"
          type="datetime-local"
          className={inputClass}
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
        />
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
          {isEditing ? 'Save changes' : 'Post message'}
        </button>
      </div>
    </form>
  );
};

export default MessageComposeForm;
