import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  ChevronDown,
  Layers,
  Users2,
  UserCheck,
  Store,
  SlidersHorizontal,
  Landmark,
  Tag,
} from 'lucide-react';
import type { ColumnMeta, DataRow, AggregationConfig } from '../types/data.ts';
import {
  findGMCol,
  findASMCol,
  findBranchCol,
  findFinancierCol,
  findBrandCol,
  findCategoryCol,
  isFinanceDataset,
  getOrComputeTopBarFilterOptions,
  resolveRows,
  type RowHandle,
} from '../utils/aggregator.ts';

interface TopBarFiltersProps {
  columns: ColumnMeta[];
  allRows: DataRow[] | RowHandle;
  activeFilters: Record<string, string[]>;
  onFilterChange: (colName: string, selectedValues: string[]) => void;
  onClearAll: () => void;
  config: AggregationConfig;
  onChangeConfig: (newConfig: AggregationConfig) => void;
  isMobileFrame?: boolean;
}

export const TopBarFilters: React.FC<TopBarFiltersProps> = ({
  columns,
  allRows,
  activeFilters,
  onFilterChange,
  onClearAll,
  config,
  onChangeConfig,
  isMobileFrame = false,
}) => {
  const isFinance = useMemo(() => isFinanceDataset(columns), [columns]);
  const financierCol = useMemo(() => findFinancierCol(columns), [columns]);
  const gmCol = useMemo(() => findGMCol(columns) || 'GM', [columns]);
  const asmCol = useMemo(() => findASMCol(columns) || 'ASM', [columns]);
  const branchCol = useMemo(() => findBranchCol(columns) || 'Branch', [columns]);
  const categoryCol = useMemo(
    () =>
      findCategoryCol(columns) ||
      columns.find((c) => {
        const l = c.name.toLowerCase();
        return l.includes('segment') || l.includes('product');
      })?.name ||
      'Category',
    [columns]
  );
  const brandCol = useMemo(() => findBrandCol(columns), [columns]);
  const zoneCol = useMemo(() => {
    return (
      columns.find((c) => c.name.toLowerCase().includes('zone') || c.name.toLowerCase().includes('region'))?.name ||
      'Zone'
    );
  }, [columns]);

  const hasFinancier = Boolean(financierCol && columns.some((c) => c.name === financierCol));
  const hasGM = useMemo(() => columns.some((c) => c.name === gmCol), [columns, gmCol]);
  const hasASM = useMemo(() => columns.some((c) => c.name === asmCol), [columns, asmCol]);
  const hasBranch = useMemo(() => columns.some((c) => c.name === branchCol), [columns, branchCol]);
  const hasCategory = useMemo(() => columns.some((c) => c.name === categoryCol), [columns, categoryCol]);
  const hasBrand = Boolean(brandCol && columns.some((c) => c.name === brandCol));

  const selectedFinancier = financierCol ? activeFilters[financierCol]?.[0] || 'all' : 'all';
  const selectedGM = activeFilters[gmCol]?.[0] || 'all';
  const selectedASM = activeFilters[asmCol]?.[0] || 'all';
  const selectedBranch = activeFilters[branchCol]?.[0] || 'all';
  const selectedCategory = activeFilters[categoryCol]?.[0] || 'all';
  const selectedBrand = brandCol ? activeFilters[brandCol]?.[0] || 'all' : 'all';

  const resolvedAllRows = useMemo(() => resolveRows(allRows), [allRows]);

  const {
    financierOptions,
    gmOptions,
    asmOptions,
    branchOptions,
    categoryOptions,
    brandOptions,
  } = useMemo(() => {
    return getOrComputeTopBarFilterOptions({
      allRows: resolvedAllRows,
      hasFinancier,
      hasGM,
      hasASM,
      hasBranch,
      hasCategory,
      hasBrand,
      financierCol,
      gmCol,
      asmCol,
      branchCol,
      categoryCol,
      brandCol,
      selectedFinancier,
      selectedGM,
      selectedASM,
      selectedBranch,
      selectedCategory,
      selectedBrand,
    });
  }, [
    resolvedAllRows,
    hasFinancier,
    hasGM,
    hasASM,
    hasBranch,
    hasCategory,
    hasBrand,
    financierCol,
    gmCol,
    asmCol,
    branchCol,
    categoryCol,
    brandCol,
    selectedFinancier,
    selectedGM,
    selectedASM,
    selectedBranch,
    selectedCategory,
    selectedBrand,
  ]);

  const activeCount = Object.values(activeFilters).reduce(
    (sum, arr) => sum + (arr ? arr.length : 0),
    0
  );

  const groupByOptions = useMemo(() => {
    const ordered = isFinance
      ? [financierCol, gmCol, asmCol, categoryCol, brandCol, branchCol, zoneCol]
      : [branchCol, gmCol, asmCol, categoryCol, brandCol, zoneCol];
    const valid = ordered.filter((col): col is string => Boolean(col) && columns.some((c) => c.name === col));
    return Array.from(new Set(valid));
  }, [isFinance, columns, financierCol, gmCol, asmCol, categoryCol, brandCol, branchCol, zoneCol]);

  const showSixCols = hasFinancier && hasBrand;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3 sm:p-4 shadow-sm space-y-3.5 w-full"
    >
      {/* Top Bar: Group By Segmented Pill Bar & Metric Status */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5 min-w-0">
          <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider shrink-0 flex items-center gap-1.5">
            <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" />
            <span>Group:</span>
          </span>

          <div className="flex items-center bg-slate-950/70 p-1 rounded-xl border border-slate-800/90 gap-1 shrink-0 relative">
            {groupByOptions.map((opt) => {
              const isSelected = config.dimCol === opt;
              const isCountPrimary = isFinance && (opt === categoryCol || opt === brandCol);
              return (
                <motion.button
                  key={opt}
                  type="button"
                  whileTap={{ scale: 0.96 }}
                  onClick={() => onChangeConfig({ ...config, dimCol: opt })}
                  className={`relative text-xs px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap cursor-pointer z-10 ${
                    isSelected
                      ? 'text-slate-100 font-semibold'
                      : 'text-slate-400 hover:text-slate-200 font-medium'
                  }`}
                >
                  {isSelected && (
                    <motion.span
                      layoutId="topbar-groupby-pill"
                      transition={{ type: 'spring', stiffness: 480, damping: 36 }}
                      className="absolute inset-0 rounded-lg bg-slate-800 border border-slate-700/80 shadow-xs -z-10"
                    />
                  )}
                  <span className="relative z-10">
                    {opt}
                    {isCountPrimary ? ' (Count)' : ''}
                  </span>
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* Metric Indicator & Filter Reset */}
        <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0 pt-0.5 sm:pt-0">
          <span className="text-[11px] font-mono text-slate-300 bg-slate-950/70 border border-slate-800 px-2.5 py-1 rounded-lg">
            Metric: <strong className="text-white font-medium">{config.metricCol || 'Amount'}</strong>
            {isFinance && <span className="text-emerald-400"> · SUM(Count)</span>}
          </span>

          <AnimatePresence>
            {activeCount > 0 && (
              <motion.button
                type="button"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                whileTap={{ scale: 0.96 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                onClick={onClearAll}
                className="flex items-center gap-1 text-[11px] text-rose-400 hover:text-rose-300 bg-rose-950/30 border border-rose-900/60 px-2.5 py-1 rounded-lg transition-colors font-medium shrink-0 cursor-pointer"
              >
                <X className="w-3 h-3" />
                <span>Clear ({activeCount})</span>
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Cascading Filter Selectors */}
      <div
        className={`grid gap-2.5 sm:gap-3 ${
          isMobileFrame
            ? 'grid-cols-2'
            : showSixCols
            ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6'
            : hasFinancier || hasBrand
            ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5'
            : 'grid-cols-2 lg:grid-cols-4'
        }`}
      >
        {/* Financier Filter (Finance Data primary filter) */}
        {hasFinancier && (
          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center justify-between text-[11px] font-medium text-slate-400 px-0.5">
              <span className="flex items-center gap-1.5 truncate">
                <Landmark className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="truncate">Financier</span>
              </span>
              {selectedFinancier !== 'all' && (
                <span className="text-[10px] text-emerald-400 font-mono font-medium shrink-0">1</span>
              )}
            </div>
            <div className="relative">
              <select
                aria-label="Filter by Financier"
                value={selectedFinancier}
                onChange={(e) => {
                  const val = e.target.value;
                  onFilterChange(financierCol, val === 'all' ? [] : [val]);
                }}
                className={`w-full text-xs rounded-xl pl-3 pr-8 py-2 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 truncate cursor-pointer appearance-none tactile-press border ${
                  selectedFinancier !== 'all'
                    ? 'bg-slate-900 text-white font-medium border-slate-700 shadow-xs'
                    : 'bg-slate-950/70 text-slate-300 border-slate-800 hover:border-slate-700'
                }`}
              >
                <option value="all">All Financiers</option>
                {financierOptions.map((fin) => (
                  <option key={fin} value={fin}>
                    {fin}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-2.5 top-2.5 pointer-events-none" />
            </div>
          </div>
        )}

        {/* GM Filter */}
        <div className="space-y-1.5 min-w-0">
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-400 px-0.5">
            <span className="flex items-center gap-1.5 truncate">
              <Users2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="truncate">General Manager</span>
            </span>
            {selectedGM !== 'all' && (
              <span className="text-[10px] text-emerald-400 font-mono font-medium shrink-0">1</span>
            )}
          </div>
          <div className="relative">
            <select
              aria-label="Filter by General Manager"
              value={selectedGM}
              onChange={(e) => {
                const val = e.target.value;
                onFilterChange(gmCol, val === 'all' ? [] : [val]);
              }}
              className={`w-full text-xs rounded-xl pl-3 pr-8 py-2 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 truncate cursor-pointer appearance-none tactile-press border ${
                selectedGM !== 'all'
                  ? 'bg-slate-900 text-white font-medium border-slate-700 shadow-xs'
                  : 'bg-slate-950/70 text-slate-300 border-slate-800 hover:border-slate-700'
              }`}
            >
              <option value="all">All GMs</option>
              {gmOptions.map((gm) => (
                <option key={gm} value={gm}>
                  {gm}
                </option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-2.5 top-2.5 pointer-events-none" />
          </div>
        </div>

        {/* ASM Filter */}
        <div className="space-y-1.5 min-w-0">
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-400 px-0.5">
            <span className="flex items-center gap-1.5 truncate">
              <UserCheck className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="truncate">Area Manager (ASM)</span>
            </span>
            {selectedASM !== 'all' && (
              <span className="text-[10px] text-emerald-400 font-mono font-medium shrink-0">1</span>
            )}
          </div>
          <div className="relative">
            <select
              aria-label="Filter by Area Manager"
              value={selectedASM}
              onChange={(e) => {
                const val = e.target.value;
                onFilterChange(asmCol, val === 'all' ? [] : [val]);
              }}
              className={`w-full text-xs rounded-xl pl-3 pr-8 py-2 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 truncate cursor-pointer appearance-none tactile-press border ${
                selectedASM !== 'all'
                  ? 'bg-slate-900 text-white font-medium border-slate-700 shadow-xs'
                  : 'bg-slate-950/70 text-slate-300 border-slate-800 hover:border-slate-700'
              }`}
            >
              <option value="all">All ASMs</option>
              {asmOptions.map((asm) => (
                <option key={asm} value={asm}>
                  {asm}
                </option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-2.5 top-2.5 pointer-events-none" />
          </div>
        </div>

        {/* Category Filter */}
        <div className="space-y-1.5 min-w-0">
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-400 px-0.5">
            <span className="flex items-center gap-1.5 truncate">
              <Layers className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span className="truncate">Category</span>
            </span>
            {selectedCategory !== 'all' && (
              <span className="text-[10px] text-emerald-400 font-mono font-medium shrink-0">1</span>
            )}
          </div>
          <div className="relative">
            <select
              aria-label="Filter by Category"
              value={selectedCategory}
              onChange={(e) => {
                const val = e.target.value;
                onFilterChange(categoryCol, val === 'all' ? [] : [val]);
              }}
              className={`w-full text-xs rounded-xl pl-3 pr-8 py-2 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 truncate cursor-pointer appearance-none tactile-press border ${
                selectedCategory !== 'all'
                  ? 'bg-slate-900 text-white font-medium border-slate-700 shadow-xs'
                  : 'bg-slate-950/70 text-slate-300 border-slate-800 hover:border-slate-700'
              }`}
            >
              <option value="all">All Categories</option>
              {categoryOptions.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-2.5 top-2.5 pointer-events-none" />
          </div>
        </div>

        {/* Brand Filter (shown when Brand column exists, e.g. Finance Data & Sales Report) */}
        {hasBrand && (
          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center justify-between text-[11px] font-medium text-slate-400 px-0.5">
              <span className="flex items-center gap-1.5 truncate">
                <Tag className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                <span className="truncate">Brand</span>
              </span>
              {selectedBrand !== 'all' && (
                <span className="text-[10px] text-emerald-400 font-mono font-medium shrink-0">1</span>
              )}
            </div>
            <div className="relative">
              <select
                aria-label="Filter by Brand"
                value={selectedBrand}
                onChange={(e) => {
                  const val = e.target.value;
                  onFilterChange(brandCol, val === 'all' ? [] : [val]);
                }}
                className={`w-full text-xs rounded-xl pl-3 pr-8 py-2 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 truncate cursor-pointer appearance-none tactile-press border ${
                  selectedBrand !== 'all'
                    ? 'bg-slate-900 text-white font-medium border-slate-700 shadow-xs'
                    : 'bg-slate-950/70 text-slate-300 border-slate-800 hover:border-slate-700'
                }`}
              >
                <option value="all">All Brands</option>
                {brandOptions.map((brand) => (
                  <option key={brand} value={brand}>
                    {brand}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-2.5 top-2.5 pointer-events-none" />
            </div>
          </div>
        )}

        {/* Branch Filter */}
        <div className="space-y-1.5 min-w-0">
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-400 px-0.5">
            <span className="flex items-center gap-1.5 truncate">
              <Store className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="truncate">Branch / Store</span>
            </span>
            {selectedBranch !== 'all' && (
              <span className="text-[10px] text-emerald-400 font-mono font-medium shrink-0">1</span>
            )}
          </div>
          <div className="relative">
            <select
              aria-label="Filter by Branch"
              value={selectedBranch}
              onChange={(e) => {
                const val = e.target.value;
                onFilterChange(branchCol, val === 'all' ? [] : [val]);
              }}
              className={`w-full text-xs rounded-xl pl-3 pr-8 py-2 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 truncate cursor-pointer appearance-none tactile-press border ${
                selectedBranch !== 'all'
                  ? 'bg-slate-900 text-white font-medium border-slate-700 shadow-xs'
                  : 'bg-slate-950/70 text-slate-300 border-slate-800 hover:border-slate-700'
              }`}
            >
              <option value="all">All Branches</option>
              {branchOptions.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-2.5 top-2.5 pointer-events-none" />
          </div>
        </div>
      </div>
    </motion.div>
  );
};
