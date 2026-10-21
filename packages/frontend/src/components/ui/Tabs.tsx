import React from 'react';
import { cn } from '@/lib/utils';

export interface TabItem {
  id: string;
  label: string;
  count?: number;
}

export interface TabsProps {
  tabs: TabItem[];
  activeTab: string;
  onChange: (tabId: string) => void;
  className?: string;
}

export const Tabs: React.FC<TabsProps> = ({ tabs, activeTab, onChange, className }) => {
  return (
    <div
      role="tablist"
      aria-label="Content sections"
      className={cn('flex space-x-1 border-b border-border', className)}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            aria-controls={`tabpanel-${tab.id}`}
            id={`tab-${tab.id}`}
            onClick={() => onChange(tab.id)}
            className={cn(
              'px-3.5 py-2 text-xs md:text-sm font-medium border-b-2 -mb-px transition-colors duration-fast ease-eventora flex items-center gap-1.5',
              isActive
                ? 'border-brand text-brand font-semibold'
                : 'border-transparent text-text-muted hover:text-text hover:border-border'
            )}
          >
            <span>{tab.label}</span>
            {typeof tab.count === 'number' && (
              <span
                className={cn(
                  'text-[10px] px-1.5 py-0.2 rounded-full font-normal',
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
