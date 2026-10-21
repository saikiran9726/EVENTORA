import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { Badge } from '@/components/ui/Badge';
import { useAuth } from '@/context/AuthContext';
import { User, Bell, Palette, Shield, LogOut, Check, Building2 } from 'lucide-react';

interface ProfilePreferencesPageProps {
  onLogout: () => void;
  isDarkMode: boolean;
  onToggleTheme: () => void;
}

export const ProfilePreferencesPage: React.FC<ProfilePreferencesPageProps> = ({
  onLogout,
  isDarkMode,
  onToggleTheme,
}) => {
  const { user, updateProfile, updatePreferences } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [isSavingName, setIsSavingName] = useState(false);
  const [nameSavedSuccess, setNameSavedSuccess] = useState(false);

  const [emailEnabled, setEmailEnabled] = useState(user?.preferences?.emailEnabled ?? true);
  const [inappEnabled, setInappEnabled] = useState(user?.preferences?.inappEnabled ?? true);

  if (!user) {
    return null;
  }

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName || displayName === user.displayName) return;

    setIsSavingName(true);
    setNameSavedSuccess(false);

    const res = await updateProfile(displayName);
    setIsSavingName(false);
    if (res.success) {
      setNameSavedSuccess(true);
      setTimeout(() => setNameSavedSuccess(false), 3000);
    }
  };

  const handleToggleEmail = async (val: boolean) => {
    setEmailEnabled(val);
    await updatePreferences({ emailEnabled: val });
  };

  const handleToggleInApp = async (val: boolean) => {
    setInappEnabled(val);
    await updatePreferences({ inappEnabled: val });
  };

  return (
    <div className="w-full max-w-2xl mx-auto py-6 px-4 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text">Account & Preferences</h1>
          <p className="text-xs sm:text-sm text-muted">
            Manage your campus profile, notification channels, and appearance
          </p>
        </div>
        <Button variant="destructive" size="sm" onClick={onLogout} className="flex items-center gap-1.5">
          <LogOut className="w-4 h-4" />
          <span>Sign Out</span>
        </Button>
      </div>

      {/* User Information Card */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-3 pb-3">
          <div className="w-10 h-10 rounded-full bg-brand-600/10 text-brand-600 flex items-center justify-center font-bold">
            <User className="w-5 h-5" />
          </div>
          <div>
            <CardTitle className="text-base font-semibold">{user.displayName}</CardTitle>
            <p className="text-xs text-muted">{user.email}</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Badge variant="brand" className="uppercase text-[10px]">
              {user.globalRole}
            </Badge>
            <Badge variant={user.status === 'active' ? 'success' : 'warning'} className="capitalize text-[10px]">
              {user.status}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 pt-2">
          {user.college && (
            <div className="p-3 bg-surface-2 rounded-md border border-border flex items-center gap-3">
              <Building2 className="w-5 h-5 text-muted shrink-0" />
              <div>
                <p className="text-xs text-muted font-medium">Affiliated Institution</p>
                <p className="text-sm font-semibold text-text">{user.college.name}</p>
                <p className="text-xs text-muted">Domain: @{user.college.domain}</p>
              </div>
            </div>
          )}

          <form onSubmit={handleSaveName} className="space-y-3 pt-2">
            <div>
              <label htmlFor="display-name" className="block text-xs font-semibold text-text mb-1">
                Display Name
              </label>
              <div className="flex gap-2">
                <Input
                  id="display-name"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  disabled={isSavingName}
                  required
                />
                <Button
                  type="submit"
                  variant="primary"
                  isLoading={isSavingName}
                  disabled={isSavingName || displayName === user.displayName}
                >
                  Save
                </Button>
              </div>
            </div>

            {nameSavedSuccess && (
              <p className="text-xs text-success flex items-center gap-1">
                <Check className="w-3.5 h-3.5" />
                <span>Display name updated successfully</span>
              </p>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Notification Preferences */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-3 pb-3">
          <div className="w-8 h-8 rounded-full bg-brand-600/10 text-brand-600 flex items-center justify-center font-bold">
            <Bell className="w-4 h-4" />
          </div>
          <CardTitle className="text-base font-semibold">Notifications</CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-md bg-surface-2 border border-border">
            <div>
              <p className="text-sm font-semibold text-text">Email Notifications</p>
              <p className="text-xs text-muted">Receive ticket confirmations, waitlist updates and event reminders</p>
            </div>
            <Switch checked={emailEnabled} onChange={handleToggleEmail} aria-label="Toggle email notifications" />
          </div>

          <div className="flex items-center justify-between p-3 rounded-md bg-surface-2 border border-border">
            <div>
              <p className="text-sm font-semibold text-text">In-App Notifications</p>
              <p className="text-xs text-muted">Receive instant toasts and notifications inside Eventora</p>
            </div>
            <Switch checked={inappEnabled} onChange={handleToggleInApp} aria-label="Toggle in-app notifications" />
          </div>
        </CardContent>
      </Card>

      {/* Theme & Display */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-3 pb-3">
          <div className="w-8 h-8 rounded-full bg-brand-600/10 text-brand-600 flex items-center justify-center font-bold">
            <Palette className="w-4 h-4" />
          </div>
          <CardTitle className="text-base font-semibold">Appearance</CardTitle>
        </CardHeader>

        <CardContent className="space-y-3">
          <div className="flex items-center justify-between p-3 rounded-md bg-surface-2 border border-border">
            <div>
              <p className="text-sm font-semibold text-text">Dark Mode</p>
              <p className="text-xs text-muted">Toggle between dark and light color tokens</p>
            </div>
            <Switch checked={isDarkMode} onChange={onToggleTheme} aria-label="Toggle dark mode" />
          </div>
        </CardContent>
      </Card>

      {/* Security Info */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-3 pb-3">
          <div className="w-8 h-8 rounded-full bg-brand-600/10 text-brand-600 flex items-center justify-center font-bold">
            <Shield className="w-4 h-4" />
          </div>
          <CardTitle className="text-base font-semibold">Security & Session</CardTitle>
        </CardHeader>

        <CardContent className="space-y-2 text-xs text-muted">
          <p>• Password encryption: Argon2id (memory 64 MiB, t=3, p=1)</p>
          <p>• Session security: 256-bit cryptographically secure token, SHA-256 hashed in database</p>
          <p>• Idle expiration: 30 minutes | Absolute duration: 12 hours</p>
        </CardContent>
      </Card>
    </div>
  );
};
