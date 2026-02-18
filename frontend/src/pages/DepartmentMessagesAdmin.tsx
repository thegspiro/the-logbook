/**
 * Department Messages Administration
 *
 * Allows admins to compose, manage, and track department-wide
 * and targeted messages. Loaded as a tab in NotificationsPage.
 */

import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import {
  Plus,
  Megaphone,
  Pin,
  Trash2,
  Loader2,
  X,
  Eye,
  EyeOff,
  Users,
  Send,
  AlertTriangle,
} from 'lucide-react';
import { messagesService } from '../services/api';
import type { DepartmentMessageRecord, RoleOption } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { useTimezone } from '../hooks/useTimezone';
import { formatDate } from '../utils/dateFormatting';

const PRIORITY_STYLES: Record<string, string> = {
  normal: 'bg-slate-500/20 text-slate-300',
  important: 'bg-amber-500/20 text-amber-300',
  urgent: 'bg-red-500/20 text-red-300',
};

const TARGET_LABELS: Record<string, string> = {
  all: 'All Members',
  roles: 'Specific Roles',
  statuses: 'By Status',
  members: 'Specific Members',
};

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'probationary', label: 'Probationary' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'retired', label: 'Retired' },
];

const DepartmentMessagesAdmin: React.FC = () => {
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('notifications.manage');
  const tz = useTimezone();

  const [messages, setMessages] = useState<DepartmentMessageRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showCompose, setShowCompose] = useState(false);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Compose form
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState('normal');
  const [targetType, setTargetType] = useState('all');
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [isPinned, setIsPinned] = useState(false);
  const [requiresAck, setRequiresAck] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    loadMessages();
    if (canManage) {
      messagesService.getAvailableRoles().then(setRoles).catch(() => {});
    }
  }, []);

  const loadMessages = async () => {
    try {
      setLoading(true);
      const data = await messagesService.getMessages({ include_inactive: true, limit: 100 });
      setMessages(data.messages);
      setTotal(data.total);
    } catch {
      toast.error('Failed to load messages');
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    if (!title.trim() || !body.trim()) {
      toast.error('Title and body are required');
      return;
    }
    setSending(true);
    try {
      await messagesService.createMessage({
        title: title.trim(),
        body: body.trim(),
        priority,
        target_type: targetType,
        target_roles: targetType === 'roles' ? selectedRoles : undefined,
        target_statuses: targetType === 'statuses' ? selectedStatuses : undefined,
        is_pinned: isPinned,
        requires_acknowledgment: requiresAck,
      });
      toast.success('Message sent successfully');
      setShowCompose(false);
      resetForm();
      loadMessages();
    } catch {
      toast.error('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await messagesService.deleteMessage(id);
      toast.success('Message deleted');
      setMessages(prev => prev.filter(m => m.id !== id));
    } catch {
      toast.error('Failed to delete message');
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggleActive = async (msg: DepartmentMessageRecord) => {
    try {
      await messagesService.updateMessage(msg.id, { is_active: !msg.is_active });
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, is_active: !m.is_active } : m));
      toast.success(msg.is_active ? 'Message deactivated' : 'Message activated');
    } catch {
      toast.error('Failed to update message');
    }
  };

  const handleTogglePin = async (msg: DepartmentMessageRecord) => {
    try {
      await messagesService.updateMessage(msg.id, { is_pinned: !msg.is_pinned });
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, is_pinned: !m.is_pinned } : m));
    } catch {
      toast.error('Failed to update message');
    }
  };

  const resetForm = () => {
    setTitle('');
    setBody('');
    setPriority('normal');
    setTargetType('all');
    setSelectedRoles([]);
    setSelectedStatuses([]);
    setIsPinned(false);
    setRequiresAck(false);
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-theme-text-primary flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-amber-400" />
            Department Messages
          </h3>
          <p className="text-sm text-theme-text-muted mt-1">{total} total messages</p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowCompose(true)}
            className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Message
          </button>
        )}
      </div>

      {/* Compose Modal */}
      {showCompose && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-theme-surface rounded-xl border border-theme-surface-border max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-theme-surface-border">
              <h3 className="text-lg font-semibold text-theme-text-primary flex items-center gap-2">
                <Send className="w-5 h-5 text-amber-400" />
                Compose Message
              </h3>
              <button onClick={() => { setShowCompose(false); resetForm(); }} className="text-theme-text-muted hover:text-theme-text-primary">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Title */}
              <div>
                <label className="block text-sm font-medium text-theme-text-primary mb-1">Title *</label>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Message title..."
                  className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              {/* Body */}
              <div>
                <label className="block text-sm font-medium text-theme-text-primary mb-1">Message *</label>
                <textarea
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  placeholder="Type your message..."
                  rows={5}
                  className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-amber-500 resize-y"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Priority */}
                <div>
                  <label className="block text-sm font-medium text-theme-text-primary mb-1">Priority</label>
                  <select
                    value={priority}
                    onChange={e => setPriority(e.target.value)}
                    className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    <option value="normal">Normal</option>
                    <option value="important">Important</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>

                {/* Target */}
                <div>
                  <label className="block text-sm font-medium text-theme-text-primary mb-1">Send To</label>
                  <select
                    value={targetType}
                    onChange={e => setTargetType(e.target.value)}
                    className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    <option value="all">All Members</option>
                    <option value="roles">Specific Roles</option>
                    <option value="statuses">By Member Status</option>
                  </select>
                </div>
              </div>

              {/* Role Selection */}
              {targetType === 'roles' && (
                <div>
                  <label className="block text-sm font-medium text-theme-text-primary mb-1">Select Roles</label>
                  <div className="flex flex-wrap gap-2">
                    {roles.map(role => (
                      <button
                        key={role.name}
                        onClick={() => setSelectedRoles(prev =>
                          prev.includes(role.name) ? prev.filter(r => r !== role.name) : [...prev, role.name]
                        )}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                          selectedRoles.includes(role.name)
                            ? 'bg-amber-500 text-white border-amber-500'
                            : 'bg-theme-surface-secondary text-theme-text-secondary border-theme-surface-border hover:border-amber-400'
                        }`}
                      >
                        {role.name}
                      </button>
                    ))}
                  </div>
                  {selectedRoles.length === 0 && (
                    <p className="text-xs text-amber-400 mt-1">Select at least one role</p>
                  )}
                </div>
              )}

              {/* Status Selection */}
              {targetType === 'statuses' && (
                <div>
                  <label className="block text-sm font-medium text-theme-text-primary mb-1">Select Statuses</label>
                  <div className="flex flex-wrap gap-2">
                    {STATUS_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setSelectedStatuses(prev =>
                          prev.includes(opt.value) ? prev.filter(s => s !== opt.value) : [...prev, opt.value]
                        )}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                          selectedStatuses.includes(opt.value)
                            ? 'bg-amber-500 text-white border-amber-500'
                            : 'bg-theme-surface-secondary text-theme-text-secondary border-theme-surface-border hover:border-amber-400'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Options */}
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm text-theme-text-secondary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isPinned}
                    onChange={e => setIsPinned(e.target.checked)}
                    className="rounded border-theme-input-border bg-theme-input-bg text-amber-600 focus:ring-amber-500"
                  />
                  <Pin className="w-3.5 h-3.5" /> Pin to top
                </label>
                <label className="flex items-center gap-2 text-sm text-theme-text-secondary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={requiresAck}
                    onChange={e => setRequiresAck(e.target.checked)}
                    className="rounded border-theme-input-border bg-theme-input-bg text-amber-600 focus:ring-amber-500"
                  />
                  <AlertTriangle className="w-3.5 h-3.5" /> Require acknowledgment
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 p-5 border-t border-theme-surface-border">
              <button
                onClick={() => { setShowCompose(false); resetForm(); }}
                className="px-4 py-2 text-sm text-theme-text-secondary hover:text-theme-text-primary"
              >
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={sending || !title.trim() || !body.trim()}
                className="flex items-center gap-2 px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Send Message
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Messages List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 text-slate-400 animate-spin" />
        </div>
      ) : messages.length === 0 ? (
        <div className="text-center py-12 text-theme-text-muted">
          <Megaphone className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p>No department messages yet</p>
          {canManage && <p className="text-sm mt-1">Click "New Message" to send your first announcement</p>}
        </div>
      ) : (
        <div className="space-y-3">
          {messages.map(msg => (
            <div
              key={msg.id}
              className={`bg-theme-surface border rounded-lg p-4 ${
                !msg.is_active ? 'border-theme-surface-border opacity-60' : 'border-theme-surface-border'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {msg.is_pinned && <Pin className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />}
                    <h4 className="text-theme-text-primary font-semibold text-sm truncate">{msg.title}</h4>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase ${PRIORITY_STYLES[msg.priority]}`}>
                      {msg.priority}
                    </span>
                    {!msg.is_active && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-slate-500/30 text-slate-400">Inactive</span>
                    )}
                  </div>
                  <p className="text-theme-text-secondary text-sm line-clamp-2">{msg.body}</p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-theme-text-muted">
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {TARGET_LABELS[msg.target_type] || msg.target_type}
                      {msg.target_type === 'roles' && msg.target_roles?.length
                        ? `: ${msg.target_roles.join(', ')}`
                        : ''}
                      {msg.target_type === 'statuses' && msg.target_statuses?.length
                        ? `: ${msg.target_statuses.join(', ')}`
                        : ''}
                    </span>
                    {msg.created_at && <span>{formatDate(msg.created_at, tz)}</span>}
                    {msg.requires_acknowledgment && (
                      <span className="text-amber-400">Requires Ack</span>
                    )}
                  </div>
                </div>
                {canManage && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleTogglePin(msg)}
                      className={`p-1.5 rounded hover:bg-theme-surface-hover transition-colors ${msg.is_pinned ? 'text-amber-400' : 'text-theme-text-muted'}`}
                      title={msg.is_pinned ? 'Unpin' : 'Pin to top'}
                    >
                      <Pin className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleToggleActive(msg)}
                      className="p-1.5 rounded hover:bg-theme-surface-hover transition-colors text-theme-text-muted"
                      title={msg.is_active ? 'Deactivate' : 'Activate'}
                    >
                      {msg.is_active ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => handleDelete(msg.id)}
                      disabled={deletingId === msg.id}
                      className="p-1.5 rounded hover:bg-red-500/10 transition-colors text-theme-text-muted hover:text-red-400 disabled:opacity-50"
                      title="Delete"
                    >
                      {deletingId === msg.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DepartmentMessagesAdmin;
