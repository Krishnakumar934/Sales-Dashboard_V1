import React, { useState } from 'react';
import type { DimensionSlice, AggregationType } from '../types/data.ts';
import { formatIndianCurrency, isCurrencyMetric } from '../utils/aggregator.ts';

interface BarChartProps {
  data: DimensionSlice[];
  dimensionName: string;
  metricName: string;
  aggType?: AggregationType;
  selectedCategories?: string[];
  onToggleCategory?: (category: string) => void;
}

export const BarChart: React.FC<BarChartProps> = ({
  data,
  dimensionName,
  metricName,
  aggType = 'sum',
  selectedCategories = [],
  onToggleCategory,
}) => {
  const isCurrency = isCurrencyMetric(metricName, aggType);
  const [rankBy, setRankBy] = useState<'value' | 'count'>('value');

  if (!data || data.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 text-center text-slate-400 text-xs">
        No dimension breakdown available.
      </div>
    );
  }

  // Sort by either value or count
  const sortedData = [...data].sort((a, b) => {
    return rankBy === 'value' ? b.value - a.value : b.count - a.count;
  });

  const isByValue = rankBy === 'value' && isCurrency;
  const maxVal = Math.max(...sortedData.map((d) => (isByValue ? d.value : d.count)), 1);
  const totalCount = sortedData.reduce((acc, d) => acc + d.count, 0);

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 sm:p-5 overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800/80 mb-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-semibold text-white">
              {dimensionName} Ranking
            </h2>
            <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
              {totalCount.toLocaleString('en-IN')} total counts
            </span>
          </div>
          <span className="text-[11px] text-slate-400">
            {isByValue ? `Ranked by ${metricName} in Crores (Cr)` : 'Ranked by record count'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Toggle rank by Amount vs Count */}
          <div className="flex items-center bg-slate-800 p-0.5 rounded-lg border border-slate-700 text-xs">
            <button
              onClick={() => setRankBy('value')}
              className={`px-2.5 py-1 rounded text-[10px] font-medium transition-colors ${
                rankBy === 'value'
                  ? 'bg-emerald-500/20 text-emerald-300 font-semibold shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Amount (₹)
            </button>
            <button
              onClick={() => setRankBy('count')}
              className={`px-2.5 py-1 rounded text-[10px] font-medium transition-colors ${
                rankBy === 'count'
                  ? 'bg-cyan-500/20 text-cyan-300 font-semibold shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Record Count
            </button>
          </div>

          {onToggleCategory && (
            <span className="text-[10px] text-emerald-400/80 hidden sm:inline">
              Tap to filter
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2.5">
        {sortedData.map((slice, idx) => {
          const isSelected = selectedCategories.includes(slice.category);
          const currentVal = isByValue ? slice.value : slice.count;
          const barWidthPercent = Math.max(4, (currentVal / maxVal) * 100);

          return (
            <div
              key={slice.category}
              onClick={() => onToggleCategory && onToggleCategory(slice.category)}
              className={`p-2.5 rounded-lg transition-colors cursor-pointer group ${
                isSelected
                  ? 'bg-emerald-950/40 border border-emerald-500/40'
                  : 'hover:bg-slate-800/60 border border-transparent'
              }`}
            >
              <div className="flex items-center justify-between text-xs mb-1.5 gap-2">
                <div className="flex items-center gap-2 truncate pr-1 min-w-0">
                  <span
                    className={`w-5 h-5 rounded text-[10px] font-mono flex items-center justify-center font-bold shrink-0 ${
                      idx === 0
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        : idx === 1
                        ? 'bg-slate-400/20 text-slate-200 border border-slate-400/30'
                        : idx === 2
                        ? 'bg-amber-700/20 text-amber-400 border border-amber-700/30'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    #{idx + 1}
                  </span>
                  <span className="font-medium text-slate-200 truncate group-hover:text-emerald-300 text-xs sm:text-sm">
                    {slice.category}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {isByValue ? (
                    <>
                      <span className="text-[10px] text-slate-400 font-mono hidden xs:inline">
                        {slice.count.toLocaleString('en-IN')} counts
                      </span>
                      <span className="text-[11px] text-slate-400 font-mono tabular-nums">
                        {slice.percentage}%
                      </span>
                      <span className="font-bold text-white font-mono tabular-nums text-xs sm:text-sm">
                        {formatIndianCurrency(slice.value)}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-[11px] text-slate-400 font-mono tabular-nums">
                        {slice.percentage}%
                      </span>
                      <span className="font-bold text-cyan-300 font-mono tabular-nums text-xs sm:text-sm">
                        {slice.count.toLocaleString('en-IN')} counts
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    isSelected
                      ? 'bg-emerald-400'
                      : isByValue
                      ? 'bg-emerald-500/80 group-hover:bg-emerald-400'
                      : 'bg-cyan-500/80 group-hover:bg-cyan-400'
                  }`}
                  style={{ width: `${barWidthPercent}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
