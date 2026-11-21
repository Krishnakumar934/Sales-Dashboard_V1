import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Store, Building2, UserCheck, Layers, Tag, ChevronRight } from 'lucide-react';
import type { DimensionSlice } from '../types/data.ts';
import { formatIndianCurrency, formatIndianCount } from '../utils/aggregator.ts';

interface TopStoresRankingProps {
  stores: DimensionSlice[];
  storeColName?: string;
  metricName?: string;
  isFinance?: boolean;
  selectedStores?: string[];
  onToggleStore?: (storeName: string) => void;
  onOpenStoreDetails?: (storeName: string) => void;
}

export const TopStoresRanking: React.FC<TopStoresRankingProps> = ({
  stores,
  storeColName = 'Store',
  metricName = 'Amount',
  isFinance = false,
  selectedStores = [],
  onToggleStore,
  onOpenStoreDetails,
}) => {
  const [rankBy, setRankBy] = useState<'value' | 'count'>('value');

  if (!stores || stores.length === 0) {
    return (
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 text-center text-slate-400 text-xs">
        No store ranking data available.
      </div>
    );
  }

  const sorted = [...stores].sort((a, b) => {
    return rankBy === 'value' ? b.value - a.value : b.count - a.count;
  });

  const maxValue = Math.max(...sorted.map((s) => (rankBy === 'value' ? s.value : s.count)), 1);
  const totalAmount = stores.reduce((acc, s) => acc + s.value, 0);
  const totalCount = stores.reduce((acc, s) => acc + s.count, 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className={`bg-slate-900/80 border border-slate-800 border-t-2 ${
        isFinance ? 'border-t-cyan-400/75' : 'border-t-emerald-500/75'
      } rounded-2xl p-3.5 sm:p-5 overflow-hidden flex flex-col justify-between shadow-xs`}
    >
      <div>
        {/* Header with Title and Mode Toggles */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3 border-b border-slate-800/80 mb-3.5">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm sm:text-base font-semibold text-white flex items-center gap-1.5">
                <Store className={`w-4 h-4 ${isFinance ? 'text-cyan-400' : 'text-emerald-400'}`} />
                <span>Top 10 Stores Performance</span>
              </h2>
              <span
                className={`text-[10px] font-mono font-semibold border px-2 py-0.5 rounded-md ${
                  isFinance
                    ? 'text-cyan-300 bg-cyan-500/10 border-cyan-500/30'
                    : 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30'
                }`}
              >
                {isFinance ? 'Finance + Sales Split' : 'Normal Sales'}
              </span>
              <span className="text-[10px] font-mono text-slate-300 bg-slate-950/70 border border-slate-800 px-2.5 py-0.5 rounded-lg">
                {totalCount.toLocaleString('en-IN')} total counts · {formatIndianCurrency(totalAmount)}
              </span>
            </div>
            <span className="text-[11px] text-slate-400 mt-0.5 block">
              {rankBy === 'value'
                ? isFinance
                  ? `Ranked #1 through #10 by ${metricName} · Tap store for Finance vs Normal Sales split`
                  : `Ranked #1 through #10 by ${metricName} · Tap store for Normal Sales + Finance breakdown`
                : isFinance
                ? 'Ranked #1 through #10 by finance Count (SUM of Count)'
                : 'Ranked #1 through #10 by record volume'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-slate-950/70 p-0.5 rounded-xl border border-slate-800 text-xs relative">
              <motion.button
                type="button"
                whileTap={{ scale: 0.96 }}
                onClick={() => setRankBy('value')}
                className={`relative px-3 py-1 rounded-lg text-[10px] font-medium transition-colors cursor-pointer z-10 ${
                  rankBy === 'value'
                    ? 'text-slate-100 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {rankBy === 'value' && (
                  <motion.span
                    layoutId="topstores-rank-pill"
                    transition={{ type: 'spring', stiffness: 480, damping: 36 }}
                    className="absolute inset-0 rounded-lg bg-slate-800 border border-slate-700/70 shadow-xs -z-10"
                  />
                )}
                <span className="relative z-10">{isFinance ? 'Loan Amount (₹)' : 'Amount (₹)'}</span>
              </motion.button>
              <motion.button
                type="button"
                whileTap={{ scale: 0.96 }}
                onClick={() => setRankBy('count')}
                className={`relative px-3 py-1 rounded-lg text-[10px] font-medium transition-colors cursor-pointer z-10 ${
                  rankBy === 'count'
                    ? 'text-slate-100 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {rankBy === 'count' && (
                  <motion.span
                    layoutId="topstores-rank-pill"
                    transition={{ type: 'spring', stiffness: 480, damping: 36 }}
                    className="absolute inset-0 rounded-lg bg-slate-800 border border-slate-700/70 shadow-xs -z-10"
                  />
                )}
                <span className="relative z-10">{isFinance ? 'Finance Count' : 'Record Count'}</span>
              </motion.button>
            </div>
          </div>
        </div>

        {/* Stores List: Ranked #1 to #10 with full fields */}
        <div className="space-y-2">
          {sorted.slice(0, 10).map((slice, idx) => {
            const rank = idx + 1;
            const isSelected = selectedStores.includes(slice.category);
            const currentVal = rankBy === 'value' ? slice.value : slice.count;
            const barScale = Math.max(0.05, Math.min(1, currentVal / maxValue));

            return (
              <motion.button
                key={slice.category}
                layout="position"
                type="button"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                whileTap={{ scale: 0.99 }}
                transition={{
                  duration: 0.24,
                  delay: idx * 0.025,
                  ease: [0.16, 1, 0.3, 1],
                  layout: { type: 'spring', stiffness: 420, damping: 34 },
                }}
                onClick={() => {
                  if (onOpenStoreDetails) {
                    onOpenStoreDetails(slice.category);
                  } else if (onToggleStore) {
                    onToggleStore(slice.category);
                  }
                }}
                aria-label={`View detailed report for ${slice.category}`}
                className={`w-full text-left p-3 rounded-xl border transition-colors cursor-pointer group ${
                  isSelected
                    ? 'bg-slate-850 border-slate-700 ring-1 ring-slate-650'
                    : 'bg-slate-950/60 hover:bg-slate-900/90 border-slate-800 hover:border-slate-700/90'
                }`}
                title={`Click to view detailed report for ${slice.category}`}
              >
                {/* Top Section: Rank, Store Name, GM/ASM, and Amount */}
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-1.5 sm:gap-3">
                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                    {/* Rank Badge */}
                    <span
                      className={`w-6 h-6 rounded-lg text-[10px] font-mono font-bold flex items-center justify-center shrink-0 border mt-0.5 ${
                        rank === 1
                          ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                          : rank === 2
                          ? 'bg-slate-700/50 text-slate-200 border-slate-600/40'
                          : rank === 3
                          ? 'bg-amber-600/10 text-amber-400/90 border-amber-600/30'
                          : 'bg-slate-900 text-slate-400 border-slate-800'
                      }`}
                    >
                      #{rank}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-slate-100 group-hover:text-white transition-colors text-xs sm:text-sm leading-snug break-words">
                            {slice.category}
                          </div>
                          {isSelected && (
                            <span className="inline-block mt-1 text-[9px] bg-emerald-500/10 text-emerald-300 px-1.5 py-0.5 rounded font-mono border border-emerald-500/20">
                              Active Filter
                            </span>
                          )}
                        </div>

                        {/* Mobile Amount & Share display */}
                        <div className="sm:hidden text-right shrink-0 font-mono">
                          <div className="font-bold text-white text-xs tabular-nums">
                            {rankBy === 'value'
                              ? formatIndianCurrency(slice.value)
                              : `${slice.count.toLocaleString('en-IN')} counts`}
                          </div>
                          <span className="text-[10px] text-slate-400">
                            {slice.percentage}% share
                          </span>
                        </div>
                      </div>

                      {/* Hierarchy: GM & ASM tags with clear wrapping and badges */}
                      {(slice.gm || slice.asm) && (
                        <div className="flex items-center gap-1.5 sm:gap-2 mt-1.5 flex-wrap text-[10px]">
                          {slice.gm && (
                            <span className="inline-flex items-center gap-1 bg-slate-900/90 border border-slate-800 px-2 py-0.5 rounded-md text-slate-300">
                              <Building2 className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                              <span className="text-slate-400">GM:</span>
                              <span className="font-medium text-slate-200">{slice.gm}</span>
                            </span>
                          )}
                          {slice.asm && (
                            <span className="inline-flex items-center gap-1 bg-slate-900/90 border border-slate-800 px-2 py-0.5 rounded-md text-slate-300">
                              <UserCheck className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                              <span className="text-slate-400">ASM:</span>
                              <span className="font-medium text-slate-200">{slice.asm}</span>
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Desktop Primary Metric & Share % */}
                  <div className="hidden sm:flex items-center gap-2.5 shrink-0 font-mono text-right self-center">
                    <div>
                      <span className="font-bold text-white tabular-nums text-sm block">
                        {rankBy === 'value'
                          ? formatIndianCurrency(slice.value)
                          : `${slice.count.toLocaleString('en-IN')} counts`}
                      </span>
                      <span className="text-slate-400 text-[11px] tabular-nums block">
                        {slice.percentage}% share
                      </span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-300 group-hover:translate-x-0.5 transition-all duration-150 shrink-0" />
                  </div>
                </div>

                {/* Relative Visual Progress Bar (GPU scaleX transform) */}
                <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden my-2">
                  <motion.div
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: barScale }}
                    transition={{ duration: 0.36, delay: idx * 0.02, ease: [0.16, 1, 0.3, 1] }}
                    style={{ transformOrigin: 'left' }}
                    className={`h-full w-full rounded-full transition-colors ${
                      rank === 1
                        ? 'bg-emerald-400'
                        : rank === 2
                        ? 'bg-sky-400'
                        : rank === 3
                        ? 'bg-indigo-400'
                        : 'bg-slate-600 group-hover:bg-slate-500'
                    }`}
                  />
                </div>

                {/* Bottom Row: Secondary Fields Strip (Quantity, Discount, Counts) */}
                <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono pt-1 border-t border-slate-800/60 flex-wrap gap-2">
                  <div className="flex items-center gap-2.5 sm:gap-3.5 flex-wrap">
                    {slice.quantity !== undefined && slice.quantity > 0 && (
                      <span className="flex items-center gap-1 text-slate-300 bg-slate-900/60 px-1.5 py-0.5 rounded border border-slate-800/80">
                        <Layers className="w-3 h-3 text-slate-400" />
                        <span>Qty: <strong className="text-slate-200 font-semibold">{formatIndianCount(slice.quantity)}</strong></span>
                      </span>
                    )}

                    {slice.discount !== undefined && slice.discount > 0 && (
                      <span className="flex items-center gap-1 text-slate-300 bg-slate-900/60 px-1.5 py-0.5 rounded border border-slate-800/80">
                        <Tag className="w-3 h-3 text-slate-400" />
                        <span>Disc: <strong className="text-slate-200 font-semibold">{formatIndianCurrency(slice.discount)}</strong></span>
                      </span>
                    )}
                  </div>

                  <div className="text-slate-400 flex items-center gap-1.5">
                    <span>
                      {slice.count.toLocaleString('en-IN')} {isFinance ? 'counts' : 'rows'}
                    </span>
                    <span className="text-slate-500">·</span>
                    <span className="text-slate-300 group-hover:text-white transition-colors">Tap for report →</span>
                  </div>
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>

      <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
        <span>Click any store to open full detailed report</span>
        <span className="font-mono text-slate-400">Top 10 Stores</span>
      </div>
    </motion.div>
  );
};
