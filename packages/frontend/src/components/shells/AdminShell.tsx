import React from 'react';
import { ShieldAlert, Users, Calendar, FileText, Activity, Sun, Moon, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PROTOTYPE_BADGE_TEXT } from '@/prototype/data';
import { ShellCommonProps } from './StudentShell';

export const AdminShell: React.FC<ShellCommonProps> = ({
  currentRole,
  onRoleChange,
  activeRoute,
  onRouteChange,
  isDarkMode,
  onToggleDarkMode,
  children,
}) => {
  const navItems = [
    { id: 'admin-overview', label: 'Platform Health', icon: Activity },
    { id: 'admin-users', label: 'Users & Roles', icon: Users },
    { id: 'admin-clubs', label: 'Club Verification', icon: ShieldAlert },
    { id: 'admin-events', label: 'All Events', icon: Calendar },
    { id: 'admin-audit', label: 'Audit Trail', icon: FileText },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-bg text-text antialiased selection:bg-brand selection:text-white w-full overflow-x-hidden">
      <div className="bg-brand text-white text-xs py-1.5 px-4 font-medium tracking-wide flex items-center justify-between z-50">
        <div className="flex items-center gap-2 mx-auto">
          <span className="w-2 h-2 rounded-full bg-warning animate-ping" />
          <span className="font-semibold">{PROTOTYPE_BADGE_TEXT}</span>
          <span className="hidden sm:inline text-white/80">| Platform Administrator Shell</span>
        </div>
      </div>

      <header className="sticky top-0 z-40 bg-surface/90 backdrop-blur-md border-b border-border h-14 flex items-center justify-between px-4 lg:px-6 w-full">
        <div className="flex items-center gap-3">
          <button onClick={() => onRouteChange('admin-overview')} className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-brand flex items-center justify-center text-white font-bold text-base shadow-sm">
              E
            </div>
            <div>
              <span className="font-bold text-base tracking-tight text-text">EVENTORA</span>
              <span className="hidden sm:inline-block text-[10px] ml-1.5 font-medium text-error bg-error/10 px-1.5 py-0.5 rounded-sm">
                System Admin
              </span>
            </div>
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-surface-2 border border-border rounded-md px-2 py-1 text-xs">
            <span className="text-text-muted hidden sm:inline">Role:</span>
            <select
              value={currentRole}
              onChange={(e) => onRoleChange(e.target.value)}
              className="bg-transparent text-xs font-semibold text-brand focus:outline-none cursor-pointer"
              aria-label="Switch User Role"
            >
              <option value="student">Student</option>
              <option value="organizer">Club Organizer</option>
              <option value="reviewer">Faculty Reviewer</option>
              <option value="checkin_staff">Check-in Staff</option>
              <option value="admin">Administrator</option>
            </select>
          </div>

          <button
            type="button"
            onClick={onToggleDarkMode}
            className="p-2 rounded-md text-text-muted hover:text-text hover:bg-surface-2 transition-colors"
            aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDarkMode ? <Sun className="w-4 h-4 text-warning" /> : <Moon className="w-4 h-4 text-brand" />}
          </button>
        </div>
      </header>

      <div className="flex-1 flex w-full min-w-0">
        <aside className="hidden lg:flex flex-col border-r border-border bg-surface w-60 shrink-0 sticky top-14 h-[calc(100vh-3.5rem-2rem)]">
          <div className="p-3 flex-1 flex flex-col gap-1">
            <div className="px-2 py-1.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">
              Administration
            </div>
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeRoute === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onRouteChange(item.id)}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors text-left',
                    isActive ? 'bg-brand text-white shadow-sm' : 'text-text-muted hover:text-text hover:bg-surface-2'
                  )}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
            <div className="pt-2 mt-2 border-t border-border">
              <button
                onClick={() => onRouteChange('components')}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors text-left',
                  activeRoute === 'components' ? 'bg-brand text-white' : 'text-text-muted hover:text-text hover:bg-surface-2'
                )}
              >
                <Sparkles className="w-4 h-4 shrink-0" />
                <span>UI Components Gallery</span>
              </button>
            </div>
          </div>
        </aside>

        <main className="flex-1 w-full min-w-0 max-w-content mx-auto p-4 sm:p-6 lg:p-8 pb-24 md:pb-8">
          {children}
        </main>
      </div>

      <nav
        aria-label="Admin Navigation"
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
    </div>
  );
};
