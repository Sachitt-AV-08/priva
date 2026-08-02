import React from "react";

export function SkeletonCard() {
  return (
    <div className="card p-0 overflow-hidden animate-pulse-soft">
      <div className="w-full h-36 bg-surface-3 shimmer" />
      <div className="p-3 space-y-2">
        <div className="h-3 bg-surface-3 rounded w-3/4 shimmer" />
        <div className="h-2 bg-surface-3 rounded w-1/2 shimmer" />
        <div className="h-4 bg-surface-3 rounded w-1/3 shimmer" />
      </div>
    </div>
  );
}

export function SkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-3 gap-3 p-4">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}
