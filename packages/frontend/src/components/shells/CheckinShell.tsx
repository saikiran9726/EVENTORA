import React from 'react';
import { QrCode, Sun, Moon, ArrowLeft, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { PROTOTYPE_BADGE_TEXT } from '@/prototype/data';
import { ShellCommonProps } from './StudentShell';

export const CheckinShell: React.FC<ShellCommonProps> = ({
  onRouteChange = () => {},
  isDarkMode = false,
  onToggleDarkMode = () => {},
  children,
}) => {
  return (
    <div className="min-h-screen flex flex-col bg-bg text-text antialiased selection:bg-brand selection:text-white w-full overflow-x-hidden">
      {/* Top Prototype Badge Banner */}
      <div className="bg-brand text-white text-xs py-1.5 px-4 font-medium tracking-wide flex items-center justify-between z-50">
        <div className="flex items-center gap-2 mx-auto">
          <span className="w-2 h-2 rounded-full bg-warning animate-ping" />
          <span className="font-semibold">{PROTOTYPE_BADGE_TEXT}</span>
          <span className="hidden sm:inline text-white/80">| Scanner-First Gate Staff Shell</span>
        </div>
      </div>

      {/* Dedicated Scanner-First Header */}
      <header className="sticky top-0 z-40 bg-surface/95 backdrop-blur-md border-b border-border h-14 pt-safe flex items-center justify-between px-4 w-full">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onRouteChange('discover')}
            className="p-1.5 rounded-md text-text-muted hover:text-text hover:bg-surface-2 transition-colors"
            aria-label="Back to Events"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-text flex items-center gap-1.5">
              <QrCode className="w-4 h-4 text-brand" />
              <span>Eventora Turnstile Scanner</span>
            </h1>
            <span className="text-[10px] text-success font-medium">Online • Event Manifest Cached</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleDarkMode}
            className="p-2 rounded-md text-text-muted hover:text-text hover:bg-surface-2 transition-colors"
            aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDarkMode ? <Sun className="w-4 h-4 text-warning" /> : <Moon className="w-4 h-4 text-brand" />}
          </button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => onRouteChange('components')}
            className="hidden sm:inline-flex text-xs py-1 px-2"
          >
            <Sparkles className="w-3.5 h-3.5 mr-1" />
            <span>UI Gallery</span>
          </Button>
        </div>
      </header>

      {/* Full-screen Scanner Viewport */}
      <main className="flex-1 w-full max-w-content mx-auto p-4 pb-safe flex flex-col justify-center">
        {children}
      </main>
    </div>
  );
};
