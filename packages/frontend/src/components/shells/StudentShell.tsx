import React, { useState } from 'react';
import { Compass, Calendar, Ticket, Award, User, Bell, Sun, Moon, Users, HeartHandshake } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PROTOTYPE_BADGE_TEXT } from '@/prototype/data';
import { NotificationCenter } from '@/components/notifications/NotificationCenter';

export interface ShellCommonProps {
  currentRole?: string;
  onRoleChange?: (role: any) => void;
  activeRoute?: string;
  onRouteChange?: (route: string) => void;
  isDarkMode?: boolean;
  onToggleDarkMode?: () => void;
  children: React.ReactNode;
}

export const StudentShell: React.FC<ShellCommonProps> = ({
  activeRoute = 'discover',
  onRouteChange = () => {},
  isDarkMode = false,
  onToggleDarkMode = () => {},
  children,
}) => {
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const navItems = [
    { id: 'discover', label: 'Discover', icon: Compass },
    { id: 'calendar', label: 'Calendar', icon: Calendar },
    { id: 'tickets', label: 'Tickets', icon: Ticket },
    { id: 'passport', label: 'Passport', icon: Award },
    { id: 'profile', label: 'Me', icon: User },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-bg text-text antialiased selection:bg-brand selection:text-white w-full overflow-x-hidden">
      {/* Top Prototype Badge Banner */}
      <div className="bg-brand text-white text-xs py-1.5 px-4 font-medium tracking-wide flex items-center justify-between z-50">
        <div className="flex items-center gap-2 mx-auto">
          <span className="w-2 h-2 rounded-full bg-warning animate-ping" />
          <span className="font-semibold">{PROTOTYPE_BADGE_TEXT}</span>
          <span className="hidden sm:inline text-white/80">| Student Experience Shell</span>
        </div>
      </div>

      {/* Top Header */}
      <header className="sticky top-0 z-40 bg-surface/90 backdrop-blur-md border-b border-border h-14 flex items-center justify-between px-4 lg:px-6 w-full">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onRouteChange('discover')}
            className="flex items-center gap-2 group text-left"
          >
            <div className="w-8 h-8 rounded-md bg-brand flex items-center justify-center text-white font-bold text-base shadow-sm">
              E
            </div>
            <div>
              <span className="font-bold text-base tracking-tight text-text">EVENTORA</span>
              <span className="hidden sm:inline-block text-[10px] ml-1.5 font-medium text-brand bg-brand/10 px-1.5 py-0.5 rounded-sm">
                Student Portal
              </span>
            </div>
          </button>
        </div>

        {/* Global Controls */}
        <div className="flex items-center gap-2 md:gap-3">
          <button
            type="button"
            onClick={() => onRouteChange('teams')}
            className="px-2 py-1 rounded-md text-xs font-semibold text-brand bg-brand/10 hover:bg-brand/20 transition-colors flex items-center gap-1"
          >
            <Users className="w-3.5 h-3.5" />
            <span>Teams</span>
          </button>

          <button
            type="button"
            onClick={() => onRouteChange('volunteers')}
            className="px-2 py-1 rounded-md text-xs font-semibold text-brand bg-brand/10 hover:bg-brand/20 transition-colors flex items-center gap-1"
          >
            <HeartHandshake className="w-3.5 h-3.5" />
            <span>Volunteers</span>
          </button>

          <button
            type="button"
            onClick={() => onRouteChange('components')}
            className="px-2 py-1 rounded-md text-xs font-semibold text-brand bg-brand/10 hover:bg-brand/20 transition-colors flex items-center gap-1"
          >
            <span>UI Gallery</span>
          </button>

          <button
            type="button"
            onClick={onToggleDarkMode}
            className="p-2 rounded-md text-text-muted hover:text-text hover:bg-surface-2 transition-colors"
            aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDarkMode ? <Sun className="w-4 h-4 text-warning" /> : <Moon className="w-4 h-4 text-brand" />}
          </button>

          <button
            type="button"
            onClick={() => setIsNotificationOpen(true)}
            className="p-2 rounded-md text-text-muted hover:text-text hover:bg-surface-2 transition-colors relative"
            aria-label="View notifications"
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 bg-error text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Main Layout Area */}
      <div className="flex-1 flex w-full min-w-0">
        {/* Desktop Sidebar (240px) */}
        <aside className="hidden lg:flex flex-col border-r border-border bg-surface w-60 shrink-0 sticky top-14 h-[calc(100vh-3.5rem-2rem)]">
          <div className="p-3 flex-1 flex flex-col gap-1">
            <div className="px-2 py-1.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">
              Student Navigation
            </div>
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeRoute === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onRouteChange(item.id)}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors duration-fast text-left',
                    isActive ? 'bg-brand text-white shadow-sm' : 'text-text-muted hover:text-text hover:bg-surface-2'
                  )}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
            <button
              onClick={() => onRouteChange('teams')}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors text-left',
                activeRoute === 'teams' ? 'bg-brand text-white shadow-sm' : 'text-text-muted hover:text-text hover:bg-surface-2'
              )}
            >
              <Users className="w-4 h-4 shrink-0" />
              <span>Teams & Hub</span>
            </button>
            <div className="pt-2 mt-2 border-t border-border">
              <button
                onClick={() => onRouteChange('components')}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors text-left',
                  activeRoute === 'components' ? 'bg-brand text-white' : 'text-text-muted hover:text-text hover:bg-surface-2'
                )}
              >
                <span>UI Components Gallery</span>
              </button>
            </div>
          </div>
        </aside>

        {/* Content Area */}
        <main className="flex-1 w-full min-w-0 max-w-content mx-auto p-4 sm:p-6 lg:p-8 pb-24 md:pb-8">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation (Phones: max 5 items: Discover, Calendar, Tickets, Passport, Me) */}
      <nav
        aria-label="Student Navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-surface/95 backdrop-blur-md border-t border-border h-16 flex items-center justify-around px-2"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeRoute === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onRouteChange(item.id)}
              className={cn(
                'flex flex-col items-center justify-center flex-1 py-1 gap-1 text-[11px] font-medium transition-colors',
                isActive ? 'text-brand font-semibold' : 'text-text-muted hover:text-text'
              )}
            >
              <Icon className={cn('w-5 h-5', isActive && 'text-brand')} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <NotificationCenter
        isOpen={isNotificationOpen}
        onClose={() => setIsNotificationOpen(false)}
        onUnreadCountChange={setUnreadCount}
      />
    </div>
  );
};
