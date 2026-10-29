import React, { useState } from 'react';
import {
  Compass,
  Calendar,
  Layers,
  LayoutDashboard,
  ShieldCheck,
  Award,
  Bell,
  Sun,
  Moon,
  Menu,
  ChevronLeft,
  ChevronRight,
  User,
  Sparkles,
  QrCode,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type CurrentRole = 'student' | 'organizer' | 'reviewer' | 'admin' | 'checkin_staff';

interface AppShellProps {
  currentRole?: CurrentRole;
  onRoleChange?: (role: CurrentRole) => void;
  activeRoute?: string;
  onRouteChange?: (route: string) => void;
  isDarkMode?: boolean;
  onToggleDarkMode?: () => void;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({
  currentRole = 'student',
  activeRoute = 'discover',
  onRouteChange = () => {},
  isDarkMode = false,
  onToggleDarkMode = () => {},
  children,
}) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Role-specific navigation items
  const getNavItems = () => {
    switch (currentRole) {
      case 'student':
        return [
          { id: 'discover', label: 'Discover', icon: Compass },
          { id: 'my-events', label: 'My Events', icon: Calendar },
          { id: 'passport', label: 'Passport', icon: Award },
          { id: 'components', label: 'UI Tokens', icon: Sparkles },
        ];
      case 'organizer':
        return [
          { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
          { id: 'discover', label: 'All Events', icon: Compass },
          { id: 'analytics', label: 'Sales & Metrics', icon: Layers },
          { id: 'components', label: 'UI Tokens', icon: Sparkles },
        ];
      case 'reviewer':
        return [
          { id: 'review-queue', label: 'Approval Queue', icon: ShieldCheck },
          { id: 'discover', label: 'Campus Events', icon: Compass },
          { id: 'components', label: 'UI Tokens', icon: Sparkles },
        ];
      case 'checkin_staff':
        return [
          { id: 'scanner', label: 'QR Scanner', icon: QrCode },
          { id: 'discover', label: 'Events', icon: Compass },
          { id: 'components', label: 'UI Tokens', icon: Sparkles },
        ];
      case 'admin':
        return [
          { id: 'admin-overview', label: 'Admin Hub', icon: ShieldCheck },
          { id: 'discover', label: 'Events', icon: Compass },
          { id: 'components', label: 'UI Tokens', icon: Sparkles },
        ];
      default:
        return [{ id: 'discover', label: 'Discover', icon: Compass }];
    }
  };

  const navItems = getNavItems();
  // Bottom navigation on mobile has max 5 items
  const mobileNavItems = navItems.slice(0, 5);

  return (
    <div className="min-h-screen flex flex-col bg-bg text-text antialiased selection:bg-brand selection:text-white w-full overflow-x-hidden">
      {/* Optional Demo Mode Banner (tree-shaken when VITE_DEMO_MODE is not true) */}
      {import.meta.env.VITE_DEMO_MODE === 'true' && (
        <div className="bg-brand text-white text-xs py-1.5 px-4 text-center font-medium tracking-wide flex items-center justify-between z-50">
          <span className="flex items-center gap-1.5 mx-auto">
            <span className="w-2 h-2 rounded-full bg-warning animate-ping inline-block" />
            <span>Eventora Demo Mode</span>
          </span>
        </div>
      )}

      {/* Main Top Header */}
      <header className="sticky top-0 z-40 bg-surface/90 backdrop-blur-md border-b border-border h-14 pt-safe flex items-center justify-between px-4 lg:px-6 w-full">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-1.5 rounded-md text-text-muted hover:text-text hover:bg-surface-2 lg:hidden"
            aria-label="Toggle mobile menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={() => onRouteChange('discover')}
            className="flex items-center gap-2 group text-left"
          >
            <div className="w-8 h-8 rounded-md bg-brand flex items-center justify-center text-white font-bold text-base shadow-sm group-hover:bg-brand-hover transition-colors">
              E
            </div>
            <div>
              <span className="font-bold text-base tracking-tight text-text">EVENTORA</span>
              <span className="hidden sm:inline-block text-[10px] ml-1.5 font-medium text-brand bg-brand/10 px-1.5 py-0.5 rounded-sm">
                Smart Campus
              </span>
            </div>
          </button>
        </div>

        {/* Global Controls */}
        <div className="flex items-center gap-2 md:gap-3">
          {/* Theme Toggle */}
          <button
            type="button"
            onClick={onToggleDarkMode}
            className="p-2 rounded-md text-text-muted hover:text-text hover:bg-surface-2 transition-colors"
            aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDarkMode ? <Sun className="w-4 h-4 text-warning" /> : <Moon className="w-4 h-4 text-brand" />}
          </button>

          {/* Notifications Button */}
          <button
            type="button"
            className="p-2 rounded-md text-text-muted hover:text-text hover:bg-surface-2 transition-colors relative"
            aria-label="View notifications"
          >
            <Bell className="w-4 h-4" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-brand rounded-full" />
          </button>

          {/* User Profile Avatar */}
          <div className="flex items-center gap-2 pl-1 border-l border-border">
            <div className="w-7 h-7 rounded-full bg-brand/10 border border-brand/20 flex items-center justify-center text-brand font-semibold text-xs">
              <User className="w-4 h-4" />
            </div>
          </div>
        </div>
      </header>

      {/* Main Layout Area */}
      <div className="flex-1 flex w-full min-w-0">
        {/* Desktop Collapsible 240px Sidebar */}
        <aside
          className={cn(
            'hidden lg:flex flex-col border-r border-border bg-surface transition-all duration-normal ease-eventora shrink-0 sticky top-14 h-[calc(100vh-3.5rem-2rem)]',
            sidebarCollapsed ? 'w-16' : 'w-60'
          )}
        >
          <div className="p-3 flex-1 flex flex-col gap-1">
            <div className="px-2 py-1.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">
              {!sidebarCollapsed && <span>Navigation</span>}
            </div>

            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeRoute === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onRouteChange(item.id)}
                  title={sidebarCollapsed ? item.label : undefined}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors duration-fast ease-eventora text-left',
                    isActive
                      ? 'bg-brand text-white shadow-sm'
                      : 'text-text-muted hover:text-text hover:bg-surface-2'
                  )}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {!sidebarCollapsed && <span>{item.label}</span>}
                </button>
              );
            })}
          </div>

          {/* Sidebar Collapse Toggle */}
          <div className="p-3 border-t border-border flex items-center justify-between">
            {!sidebarCollapsed && (
              <span className="text-xs text-text-muted capitalize">
                {currentRole.replace('_', ' ')} Portal
              </span>
            )}
            <button
              type="button"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="p-1.5 rounded-md text-text-muted hover:text-text hover:bg-surface-2"
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
          </div>
        </aside>

        {/* Content Viewport Area */}
        <main className="flex-1 w-full min-w-0 max-w-content mx-auto p-4 sm:p-6 lg:p-8 pb-[calc(5rem+env(safe-area-inset-bottom,0px))] md:pb-8">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation (Phones: max 5 items) */}
      <nav
        aria-label="Mobile Navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-surface/95 backdrop-blur-md border-t border-border min-h-[4rem] pb-safe flex items-center justify-around px-2"
      >
        {mobileNavItems.map((item) => {
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
    </div>
  );
};
