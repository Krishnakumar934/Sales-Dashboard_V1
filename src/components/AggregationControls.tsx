import React, { useState } from 'react';
import { Calculator, AlertCircle, IndianRupee, Hash } from 'lucide-react';
import type { AggregationConfig, AggregationType, ColumnMeta } from '../types/data.ts';
import { isCurrencyMetric } from '../utils/aggregator.ts';

interface AggregationControlsProps {
  config: AggregationConfig;
  columns: ColumnMeta[];
  onChangeConfig: (newConfig: AggregationConfig) => void;
}

export const AggregationControls: React.FC<AggregationControlsProps> = ({
  config,
  columns,
  onChangeConfig,
}) => {
  const [showAllColumns, setShowAllColumns] = useState(false);

  const numericColumns = columns.filter((c) => c.type === 'number');
  const dimColumns = columns.filter((c) => c.type === 'category' || c.type === 'text');

  // Sort metric candidates: Amount & financial columns first, then counts/quantities, then other numbers
  const sortedMetricCols = [...numericColumns].sort((a, b) => {
    const aLower = a.name.toLowerCase();
    const bLower = b.name.toLowerCase();

    const aIsAmount = aLower === 'amount' || aLower.includes('amount') || aLower === 'amt';
    const bIsAmount = bLower === 'amount' || bLower.includes('amount') || bLower === 'amt';
    if (aIsAmount && !bIsAmount) return -1;
    if (bIsAmount && !aIsAmount) return 1;

    const financialKeywords = ['disbursement', 'collection', 'revenue', 'sales', 'target', 'turnover', 'spend', 'cost', 'profit'];
    const aIsFinancial = financialKeywords.some((kw) => aLower.includes(kw));
    const bIsFinancial = financialKeywords.some((kw) => bLower.includes(kw));
    if (aIsFinancial && !bIsFinancial) return -1;
    if (bIsFinancial && !aIsFinancial) return 1;

    return 0;
  });

  const availableMetricCols =
    !showAllColumns && sortedMetricCols.length > 0 ? sortedMetricCols : columns;

  const aggTypes: { id: AggregationType; label: string; shortLabel: string }[] = [
    { id: 'sum', label: 'Sum', shortLabel: 'Sum' },
    { id: 'avg', label: 'Average', shortLabel: 'Avg' },
    { id: 'count', label: 'Count', shortLabel: 'Count' },
    { id: 'max', label: 'Max', shortLabel: 'Max' },
    { id: 'min', label: 'Min', shortLabel: 'Min' },
  ];

  // Check if current metric column is not numeric
  const selectedColMeta = columns.find((c) => c.name === config.metricCol);
  const isSelectedColText = selectedColMeta && selectedColMeta.type !== 'number';
  const isCurrentCurrency = isCurrencyMetric(config.metricCol, config.aggType);

  // Top quick metric chips for easy 1-tap switching (up to 4)
  const quickMetrics = sortedMetricCols.slice(0, 4);

  // Top quick dimension chips for easy 1-tap switching (up to 4)
  const quickDimensions = dimColumns.slice(0, 4);

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 sm:p-4.5 shadow-sm overflow-hidden w-full">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 mb-3 border-b border-slate-800/80">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
          <div className="w-5 h-5 rounded-md bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <Calculator className="w-3 h-3" />
          </div>
          <span>Aggregation & Chart Metric Settings</span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full flex items-center gap-1">
            <IndianRupee className="w-2.5 h-2.5" />
            <span>Primarily on Amount (Cr)</span>
          </span>

          <button
            type="button"
            onClick={() => setShowAllColumns(!showAllColumns)}
            className="text-[11px] text-slate-400 hover:text-emerald-400 transition-colors"
          >
            {showAllColumns ? 'Recommended Only' : 'All Columns'}
          </button>
        </div>
      </div>

      {/* Responsive Grid: 1 col on mobile, 3 cols on desktop, each cell min-w-0 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 sm:gap-4">
        {/* Metric Selector (Primarily Amount) */}
        <div className="min-w-0 flex flex-col justify-between space-y-1.5">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-medium text-slate-200 truncate flex items-center gap-1">
                <span>Metric Value (Value to Calculate)</span>
              </label>
              <span className="text-[10px] font-medium text-emerald-400 bg-emerald-950/60 px-1.5 py-0.2 rounded border border-emerald-500/30 shrink-0">
                {isCurrentCurrency ? '₹ Amount in Crores' : '# Count / Number'}
              </span>
            </div>

            <select
              value={config.metricCol}
              onChange={(e) =>
                onChangeConfig({ ...config, metricCol: e.target.value })
              }
              aria-label="Select Metric Value"
              className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg p-2 text-xs focus:outline-none focus:border-emerald-500 truncate"
            >
              {availableMetricCols.map((col) => {
                const isCurr = isCurrencyMetric(col.name);
                return (
                  <option key={col.name} value={col.name}>
                    {isCurr ? '₹ ' : '# '}
                    {col.name} {col.type === 'number' ? '(Numeric)' : `(${col.type})`}
                  </option>
                );
              })}
            </select>

            {isSelectedColText && (
              <div className="mt-1 flex items-center gap-1 text-[10px] text-amber-400">
                <AlertCircle className="w-3 h-3 shrink-0" />
                <span>"{config.metricCol}" is text. Choose a numeric column.</span>
              </div>
            )}
          </div>

          {/* Quick 1-tap metric chips */}
          {quickMetrics.length > 1 && (
            <div className="flex items-center gap-1 pt-1 overflow-x-auto no-scrollbar">
              <span className="text-[10px] text-slate-400 shrink-0">Quick:</span>
              {quickMetrics.map((qm) => {
                const active = config.metricCol === qm.name;
                const isAmt = isCurrencyMetric(qm.name);
                return (
                  <button
                    key={qm.name}
                    type="button"
                    onClick={() => onChangeConfig({ ...config, metricCol: qm.name })}
                    className={`px-2 py-0.5 rounded text-[10px] whitespace-nowrap transition-colors border ${
                      active
                        ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 font-semibold'
                        : 'bg-slate-800/80 border-slate-700/60 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {isAmt ? '₹ ' : '# '}
                    {qm.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Dimension Selector */}
        <div className="min-w-0 flex flex-col justify-between space-y-1.5">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-medium text-slate-200 truncate">
                Breakdown Dimension (Group By)
              </label>
              <span className="text-[10px] text-slate-400 shrink-0">
                e.g. Branch, GM, Zone
              </span>
            </div>

            <select
              value={config.dimCol}
              onChange={(e) =>
                onChangeConfig({ ...config, dimCol: e.target.value })
              }
              aria-label="Select Breakdown Dimension"
              className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg p-2 text-xs focus:outline-none focus:border-emerald-500 truncate"
            >
              {columns.map((col) => (
                <option key={col.name} value={col.name}>
                  {col.name} {col.type === 'category' ? '(Category)' : col.type === 'text' ? '(Text)' : `(${col.type})`}
                </option>
              ))}
            </select>
          </div>

          {/* Quick 1-tap dimension chips */}
          {quickDimensions.length > 1 && (
            <div className="flex items-center gap-1 pt-1 overflow-x-auto no-scrollbar">
              <span className="text-[10px] text-slate-400 shrink-0">Quick:</span>
              {quickDimensions.map((qd) => {
                const active = config.dimCol === qd.name;
                return (
                  <button
                    key={qd.name}
                    type="button"
                    onClick={() => onChangeConfig({ ...config, dimCol: qd.name })}
                    className={`px-2 py-0.5 rounded text-[10px] whitespace-nowrap transition-colors border ${
                      active
                        ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 font-semibold'
                        : 'bg-slate-800/80 border-slate-700/60 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {qd.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Formula Math Function (Grid of 5 equal buttons - NEVER cut off) */}
        <div className="min-w-0 flex flex-col justify-between space-y-1.5">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-medium text-slate-200 truncate">
                Formula (Math Function)
              </label>
              <span className="text-[10px] text-slate-400 font-mono">
                Current: {config.aggType.toUpperCase()}
              </span>
            </div>

            <div className="grid grid-cols-5 gap-1 bg-slate-800/90 p-1 rounded-lg border border-slate-700/80 w-full">
              {aggTypes.map((t) => {
                const active = config.aggType === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onChangeConfig({ ...config, aggType: t.id })}
                    className={`w-full py-1.5 text-[11px] font-semibold rounded text-center transition-all ${
                      active
                        ? 'bg-emerald-400 text-slate-950 shadow-sm font-bold'
                        : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
                    }`}
                  >
                    {t.shortLabel}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="text-[10px] text-slate-400 pt-1 flex items-center justify-between">
            <span>
              {config.aggType === 'sum'
                ? `Calculates total ${config.metricCol} in ₹`
                : config.aggType === 'avg'
                ? `Calculates average ${config.metricCol} per record`
                : config.aggType === 'count'
                ? 'Counts total aggregated records'
                : config.aggType === 'max'
                ? `Finds peak ${config.metricCol}`
                : `Finds lowest ${config.metricCol}`}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
