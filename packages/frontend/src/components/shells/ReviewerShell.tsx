import React from 'react';
import { ShieldCheck, CheckSquare, Clock, Sun, Moon, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ShellCommonProps } from './StudentShell';

export const ReviewerShell: React.FC<ShellCommonProps> = ({
  activeRoute = 'review-queue',
  onRouteChange = () => {},
  isDarkMode = false,
  onToggleDarkMode = () => {},
  children,
}) => {
  const navItems = [
    { id: 'review-queue', label: 'Proposal Queue', icon: ShieldCheck },
    { id: 'approved-events', label: 'Approved Log', icon: CheckSquare },
    { id: 'venue-calendar', label: 'Venue Bookings', icon: Clock },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-bg text-text antialiased selection:bg-brand selection:text-white w-full overflow-x-hidden">
      {/* Optional Demo Mode Banner (tree-shaken when VITE_DEMO_MODE is not true) */}
      {import.meta.env.VITE_DEMO_MODE === 'true' && (
        <div className="bg-brand text-white text-xs py-1.5 px-4 font-medium tracking-wide flex items-center justify-between z-50">
          <div className="flex items-center gap-2 mx-auto">
            <span className="w-2 h-2 rounded-full bg-warning animate-ping" />
            <span className="font-semibold">DEMO MODE</span>
            <span className="hidden sm:inline text-white/80">| Faculty Reviewer Governance Shell</span>
          </div>
        </div>
      )}

      <header className="sticky top-0 z-40 bg-surface/90 backdrop-blur-md border-b border-border h-14 pt-safe flex items-center justify-between px-4 lg:px-6 w-full">
        <div className="flex items-center gap-3">
          <button onClick={() => onRouteChange('review-queue')} className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-brand flex items-center justify-center text-white font-bold text-base shadow-sm">
              E
            </div>
            <div>
              <span className="font-bold text-base tracking-tight text-text">EVENTORA</span>
              <span className="hidden sm:inline-block text-[10px] ml-1.5 font-medium text-brand bg-brand/10 px-1.5 py-0.5 rounded-sm">
                Faculty Review
              </span>
            </div>
          </button>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onRouteChange('discover')}
            className="px-2 py-1 rounded-md text-xs font-semibold text-text-muted hover:text-text bg-surface-2 hover:bg-surface transition-colors"
          >
            ← Campus Events
          </button>

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
              Faculty Review
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
            {import.meta.env.DEV && (
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
            )}
          </div>
        </aside>

        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 w-full min-w-0 max-w-content mx-auto p-4 sm:p-6 lg:p-8 pb-[calc(5rem+env(safe-area-inset-bottom,0px))] md:pb-8 focus:outline-none"
        >
          {children}
        </main>
      </div>

      <nav
        aria-label="Reviewer Navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-surface/95 backdrop-blur-md border-t border-border min-h-[4rem] pb-safe flex items-center justify-around px-2"
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
