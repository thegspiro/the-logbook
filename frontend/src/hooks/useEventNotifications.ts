/**
 * useEventNotifications Hook
 *
 * Manages notification panel state and submission for EventDetailPage.
 */

import { useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { AxiosError } from 'axios';
import { eventService } from '../services/api';
import type { NotificationType, NotificationTarget } from '../components/event-detail/EventNotificationPanel';

interface LastNotification {
  type: string;
  target: string;
  recipients: number;
  sentAt: string;
}

export const useEventNotifications = (eventId: string | undefined) => {
  const [notificationType, setNotificationType] = useState<NotificationType>('announcement');
  const [notificationTarget, setNotificationTarget] = useState<NotificationTarget>('all');
  const [notificationMessage, setNotificationMessage] = useState('');
  const [sendingNotification, setSendingNotification] = useState(false);
  const [showNotifyConfirm, setShowNotifyConfirm] = useState(false);
  const [lastNotification, setLastNotification] = useState<LastNotification | null>(null);
  const [sendingReminders, setSendingReminders] = useState(false);
  const [showReminderMenu, setShowReminderMenu] = useState(false);

  const handleSendNotification = useCallback(async () => {
    if (!eventId) return;

    try {
      setSendingNotification(true);
      setShowNotifyConfirm(false);
      const result = await eventService.sendEventNotification(eventId, {
        notification_type: notificationType,
        message: notificationMessage.trim() || undefined,
        target: notificationTarget,
      });
      toast.success(result.message);
      setLastNotification({
        type: notificationType,
        target: notificationTarget,
        recipients: result.recipients_count,
        sentAt: new Date().toISOString(),
      });
      setNotificationMessage('');
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail?: string }>;
      toast.error(axiosErr.response?.data?.detail || 'Failed to send notification');
    } finally {
      setSendingNotification(false);
    }
  }, [eventId, notificationType, notificationTarget, notificationMessage]);

  const handleSendReminders = useCallback(async (reminderType: 'non_respondents' | 'all') => {
    if (!eventId) return;

    try {
      setSendingReminders(true);
      setShowReminderMenu(false);
      const result = await eventService.sendReminders(eventId, reminderType);
      toast.success(`${result.sent_count} reminder(s) queued`);
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail?: string }>;
      toast.error(axiosErr.response?.data?.detail || 'Failed to send reminders');
    } finally {
      setSendingReminders(false);
    }
  }, [eventId]);

  return {
    notificationType,
    setNotificationType,
    notificationTarget,
    setNotificationTarget,
    notificationMessage,
    setNotificationMessage,
    sendingNotification,
    showNotifyConfirm,
    setShowNotifyConfirm,
    lastNotification,
    sendingReminders,
    showReminderMenu,
    setShowReminderMenu,
    handleSendNotification,
    handleSendReminders,
  };
};
