import React, { useState } from 'react';
import type { DimensionSlice, AggregationType } from '../types/data.ts';
import { formatIndianCurrency, isCurrencyMetric } from '../utils/aggregator.ts';

interface DonutChartProps {
  data: DimensionSlice[];
  dimensionName: string;
  metricName: string;
  aggType?: AggregationType;
}

const PALETTE = [
  '#10b981', // emerald-500
  '#06b6d4', // cyan-500
  '#3b82f6', // blue-500
  '#8b5cf6', // violet-500
  '#f59e0b', // amber-500
  '#ec4899', // pink-500
  '#14b8a6', // teal-500
  '#64748b', // slate-500
];

export const DonutChart: React.FC<DonutChartProps> = ({
  data,
  dimensionName,
  metricName,
  aggType = 'sum',
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const isCurrency = isCurrencyMetric(metricName, aggType);

  if (!data || data.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 text-center text-slate-400 text-xs">
        No distribution data.
      </div>
    );
  }

  const totalValue = data.reduce((sum, d) => sum + d.value, 0);
  const totalCount = data.reduce((sum, d) => sum + d.count, 0);

  const size = 200;
  const strokeWidth = 28;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  let accumulatedPercent = 0;
  const activeSlice = hoverIdx !== null ? data[hoverIdx] : data[0];

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 sm:p-5 overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800/80 mb-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-semibold text-white">Share of {metricName}</h2>
            <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
              {totalCount.toLocaleString('en-IN')} total counts
            </span>
          </div>
          <span className="text-[11px] text-slate-400">
            {isCurrency
              ? `Proportional split by ${dimensionName} in Indian ₹`
              : `Distribution by ${dimensionName} counts`}
          </span>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-6 justify-center py-2">
        {/* Donut SVG */}
        <div className="relative w-44 h-44 shrink-0 flex items-center justify-center">
          <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full -rotate-90">
            {/* Background track */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="#1e293b"
              strokeWidth={strokeWidth}
            />

            {/* Segments */}
            {data.map((slice, i) => {
              const strokeDasharray = `${(slice.percentage / 100) * circumference} ${circumference}`;
              const strokeDashoffset = -((accumulatedPercent / 100) * circumference);
              accumulatedPercent += slice.percentage;

              const isHovered = hoverIdx === i;
              const color = PALETTE[i % PALETTE.length];

              return (
                <circle
                  key={slice.category}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={color}
                  strokeWidth={isHovered ? strokeWidth + 4 : strokeWidth}
                  strokeDasharray={strokeDasharray}
                  strokeDashoffset={strokeDashoffset}
                  className="transition-all duration-200 cursor-pointer"
                  onMouseEnter={() => setHoverIdx(i)}
                  onMouseLeave={() => setHoverIdx(null)}
                />
              );
            })}
          </svg>

          {/* Center Callout */}
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none p-2">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider truncate max-w-[90px]">
              {hoverIdx !== null ? activeSlice?.category : 'Total'}
            </span>
            <span className="text-sm font-bold text-white font-mono tabular-nums">
              {isCurrency
                ? formatIndianCurrency(hoverIdx !== null ? activeSlice?.value ?? totalValue : totalValue)
                : `${(hoverIdx !== null ? activeSlice?.count ?? totalCount : totalCount).toLocaleString('en-IN')}`}
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              {hoverIdx !== null
                ? `${activeSlice?.count.toLocaleString('en-IN')} counts`
                : `${totalCount.toLocaleString('en-IN')} counts`}
            </span>
            <span className="text-[10px] text-emerald-400 font-mono font-semibold">
              {hoverIdx !== null ? `${activeSlice?.percentage}%` : '100%'}
            </span>
          </div>
        </div>

        {/* Legend */}
        <div className="w-full sm:w-auto flex-1 max-w-xs space-y-1.5 min-w-0">
          {data.slice(0, 6).map((slice, i) => {
            const color = PALETTE[i % PALETTE.length];
            const isHovered = hoverIdx === i;

            return (
              <div
                key={slice.category}
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
                className={`flex items-center justify-between text-xs px-2 py-1.5 rounded transition-colors cursor-pointer gap-2 ${
                  isHovered ? 'bg-slate-800' : 'hover:bg-slate-800/50'
                }`}
              >
                <div className="flex items-center gap-2 truncate pr-1 min-w-0">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-slate-300 truncate font-medium">
                    {slice.category}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isCurrency ? (
                    <>
                      <span className="text-[10px] text-slate-400 font-mono hidden xs:inline">
                        {slice.count.toLocaleString('en-IN')} counts
                      </span>
                      <span className="font-semibold text-white font-mono tabular-nums text-xs">
                        {formatIndianCurrency(slice.value)}
                      </span>
                    </>
                  ) : (
                    <span className="font-semibold text-cyan-300 font-mono tabular-nums text-xs">
                      {Math.round(slice.value || slice.count).toLocaleString('en-IN')} counts
                    </span>
                  )}
                  <span className="text-slate-400 font-mono tabular-nums text-[10px]">
                    ({slice.percentage}%)
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
