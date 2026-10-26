import React, { useRef } from 'react';
import { cn } from '@/lib/utils';

export interface TabItem {
  id: string;
  label: string;
  count?: number;
  disabled?: boolean;
}

export interface TabsProps {
  tabs: TabItem[];
  activeTab: string;
  onChange: (tabId: string) => void;
  className?: string;
  'aria-label'?: string;
}

export const Tabs: React.FC<TabsProps> = ({
  tabs,
  activeTab,
  onChange,
  className,
  'aria-label': ariaLabel = 'Content navigation tabs',
}) => {
  const tabListRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    const enabledTabs = tabs.filter((t) => !t.disabled);
    if (enabledTabs.length === 0) return;

    let targetIndex = -1;

    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        targetIndex = (currentIndex + 1) % tabs.length;
        while (tabs[targetIndex]?.disabled && targetIndex !== currentIndex) {
          targetIndex = (targetIndex + 1) % tabs.length;
        }
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        targetIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        while (tabs[targetIndex]?.disabled && targetIndex !== currentIndex) {
          targetIndex = (targetIndex - 1 + tabs.length) % tabs.length;
        }
        break;
      case 'Home':
        e.preventDefault();
        targetIndex = tabs.findIndex((t) => !t.disabled);
        break;
      case 'End':
        e.preventDefault();
        for (let i = tabs.length - 1; i >= 0; i--) {
          if (!tabs[i].disabled) {
            targetIndex = i;
            break;
          }
        }
        break;
      default:
        return;
    }

    if (targetIndex >= 0 && targetIndex < tabs.length && !tabs[targetIndex].disabled) {
      const nextTab = tabs[targetIndex];
      onChange(nextTab.id);

      // Focus the newly active tab button
      const buttons = tabListRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
      if (buttons && buttons[targetIndex]) {
        buttons[targetIndex].focus();
      }
    }
  };

  return (
    <div
      ref={tabListRef}
      role="tablist"
      aria-label={ariaLabel}
      className={cn('flex space-x-1 border-b border-border overflow-x-auto scrollbar-none', className)}
    >
      {tabs.map((tab, idx) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            aria-controls={`tabpanel-${tab.id}`}
            id={`tab-${tab.id}`}
            tabIndex={isActive ? 0 : -1}
            disabled={tab.disabled}
            onClick={() => !tab.disabled && onChange(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            className={cn(
              'px-3.5 py-2.5 text-xs md:text-sm font-medium border-b-2 -mb-px transition-colors duration-fast ease-eventora flex items-center gap-1.5 whitespace-nowrap shrink-0',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:rounded-t-sm',
              isActive
                ? 'border-brand text-brand font-semibold'
                : 'border-transparent text-text-muted hover:text-text hover:border-border',
              tab.disabled && 'opacity-40 cursor-not-allowed'
            )}
          >
            <span>{tab.label}</span>
            {typeof tab.count === 'number' && (
              <span
                className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
                  isActive ? 'bg-brand/15 text-brand' : 'bg-surface-2 text-text-muted'
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

export interface TabPanelProps {
  id: string;
  activeTab: string;
  children: React.ReactNode;
  className?: string;
}

export const TabPanel: React.FC<TabPanelProps> = ({ id, activeTab, children, className }) => {
  if (id !== activeTab) return null;

  return (
    <div
      role="tabpanel"
      id={`tabpanel-${id}`}
      aria-labelledby={`tab-${id}`}
      tabIndex={0}
      className={cn('focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-md pt-4', className)}
    >
      {children}
    </div>
  );
};
