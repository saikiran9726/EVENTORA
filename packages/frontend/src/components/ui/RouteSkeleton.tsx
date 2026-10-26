import React from 'react';

export const RouteSkeleton: React.FC = () => {
  return (
    <div className="w-full max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 animate-pulse space-y-6">
      {/* Top Header Skeleton */}
      <div className="space-y-2">
        <div className="h-8 bg-surface-2 rounded-md w-1/3" />
        <div className="h-4 bg-surface-2 rounded-md w-1/2" />
      </div>

      {/* Hero / Filter Bar Skeleton */}
      <div className="h-12 bg-surface-2 rounded-lg w-full" />

      {/* Grid of Cards Skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 pt-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="border border-border rounded-xl p-4 space-y-4 bg-surface">
            <div className="h-40 bg-surface-2 rounded-lg w-full" />
            <div className="space-y-2">
              <div className="h-5 bg-surface-2 rounded w-3/4" />
              <div className="h-4 bg-surface-2 rounded w-1/2" />
            </div>
            <div className="flex justify-between items-center pt-2">
              <div className="h-4 bg-surface-2 rounded w-1/4" />
              <div className="h-8 bg-surface-2 rounded w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
