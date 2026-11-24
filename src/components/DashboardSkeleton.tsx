import React from 'react';
import { motion } from 'motion/react';
import { RefreshCw } from 'lucide-react';

interface DashboardSkeletonProps {
  isFinance?: boolean;
  isMobileFrame?: boolean;
  targetLabel?: string;
  phaseMessage?: string;
}

const ShimmerBlock: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div
    aria-hidden="true"
    className={`rounded-lg bg-slate-800/80 skeleton-shimmer motion-reduce:animate-none ${className}`}
  />
);

export const DashboardSkeleton: React.FC<DashboardSkeletonProps> = ({
  isFinance = false,
  isMobileFrame = false,
  targetLabel = 'Dashboard',
  phaseMessage,
}) => {
  const accentBorder = isFinance ? 'border-t-cyan-400/60' : 'border-t-emerald-500/60';
  const filterCols = isMobileFrame
    ? 'grid-cols-2'
    : isFinance
    ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6'
    : 'grid-cols-2 lg:grid-cols-4';
  const filterCount = isFinance ? 6 : 4;

  const barHeights = ['64%', '88%', '76%', '94%', '58%', '72%', '84%', '66%'];

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={phaseMessage || `Calculating ${targetLabel} metrics and panels`}
      data-testid="dashboard-skeleton"
      className="space-y-4 sm:space-y-5"
    >
      <span className="sr-only">
        {phaseMessage || `Loading and calculating ${targetLabel} panels...`}
      </span>

      {/* Animated Live Sync Indicator Card */}
      {phaseMessage && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-2xl bg-slate-900/90 border border-emerald-500/35 px-4 py-3 shadow-md"
        >
          <motion.div
            aria-hidden="true"
            initial={{ x: '-100%' }}
            animate={{ x: '200%' }}
            transition={{ repeat: Infinity, duration: 1.4, ease: 'linear' }}
            className="pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-emerald-400/12 to-transparent"
          />
          <div className="relative z-10 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="relative w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-emerald-300 shrink-0">
                <RefreshCw className="w-4 h-4 animate-spin" />
              </div>
              <div className="min-w-0">
                <div className="text-xs sm:text-sm font-semibold text-white truncate">
                  {phaseMessage}
                </div>
                <div className="text-[11px] text-slate-400 truncate">
                  Preparing Sales Report &amp; Finance Data panels...
                </div>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Syncing
            </span>
          </div>
          <div className="relative z-10 mt-2.5 h-1 w-full rounded-full bg-slate-800 overflow-hidden">
            <motion.div
              className="h-full w-1/2 rounded-full bg-gradient-to-r from-emerald-400 via-cyan-400 to-emerald-400"
              initial={{ x: '-100%' }}
              animate={{ x: '220%' }}
              transition={{ repeat: Infinity, duration: 1.2, ease: 'easeInOut' }}
            />
          </div>
        </motion.div>
      )}

      {/* TopBarFilters Skeleton */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3 sm:p-4 shadow-sm space-y-3.5 w-full">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
          <div className="flex items-center gap-2 min-w-0">
            <ShimmerBlock className="h-4 w-14" />
            <div className="flex items-center gap-1.5 bg-slate-950/70 p-1 rounded-xl border border-slate-800/90">
              <ShimmerBlock className="h-7 w-16 rounded-lg" />
              <ShimmerBlock className="h-7 w-12 rounded-lg" />
              <ShimmerBlock className="h-7 w-12 rounded-lg" />
              <ShimmerBlock className="h-7 w-18 rounded-lg" />
              {isFinance && <ShimmerBlock className="h-7 w-14 rounded-lg hidden sm:block" />}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ShimmerBlock className="h-7 w-28 rounded-lg" />
          </div>
        </div>

        <div className={`grid gap-2.5 sm:gap-3 ${filterCols}`}>
          {Array.from({ length: filterCount }).map((_, idx) => (
            <div key={idx} className="space-y-1.5 min-w-0">
              <ShimmerBlock className="h-3.5 w-24" />
              <ShimmerBlock className="h-9 w-full rounded-xl bg-slate-950/70 border border-slate-800/80" />
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-6">
        {/* Section 1: KPI Cards + Monthly Trend Skeleton */}
        <div className="space-y-4">
          <div
            className={`grid gap-2.5 sm:gap-4 ${
              isMobileFrame ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3'
            }`}
          >
            {[0, 1, 2].map((idx) => (
              <div
                key={idx}
                className={`bg-slate-900/80 border border-slate-800 rounded-2xl shadow-xs flex flex-col justify-between ${
                  idx === 0 ? 'col-span-2 sm:col-span-1 p-3.5 sm:p-5' : 'col-span-1 p-3.5 sm:p-5'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <ShimmerBlock className="h-3.5 w-28" />
                    <ShimmerBlock className="w-8 h-8 rounded-xl shrink-0" />
                  </div>
                  <ShimmerBlock className="h-8 w-36 mb-2" />
                  <ShimmerBlock className="h-3.5 w-44 bg-slate-800/50" />
                </div>
              </div>
            ))}
          </div>

          {/* Time-Series Chart Skeleton */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3.5 sm:p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800/80">
              <div className="space-y-2">
                <ShimmerBlock className="h-4 w-48" />
                <ShimmerBlock className="h-3 w-36 bg-slate-800/50" />
              </div>
              <div className="flex items-center gap-2">
                <ShimmerBlock className="h-7 w-24 rounded-lg" />
                <ShimmerBlock className="h-7 w-24 rounded-lg" />
              </div>
            </div>
            <div className="h-[220px] rounded-xl bg-slate-950/60 border border-slate-800/70 p-4 flex flex-col justify-between">
              <div className="border-t border-dashed border-slate-800/70 w-full" />
              <div className="flex items-end justify-between gap-3 h-36 px-2">
                {barHeights.map((h, i) => (
                  <div
                    key={i}
                    style={{ height: h }}
                    className="flex-1 rounded-t-lg bg-slate-800/60 skeleton-shimmer"
                  />
                ))}
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-slate-800/70">
                {['', '', '', '', '', ''].map((_, i) => (
                  <ShimmerBlock key={i} className="h-2.5 w-10 bg-slate-800/60" />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: AI Sales Analyst & Forecast Skeleton */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
            <div className="space-y-2">
              <ShimmerBlock className="h-5 w-64" />
              <ShimmerBlock className="h-3.5 w-80 max-w-full bg-slate-800/50" />
            </div>
            <ShimmerBlock className="h-9 w-44 rounded-xl" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[0, 1, 2].map((idx) => (
              <div
                key={idx}
                className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3.5 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <ShimmerBlock className="h-3.5 w-20" />
                  <ShimmerBlock className="h-3 w-24 bg-slate-800/50" />
                </div>
                <ShimmerBlock className="h-6 w-28" />
                <ShimmerBlock className="h-3 w-40 bg-slate-800/50" />
              </div>
            ))}
          </div>

          <div className="space-y-2 pt-1">
            <ShimmerBlock className="h-3.5 w-full max-w-2xl bg-slate-800/60" />
            <ShimmerBlock className="h-3.5 w-full max-w-xl bg-slate-800/50" />
          </div>
        </div>

        {/* Section 3: Top Stores + Breakdown Share Skeleton */}
        <div className="space-y-6">
          {/* Top Stores Ranking Skeleton */}
          <div
            className={`bg-slate-900/80 border border-slate-800 border-t-2 ${accentBorder} rounded-2xl p-3.5 sm:p-5 space-y-3.5`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3 border-b border-slate-800/80">
              <div className="space-y-2">
                <ShimmerBlock className="h-5 w-56" />
                <ShimmerBlock className="h-3 w-72 max-w-full bg-slate-800/50" />
              </div>
              <ShimmerBlock className="h-8 w-48 rounded-xl" />
            </div>

            <div className="space-y-2">
              {[0, 1, 2, 3, 4].map((idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/90 space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <ShimmerBlock className="w-7 h-7 rounded-lg shrink-0" />
                      <div className="space-y-1.5">
                        <ShimmerBlock className="h-4 w-44" />
                        <ShimmerBlock className="h-3 w-32 bg-slate-800/50" />
                      </div>
                    </div>
                    <div className="space-y-1.5 text-right">
                      <ShimmerBlock className="h-4 w-24 ml-auto" />
                      <ShimmerBlock className="h-3 w-16 ml-auto bg-slate-800/50" />
                    </div>
                  </div>
                  <ShimmerBlock className="h-1.5 w-full rounded-full bg-slate-800/60" />
                </div>
              ))}
            </div>
          </div>

          {/* GM & ASM / Financier Donut Share Skeleton */}
          <div
            className={`grid gap-4 sm:gap-5 ${
              isMobileFrame ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2'
            }`}
          >
            {[0, 1].map((cardIdx) => (
              <div
                key={cardIdx}
                className={`bg-slate-900/80 border border-slate-800 border-t-2 ${accentBorder} rounded-2xl p-4 sm:p-5 space-y-4`}
              >
                <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-800/80">
                  <div className="space-y-2">
                    <ShimmerBlock className="h-4 w-44" />
                    <ShimmerBlock className="h-3 w-56 bg-slate-800/50" />
                  </div>
                  <ShimmerBlock className="h-6 w-20 rounded-lg" />
                </div>
                <div className="flex flex-col sm:flex-row items-center gap-5">
                  <div className="w-40 h-40 rounded-full border-[18px] border-slate-800/80 skeleton-shimmer shrink-0" />
                  <div className="w-full space-y-2.5">
                    {[0, 1, 2, 3].map((rowIdx) => (
                      <div
                        key={rowIdx}
                        className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between"
                      >
                        <ShimmerBlock className="h-3.5 w-28" />
                        <ShimmerBlock className="h-3.5 w-20" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Section 4: Entity Performance Chart Form Skeleton */}
        <div
          className={`bg-slate-900/85 border border-slate-800 border-t-2 ${accentBorder} rounded-2xl p-3.5 sm:p-5 space-y-4`}
        >
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
            <div className="space-y-2">
              <ShimmerBlock className="h-5 w-64" />
              <ShimmerBlock className="h-3 w-52 bg-slate-800/50" />
            </div>
            <ShimmerBlock className="h-9 w-72 max-w-full rounded-xl" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {[0, 1, 2].map((idx) => (
              <div
                key={idx}
                className="bg-slate-950/85 border border-slate-800 rounded-xl p-3 flex items-center gap-3"
              >
                <ShimmerBlock className="w-9 h-9 rounded-xl shrink-0" />
                <div className="space-y-1.5 flex-1">
                  <ShimmerBlock className="h-3 w-24" />
                  <ShimmerBlock className="h-4 w-32" />
                </div>
              </div>
            ))}
          </div>

          <div className="bg-slate-950/75 border border-slate-800/90 rounded-2xl p-4 space-y-3">
            <ShimmerBlock className="h-4 w-56" />
            <div className="grid grid-cols-8 gap-3 items-end h-36 pt-4">
              {barHeights.map((h, i) => (
                <div
                  key={i}
                  style={{ height: h }}
                  className="rounded-t-xl bg-slate-800/70 skeleton-shimmer"
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
