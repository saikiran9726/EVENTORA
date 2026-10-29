import React, { useState, useEffect, useCallback } from 'react';
import {
  Bell,
  Check,
  CheckCheck,
  AlertTriangle,
  Flame,
  Settings,
  X,
  RefreshCw,
  Mail,
  Smartphone,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { Card } from '@/components/ui/Card';
import { apiClient } from '@/lib/api-client';

export interface UserNotification {
  id: string;
  userId: string;
  type: string;
  eventId: string | null;
  title: string;
  body: string;
  severity: 'info' | 'important' | 'urgent';
  payload: any;
  readAt: string | null;
  createdAt: string;
}

export interface UserNotificationPreferences {
  email: boolean;
  inapp: boolean;
  urgentOnly: boolean;
}

interface NotificationCenterProps {
  isOpen: boolean;
  onClose: () => void;
  onUnreadCountChange?: (count: number) => void;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({
  isOpen,
  onClose,
  onUnreadCountChange,
}) => {
  const [activeTab, setActiveTab] = useState<'notifications' | 'preferences'>('notifications');
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [preferences, setPreferences] = useState<UserNotificationPreferences>({
    email: true,
    inapp: true,
    urgentOnly: false,
  });
  const [savingPrefs, setSavingPrefs] = useState<boolean>(false);

  // Fetch notifications
  const fetchNotifications = useCallback(async () => {
    setLoading(true);

    try {
      const data = await apiClient<any>('/api/v1/me/notifications');
      if (data) {
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount || 0);
        if (onUnreadCountChange) onUnreadCountChange(data.unreadCount || 0);
        return;
      }
    } catch {
      // Network/auth error -> empty state
      setNotifications([]);
      setUnreadCount(0);
      if (onUnreadCountChange) onUnreadCountChange(0);
    } finally {
      setLoading(false);
    }
  }, [onUnreadCountChange]);

  // Fetch preferences
  const fetchPreferences = useCallback(async () => {
    try {
      const data = await apiClient<any>('/api/v1/me/notification-preferences');
      if (data?.preferences) {
        setPreferences(data.preferences);
      }
    } catch {
      // Prototype defaults
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchNotifications();
      fetchPreferences();
    }
  }, [isOpen, fetchNotifications, fetchPreferences]);

  // Mark single notification read
  const handleMarkRead = async (id: string) => {
    try {
      await apiClient(`/api/v1/me/notifications/${id}/read`, {
        method: 'PATCH',
      });
    } catch {
      // Local fallback
    }

    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n))
    );
    setUnreadCount((c) => Math.max(0, c - 1));
    if (onUnreadCountChange) onUnreadCountChange(Math.max(0, unreadCount - 1));
  };

  // Mark all read
  const handleMarkAllRead = async () => {
    try {
      await apiClient('/api/v1/me/notifications/read-all', {
        method: 'POST',
      });
    } catch {
      // Local fallback
    }

    setNotifications((prev) =>
      prev.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() }))
    );
    setUnreadCount(0);
    if (onUnreadCountChange) onUnreadCountChange(0);
  };

  // Update preferences
  const handleUpdatePreference = async (key: keyof UserNotificationPreferences, val: boolean) => {
    const updated = { ...preferences, [key]: val };
    setPreferences(updated);
    setSavingPrefs(true);

    try {
      await apiClient('/api/v1/me/notification-preferences', {
        method: 'PATCH',
        body: JSON.stringify(updated),
      });
    } catch {
      // Ignored in prototype
    } finally {
      setSavingPrefs(false);
    }
  };

  if (!isOpen) return null;

  // Split into Urgent (pinned at top), Today, Earlier
  const urgentNotifications = notifications.filter((n) => n.severity === 'urgent');
  const normalNotifications = notifications.filter((n) => n.severity !== 'urgent');

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const todayNotifications = normalNotifications.filter(
    (n) => new Date(n.createdAt) >= today
  );
  const earlierNotifications = normalNotifications.filter(
    (n) => new Date(n.createdAt) < today
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-end p-2 sm:p-4 bg-black/40 backdrop-blur-xs animate-in fade-in"
      role="dialog"
      aria-modal="true"
      aria-label="Notification Center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-surface border border-border rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden mt-12 sm:mt-14"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border bg-surface-2">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-brand" />
            <h2 className="text-base font-bold text-text">Notifications</h2>
            {unreadCount > 0 && (
              <Badge variant="brand" size="sm" className="font-mono">
                {unreadCount} new
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setActiveTab(activeTab === 'notifications' ? 'preferences' : 'notifications')}
              className="p-1.5 rounded-md text-text-muted hover:text-text hover:bg-surface transition-colors"
              aria-label="Notification settings"
              title="Notification settings"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md text-text-muted hover:text-text hover:bg-surface transition-colors"
              aria-label="Close notification center"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === 'preferences' ? (
          <div className="p-4 space-y-4 overflow-y-auto flex-1">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <h3 className="text-sm font-bold text-text">Delivery Preferences</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setActiveTab('notifications')}
                className="text-xs"
              >
                Back to Feed
              </Button>
            </div>

            <div className="space-y-4">
              <Card className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Smartphone className="w-5 h-5 text-brand" />
                  <div>
                    <p className="text-xs font-semibold text-text">In-App Notifications</p>
                    <p className="text-[11px] text-text-muted">Direct bell feed inside campus portal</p>
                  </div>
                </div>
                <Switch
                  checked={preferences.inapp}
                  onChange={(val) => handleUpdatePreference('inapp', val)}
                  aria-label="Toggle in-app notifications"
                />
              </Card>

              <Card className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Mail className="w-5 h-5 text-brand" />
                  <div>
                    <p className="text-xs font-semibold text-text">Email Notifications</p>
                    <p className="text-[11px] text-text-muted">Immediate digest to your verified college email</p>
                  </div>
                </div>
                <Switch
                  checked={preferences.email}
                  onChange={(val) => handleUpdatePreference('email', val)}
                  aria-label="Toggle email notifications"
                />
              </Card>

              <Card className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Flame className="w-5 h-5 text-error" />
                  <div>
                    <p className="text-xs font-semibold text-text">Urgent Only Mode</p>
                    <p className="text-[11px] text-text-muted">Suppress informational updates; receive only safety & venue alerts</p>
                  </div>
                </div>
                <Switch
                  checked={preferences.urgentOnly}
                  onChange={(val) => handleUpdatePreference('urgentOnly', val)}
                  aria-label="Toggle urgent only mode"
                />
              </Card>
            </div>

            {savingPrefs && (
              <p className="text-[11px] text-text-muted flex items-center gap-1.5 animate-pulse">
                <RefreshCw className="w-3 h-3 animate-spin" /> Saving delivery preferences...
              </p>
            )}
          </div>
        ) : (
          <>
            {/* Action Bar */}
            <div className="flex items-center justify-between px-4 py-2 bg-surface border-b border-border text-xs">
              <span className="text-text-muted font-medium">
                {notifications.length} total • {unreadCount} unread
              </span>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="text-xs font-semibold text-brand hover:underline flex items-center gap-1"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  Mark all as read
                </button>
              )}
            </div>

            {/* List */}
            <div className="overflow-y-auto flex-1 divide-y divide-border/60">
              {/* Urgent Pinned Section */}
              {urgentNotifications.length > 0 && (
                <div className="bg-error/5 p-3 space-y-2 border-b border-error/20">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-error uppercase tracking-wider">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Urgent Event Alerts (Direct Tx)</span>
                  </div>
                  {urgentNotifications.map((notif) => (
                    <NotificationItem
                      key={notif.id}
                      item={notif}
                      onMarkRead={() => handleMarkRead(notif.id)}
                    />
                  ))}
                </div>
              )}

              {/* Today Section */}
              {todayNotifications.length > 0 && (
                <div className="p-3 space-y-2">
                  <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                    Today
                  </div>
                  {todayNotifications.map((notif) => (
                    <NotificationItem
                      key={notif.id}
                      item={notif}
                      onMarkRead={() => handleMarkRead(notif.id)}
                    />
                  ))}
                </div>
              )}

              {/* Earlier Section */}
              {earlierNotifications.length > 0 && (
                <div className="p-3 space-y-2">
                  <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                    Earlier
                  </div>
                  {earlierNotifications.map((notif) => (
                    <NotificationItem
                      key={notif.id}
                      item={notif}
                      onMarkRead={() => handleMarkRead(notif.id)}
                    />
                  ))}
                </div>
              )}

              {notifications.length === 0 && !loading && (
                <div className="p-8 text-center text-text-muted space-y-2">
                  <Bell className="w-8 h-8 mx-auto opacity-40" />
                  <p className="text-sm font-medium">All caught up!</p>
                  <p className="text-xs">No active alerts or notifications right now.</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

interface NotificationItemProps {
  item: UserNotification;
  onMarkRead: () => void;
}

const NotificationItem: React.FC<NotificationItemProps> = ({ item, onMarkRead }) => {
  const isUrgent = item.severity === 'urgent';
  const isImportant = item.severity === 'important';
  const isUnread = !item.readAt;

  return (
    <div
      className={`p-3 rounded-lg border transition-all text-xs flex items-start justify-between gap-3 ${
        isUrgent
          ? 'bg-error/10 border-error/40 text-text'
          : isUnread
          ? 'bg-brand/5 border-brand/20 text-text'
          : 'bg-surface border-border text-text-muted hover:bg-surface-2'
      }`}
    >
      <div className="space-y-1 flex-1">
        <div className="flex items-center gap-1.5">
          {isUrgent ? (
            <Badge variant="error" size="sm" className="font-bold flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Urgent
            </Badge>
          ) : isImportant ? (
            <Badge variant="warning" size="sm">Important</Badge>
          ) : (
            <Badge variant="neutral" size="sm">Info</Badge>
          )}
          <span className="text-[10px] text-text-muted">
            {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <p className={`font-semibold ${isUnread ? 'text-text' : 'text-text-muted'}`}>{item.title}</p>
        <p className="text-text/80 text-[11px] leading-relaxed">{item.body}</p>
      </div>

      {isUnread && (
        <button
          type="button"
          onClick={onMarkRead}
          className="shrink-0 p-1 rounded-md text-brand hover:bg-brand/10 transition-colors"
          title="Mark as read"
          aria-label="Mark notification as read"
        >
          <Check className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};
