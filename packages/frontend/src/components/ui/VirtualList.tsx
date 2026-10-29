import React, { useState, useRef, useMemo, useCallback } from 'react';

export interface VirtualListProps<T> {
  items: T[];
  itemHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  containerHeight?: number;
  overscan?: number;
  className?: string;
  keyExtractor?: (item: T, index: number) => string;
  emptyMessage?: string;
}

export function VirtualList<T>({
  items,
  itemHeight,
  renderItem,
  containerHeight = 480,
  overscan = 4,
  className = '',
  keyExtractor,
  emptyMessage = 'No items found',
}: VirtualListProps<T>): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  // If list is small (<= 50 items), skip virtual DOM recycling overhead
  const shouldVirtualize = items.length > 50;

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    setScrollTop(containerRef.current.scrollTop);
  }, []);

  const totalHeight = items.length * itemHeight;

  const { startIndex, endIndex } = useMemo(() => {
    if (!shouldVirtualize) {
      return { startIndex: 0, endIndex: items.length };
    }
    const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const visibleCount = Math.ceil(containerHeight / itemHeight) + 2 * overscan;
    const end = Math.min(items.length, start + visibleCount);
    return { startIndex: start, endIndex: end };
  }, [scrollTop, itemHeight, containerHeight, overscan, items.length, shouldVirtualize]);

  if (items.length === 0) {
    return (
      <div className={`p-8 text-center text-text-muted text-sm ${className}`}>
        {emptyMessage}
      </div>
    );
  }

  if (!shouldVirtualize) {
    return (
      <div
        role="list"
        aria-label="Virtualized list"
        aria-rowcount={items.length}
        className={`divide-y divide-border ${className}`}
      >
        {items.map((item, idx) => (
          <div
            key={keyExtractor ? keyExtractor(item, idx) : idx}
            role="listitem"
            aria-rowindex={idx + 1}
          >
            {renderItem(item, idx)}
          </div>
        ))}
      </div>
    );
  }

  const visibleItems = items.slice(startIndex, endIndex);
  const offsetY = startIndex * itemHeight;

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      role="feed"
      aria-label="Virtualized list"
      aria-rowcount={items.length}
      tabIndex={0}
      style={{
        height: containerHeight,
        overflowY: 'auto',
        position: 'relative',
      }}
      className={`relative divide-y divide-border focus:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-md ${className}`}
    >
      <div
        style={{
          height: totalHeight,
          width: '100%',
          position: 'relative',
        }}
      >
        <div
          style={{
            transform: `translateY(${offsetY}px)`,
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
          }}
        >
          {visibleItems.map((item, i) => {
            const actualIndex = startIndex + i;
            return (
              <div
                key={keyExtractor ? keyExtractor(item, actualIndex) : actualIndex}
                role="article"
                aria-rowindex={actualIndex + 1}
                style={{ height: itemHeight }}
                className="overflow-hidden"
              >
                {renderItem(item, actualIndex)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
