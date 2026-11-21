import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Trophy,
  TrendingUp,
  Users,
  Search,
  Download,
  BarChart3,
  ChevronRight,
  Layers,
  Tag,
} from 'lucide-react';
import type { ColumnMeta, DataRow, AggregationType } from '../types/data.ts';
import {
  formatIndianCurrency,
  formatIndianCount,
  isCurrencyMetric,
  findDedicatedCountCol,
  findQuantityCol,
  findDiscountCol,
  calculateStoreDetails,
  getOrComputeEntityChartFormItems,
  resolveRows,
  type RowHandle,
} from '../utils/aggregator.ts';
import { exportToExcel } from '../utils/excelParser.ts';
import { StoreDetailModal } from './StoreDetailModal.tsx';

interface EntityPerformanceChartFormProps {
  rows: DataRow[] | RowHandle;
  columns: ColumnMeta[];
  dimensionCol: string;
  metricCol: string;
  aggType?: AggregationType;
  selectedCategories: string[];
  onToggleCategory: (category: string) => void;
  onChangeDimension: (colName: string) => void;
  datasetName: string;
  isFinance?: boolean;
  counterpartSalesRows?: DataRow[] | RowHandle;
  counterpartSalesCols?: ColumnMeta[];
  counterpartFinanceRows?: DataRow[] | RowHandle;
  counterpartFinanceCols?: ColumnMeta[];
}

interface ColorTheme {
  start: string;
  end: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
  accentText: string;
  cardHoverBorder: string;
}

const ENTITY_PALETTE: ColorTheme[] = [
  {
    start: '#f59e0b',
    end: '#fb7185',
    badgeBg: 'bg-amber-500/15',
    badgeText: 'text-amber-300',
    badgeBorder: 'border-amber-500/35',
    accentText: 'text-amber-300',
    cardHoverBorder: 'hover:border-amber-500/40',
  },
  {
    start: '#10b981',
    end: '#2dd4bf',
    badgeBg: 'bg-emerald-500/15',
    badgeText: 'text-emerald-300',
    badgeBorder: 'border-emerald-500/35',
    accentText: 'text-emerald-300',
    cardHoverBorder: 'hover:border-emerald-500/40',
  },
  {
    start: '#0ea5e9',
    end: '#6366f1',
    badgeBg: 'bg-sky-500/15',
    badgeText: 'text-sky-300',
    badgeBorder: 'border-sky-500/35',
    accentText: 'text-sky-300',
    cardHoverBorder: 'hover:border-sky-500/40',
  },
  {
    start: '#8b5cf6',
    end: '#ec4899',
    badgeBg: 'bg-violet-500/15',
    badgeText: 'text-violet-300',
    badgeBorder: 'border-violet-500/35',
    accentText: 'text-violet-300',
    cardHoverBorder: 'hover:border-violet-500/40',
  },
  {
    start: '#f43f5e',
    end: '#f97316',
    badgeBg: 'bg-rose-500/15',
    badgeText: 'text-rose-300',
    badgeBorder: 'border-rose-500/35',
    accentText: 'text-rose-300',
    cardHoverBorder: 'hover:border-rose-500/40',
  },
  {
    start: '#14b8a6',
    end: '#22c55e',
    badgeBg: 'bg-teal-500/15',
    badgeText: 'text-teal-300',
    badgeBorder: 'border-teal-500/35',
    accentText: 'text-teal-300',
    cardHoverBorder: 'hover:border-teal-500/40',
  },
  {
    start: '#06b6d4',
    end: '#3b82f6',
    badgeBg: 'bg-cyan-500/15',
    badgeText: 'text-cyan-300',
    badgeBorder: 'border-cyan-500/35',
    accentText: 'text-cyan-300',
    cardHoverBorder: 'hover:border-cyan-500/40',
  },
  {
    start: '#d946ef',
    end: '#8b5cf6',
    badgeBg: 'bg-fuchsia-500/15',
    badgeText: 'text-fuchsia-300',
    badgeBorder: 'border-fuchsia-500/35',
    accentText: 'text-fuchsia-300',
    cardHoverBorder: 'hover:border-fuchsia-500/40',
  },
];

export const EntityPerformanceChartForm: React.FC<EntityPerformanceChartFormProps> = ({
  rows,
  columns,
  dimensionCol,
  metricCol,
  aggType = 'sum',
  selectedCategories,
  onToggleCategory,
  onChangeDimension,
  datasetName,
  isFinance = false,
  counterpartSalesRows,
  counterpartSalesCols,
  counterpartFinanceRows,
  counterpartFinanceCols,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMetric, setViewMetric] = useState<'amount' | 'count'>('amount');
  const [sortBy, setSortBy] = useState<'value-desc' | 'value-asc' | 'count-desc' | 'count-asc' | 'name-asc'>('value-desc');
  const [page, setPage] = useState(1);
  const [hoveredChartIdx, setHoveredChartIdx] = useState<number | null>(null);
  const pageSize = 8;

  const [activeStoreModal, setActiveStoreModal] = useState<string | null>(null);

  React.useEffect(() => {
    const lowerDim = dimensionCol.toLowerCase();
    if (isFinance && (lowerDim.includes('category') || lowerDim.includes('brand'))) {
      setViewMetric('count');
      setSortBy('count-desc');
    } else {
      setViewMetric('amount');
      setSortBy('value-desc');
    }
    setPage(1);
  }, [dimensionCol, isFinance]);

  const isCurrency = isCurrencyMetric(metricCol, aggType);
  const dedicatedCountCol = findDedicatedCountCol(columns);
  const hasDedicatedCount = Boolean(dedicatedCountCol && dedicatedCountCol !== metricCol);
  const qtyCol = findQuantityCol(columns);
  const discCol = findDiscountCol(columns);

  const availableDimensions = useMemo(() => {
    const filtered = columns.filter((c) => {
      if (c.type !== 'category' && c.type !== 'text') return false;
      const l = c.name.toLowerCase();
      return !l.includes('invoice') && l !== 'id' && l !== 'sno' && l !== 's.no';
    });
    const priority = isFinance
      ? ['financier', 'gm', 'asm', 'category', 'brand', 'branch']
      : ['branch', 'gm', 'asm', 'category', 'brand', 'product', 'zone'];
    return [...filtered].sort((a, b) => {
      const ia = priority.findIndex((p) => a.name.toLowerCase().includes(p));
      const ib = priority.findIndex((p) => b.name.toLowerCase().includes(p));
      const ra = ia === -1 ? 99 : ia;
      const rb = ib === -1 ? 99 : ib;
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name);
    });
  }, [columns, isFinance]);

  const resolvedRows = useMemo(() => resolveRows(rows), [rows]);
  const resolvedCpSalesRows = useMemo(() => resolveRows(counterpartSalesRows), [counterpartSalesRows]);
  const resolvedCpFinanceRows = useMemo(() => resolveRows(counterpartFinanceRows), [counterpartFinanceRows]);

  const aggregatedData = useMemo(() => {
    return getOrComputeEntityChartFormItems({
      rows: resolvedRows,
      dimensionCol,
      metricCol,
      dedicatedCountCol: dedicatedCountCol || '',
      qtyCol: qtyCol || '',
      discCol: discCol || '',
    });
  }, [resolvedRows, dimensionCol, metricCol, dedicatedCountCol, qtyCol, discCol]);

  const searchedItems = useMemo(() => {
    if (!searchTerm.trim()) return aggregatedData;
    const q = searchTerm.toLowerCase().trim();
    return aggregatedData.filter((item) => item.name.toLowerCase().includes(q));
  }, [aggregatedData, searchTerm]);

  const sortedItems = useMemo(() => {
    const list = [...searchedItems];
    switch (sortBy) {
      case 'value-desc':
        return list.sort((a, b) => b.value - a.value);
      case 'value-asc':
        return list.sort((a, b) => a.value - b.value);
      case 'count-desc':
        return list.sort((a, b) => b.count - a.count);
      case 'count-asc':
        return list.sort((a, b) => a.count - b.count);
      case 'name-asc':
        return list.sort((a, b) => a.name.localeCompare(b.name));
      default:
        return list;
    }
  }, [searchedItems, sortBy]);

  const totalSum = aggregatedData.reduce((acc, d) => acc + d.value, 0);
  const totalCount = aggregatedData.reduce((acc, d) => acc + d.count, 0);
  const topPerformer = sortedItems.length > 0 ? sortedItems[0] : null;
  const avgPerEntity = aggregatedData.length > 0 ? totalSum / aggregatedData.length : 0;
  const avgCountsPerEntity = aggregatedData.length > 0 ? Math.round(totalCount / aggregatedData.length) : 0;

  const maxValue = sortedItems.length > 0 ? Math.max(...sortedItems.map((d) => d.value), 1) : 1;
  const maxCount = sortedItems.length > 0 ? Math.max(...sortedItems.map((d) => d.count), 1) : 1;

  const chartItems = sortedItems.slice(0, 8);
  const chartMax = chartItems.length > 0
    ? Math.max(...chartItems.map((d) => (viewMetric === 'amount' ? d.value : d.count)), 1)
    : 1;

  const totalPages = Math.ceil(sortedItems.length / pageSize) || 1;
  const currentPage = Math.min(page, totalPages);
  const pagedItems = sortedItems.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const handleExport = () => {
    const exportSample = resolvedRows.length > 50000 ? resolvedRows.slice(0, 50000) : resolvedRows;
    exportToExcel(exportSample, `${datasetName.toLowerCase().replace(/\s+/g, '_')}_data.xlsx`);
  };

  const activeReport = useMemo(() => {
    if (!activeStoreModal) return null;
    return calculateStoreDetails(resolvedRows, activeStoreModal, dimensionCol, columns, {
      dimensionLabel: dimensionCol,
      counterpartSalesRows: resolvedCpSalesRows,
      counterpartSalesCols,
      counterpartFinanceRows: resolvedCpFinanceRows,
      counterpartFinanceCols,
    });
  }, [
    activeStoreModal,
    resolvedRows,
    dimensionCol,
    columns,
    resolvedCpSalesRows,
    counterpartSalesCols,
    resolvedCpFinanceRows,
    counterpartFinanceCols,
  ]);

  const isAmountMode = viewMetric === 'amount';
  const isBrandDim = dimensionCol.toLowerCase().includes('brand');
  const formModeBadge = isBrandDim
    ? {
        label: 'Brand → Financier Logins',
        cls: 'text-violet-300 bg-violet-500/15 border-violet-400/35',
        topAccent: 'border-t-2 border-t-violet-400/80',
        hint: 'Tap any Brand for per-Financier login breakdown & Normal vs Loan split',
      }
    : isFinance
    ? {
        label: 'Finance Loan Mode',
        cls: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/30',
        topAccent: 'border-t-2 border-t-cyan-400/75',
        hint: 'Tap any bar or card for Finance Loan & Normal Sales comparison',
      }
    : {
        label: 'Normal Sales Mode',
        cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
        topAccent: 'border-t-2 border-t-emerald-500/75',
        hint: 'Tap any bar or card for Normal Sales & Finance penetration report',
      };

  return (
    <motion.section
      aria-labelledby="chart-form-heading"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className={`bg-slate-900/85 border border-slate-800 ${formModeBadge.topAccent} rounded-2xl p-3.5 sm:p-5 space-y-4 overflow-hidden w-full`}
    >
      {/* Header with Title and Dimension Switchers */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-500/20 via-emerald-500/15 to-sky-500/20 border border-amber-500/30 flex items-center justify-center text-amber-300 shrink-0">
              <BarChart3 className="w-4 h-4" />
            </div>
            <h2 id="chart-form-heading" className="text-sm sm:text-base font-semibold text-white">
              {dimensionCol} Performance & Count Chart Form
            </h2>
            <span className={`text-[10px] font-mono font-semibold border px-2 py-0.5 rounded-md ${formModeBadge.cls}`}>
              {formModeBadge.label}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400 mt-1">
            <span className="font-mono tabular-nums text-emerald-300">
              {totalCount.toLocaleString('en-IN')} Total {hasDedicatedCount ? 'Volume Counts' : 'Counts'}
            </span>
            <span aria-hidden="true">·</span>
            <span>{formModeBadge.hint}</span>
          </div>
        </div>

        {/* Quick Dimension Switcher Strip */}
        {availableDimensions.length > 1 && (
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5">
            <span className="text-[11px] font-medium text-slate-400 shrink-0">Group by:</span>
            <div className="flex items-center bg-slate-950/80 p-1 rounded-xl border border-slate-800 gap-1 shrink-0 relative">
              {availableDimensions.map((dim) => {
                const isActive = dim.name === dimensionCol;
                return (
                  <motion.button
                    key={dim.name}
                    type="button"
                    whileTap={{ scale: 0.96 }}
                    onClick={() => {
                      onChangeDimension(dim.name);
                      setPage(1);
                    }}
                    className={`relative px-3 py-1.5 rounded-lg text-xs transition-colors whitespace-nowrap cursor-pointer z-10 ${
                      isActive ? 'text-white font-semibold' : 'text-slate-400 hover:text-slate-200 font-medium'
                    }`}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="chartform-dim-pill"
                        transition={{ type: 'spring', stiffness: 480, damping: 36 }}
                        className="absolute inset-0 rounded-lg bg-gradient-to-r from-emerald-500/25 to-sky-500/25 border border-emerald-500/35 -z-10"
                      />
                    )}
                    <span className="relative z-10">{dim.name}</span>
                  </motion.button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Control Bar: Mode Toggle, Search, Sort & Export */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          {/* View Mode Toggle: Amount (₹) vs Counts */}
          <div className="flex items-center bg-slate-950/80 p-0.5 rounded-xl border border-slate-800 text-xs relative">
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => {
                setViewMetric('amount');
                setSortBy('value-desc');
              }}
              className={`relative px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap z-10 ${
                isAmountMode ? 'text-emerald-300 font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {isAmountMode && (
                <motion.span
                  layoutId="chartform-metric-pill"
                  transition={{ type: 'spring', stiffness: 480, damping: 36 }}
                  className="absolute inset-0 rounded-lg bg-emerald-500/20 border border-emerald-500/30 -z-10"
                />
              )}
              <span className="relative z-10">{isFinance ? 'Loan Amount (₹)' : 'Amount (₹)'}</span>
            </motion.button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => {
                setViewMetric('count');
                setSortBy('count-desc');
              }}
              className={`relative px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap z-10 ${
                !isAmountMode ? 'text-sky-300 font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {!isAmountMode && (
                <motion.span
                  layoutId="chartform-metric-pill"
                  transition={{ type: 'spring', stiffness: 480, damping: 36 }}
                  className="absolute inset-0 rounded-lg bg-sky-500/20 border border-sky-500/30 -z-10"
                />
              )}
              <span className="relative z-10">{isFinance ? 'Finance Count' : 'Record Count'}</span>
            </motion.button>
          </div>

          <label htmlFor="chart-form-sort" className="sr-only">
            Sort entities
          </label>
          <select
            id="chart-form-sort"
            value={sortBy}
            onChange={(e) => {
              setSortBy(e.target.value as any);
              setPage(1);
            }}
            className="bg-slate-950/80 border border-slate-800 text-slate-200 rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:border-emerald-500/50 truncate max-w-[180px] cursor-pointer tactile-press"
          >
            <option value="value-desc">Highest {metricCol} {isCurrency ? '(₹)' : ''}</option>
            <option value="value-asc">Lowest {metricCol} {isCurrency ? '(₹)' : ''}</option>
            <option value="count-desc">Highest Count</option>
            <option value="count-asc">Lowest Count</option>
            <option value="name-asc">Name (A-Z)</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-52">
            <label htmlFor="chart-form-search" className="sr-only">
              Search {dimensionCol}
            </label>
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              id="chart-form-search"
              type="text"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
              placeholder={`Search ${dimensionCol}...`}
              className="w-full bg-slate-950/80 border border-slate-800 text-white rounded-xl pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:border-emerald-500/50 placeholder:text-slate-500 transition-colors"
            />
          </div>

          <button
            type="button"
            onClick={handleExport}
            aria-label="Export filtered data to Excel"
            title="Download Filtered Data (Excel .xlsx)"
            className="bg-gradient-to-r from-emerald-500/15 to-sky-500/15 hover:from-emerald-500/25 hover:to-sky-500/25 text-emerald-200 border border-emerald-500/30 rounded-xl tactile-press shrink-0 flex items-center gap-1.5 text-xs px-3 py-1.5 font-medium cursor-pointer whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5 text-emerald-300" />
            <span className="hidden sm:inline">Export Excel</span>
          </button>
        </div>
      </div>

      {/* Colorful Highlights Bento Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <div className="bg-slate-950/90 border border-amber-500/35 border-t-2 border-t-amber-400/80 rounded-xl p-3 flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/35 flex items-center justify-center text-amber-300 shrink-0">
            <Trophy className="w-4 h-4" />
          </div>
          <div className="truncate min-w-0">
            <span className="text-[11px] text-amber-300 font-medium block">Top {dimensionCol}</span>
            <div className="text-xs sm:text-sm font-semibold text-white truncate">
              {topPerformer ? topPerformer.name : '—'}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 truncate font-mono tabular-nums">
              <span className="text-xs text-amber-200 font-semibold">
                {topPerformer
                  ? isCurrency
                    ? formatIndianCurrency(topPerformer.value)
                    : `${topPerformer.value.toLocaleString('en-IN')} units`
                  : '—'}
              </span>
              <span className="text-[11px] text-slate-400 truncate">
                · {topPerformer ? `${topPerformer.count.toLocaleString('en-IN')} counts` : ''}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-slate-950/90 border border-emerald-500/35 border-t-2 border-t-emerald-400/80 rounded-xl p-3 flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/35 flex items-center justify-center text-emerald-300 shrink-0">
            <TrendingUp className="w-4 h-4" />
          </div>
          <div className="truncate min-w-0">
            <span className="text-[11px] text-emerald-300 font-medium block">Average per {dimensionCol}</span>
            <div className="text-xs sm:text-sm font-semibold text-white font-mono tabular-nums">
              {isCurrency ? formatIndianCurrency(avgPerEntity) : `${Math.round(avgPerEntity).toLocaleString('en-IN')} units`}
            </div>
            <span className="text-[11px] text-slate-400 font-mono tabular-nums truncate block">
              ~{avgCountsPerEntity.toLocaleString('en-IN')} counts / entity
            </span>
          </div>
        </div>

        <div className="bg-slate-950/90 border border-sky-500/35 border-t-2 border-t-sky-400/80 rounded-xl p-3 flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-sky-500/20 border border-sky-500/35 flex items-center justify-center text-sky-300 shrink-0">
            <Users className="w-4 h-4" />
          </div>
          <div className="truncate min-w-0">
            <span className="text-[11px] text-sky-300 font-medium block">Total {dimensionCol} Entities</span>
            <div className="text-xs sm:text-sm font-semibold text-white font-mono tabular-nums">
              {aggregatedData.length} active
            </div>
            <span className="text-[11px] text-slate-400 font-mono tabular-nums truncate block">
              {totalCount.toLocaleString('en-IN')} total counts
            </span>
          </div>
        </div>
      </div>

      {/* Colorful Visual Column Chart & Share Spectrum */}
      {chartItems.length > 0 && (
        <div className="bg-slate-950/75 border border-slate-800/90 rounded-2xl p-3.5 sm:p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs">
            <span className="font-semibold text-slate-100">
              Top {chartItems.length} {dimensionCol} Visual Comparison ({isAmountMode ? 'Amount' : 'Counts'})
            </span>
            <span className="text-[11px] text-slate-400 font-mono tabular-nums">
              {hoveredChartIdx !== null && chartItems[hoveredChartIdx]
                ? `${chartItems[hoveredChartIdx].name}: ${
                    isAmountMode
                      ? isCurrency
                        ? formatIndianCurrency(chartItems[hoveredChartIdx].value)
                        : formatIndianCount(chartItems[hoveredChartIdx].value)
                      : `${chartItems[hoveredChartIdx].count.toLocaleString('en-IN')} counts`
                  } (${isAmountMode ? chartItems[hoveredChartIdx].percentage : chartItems[hoveredChartIdx].countPercentage}%)`
                : 'Hover or tap any bar to open full store report'}
            </span>
          </div>

          <div className="overflow-x-auto no-scrollbar pb-1">
            <div className="relative min-w-[540px] sm:min-w-0 pt-2">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-7 bottom-10 flex flex-col justify-between"
              >
                <div className="border-t border-dashed border-slate-800/80" />
                <div className="border-t border-dashed border-slate-800/60" />
                <div className="border-t border-dashed border-slate-800/40" />
              </div>

              <div className="relative grid grid-cols-8 gap-2.5 sm:gap-4 items-end">
                {chartItems.map((item, idx) => {
                  const theme = ENTITY_PALETTE[idx % ENTITY_PALETTE.length];
                  const metricVal = isAmountMode ? item.value : item.count;
                  const pctHeight = Math.max(14, Math.round((metricVal / chartMax) * 100));
                  const isHover = hoveredChartIdx === idx;
                  const shortLabel =
                    item.name.length > 12 ? `${item.name.slice(0, 11)}…` : item.name;
                  const valLabel = isAmountMode
                    ? isCurrency
                      ? formatIndianCurrency(item.value).replace('₹ ', '₹')
                      : formatIndianCount(item.value)
                    : formatIndianCount(item.count);

                  return (
                    <motion.button
                      key={`${dimensionCol}-${item.name}`}
                      type="button"
                      whileTap={{ scale: 0.96 }}
                      onMouseEnter={() => setHoveredChartIdx(idx)}
                      onMouseLeave={() => setHoveredChartIdx(null)}
                      onClick={() => setActiveStoreModal(item.name)}
                      aria-label={`Inspect ${item.name} report`}
                      className="flex flex-col items-center group cursor-pointer focus:outline-none min-w-0"
                    >
                      <span
                        className={`text-[10px] font-mono tabular-nums font-semibold mb-1.5 truncate max-w-full transition-colors ${
                          isHover ? 'text-white' : theme.accentText
                        }`}
                      >
                        {valLabel}
                      </span>

                      <div className="w-full h-32 sm:h-40 flex items-end justify-center px-1 sm:px-2 border-b border-slate-700/80">
                        <motion.div
                          initial={{ scaleY: 0 }}
                          animate={{
                            scaleY: 1,
                            y: isHover ? -3 : 0,
                            opacity: hoveredChartIdx === null || isHover ? 1 : 0.62,
                          }}
                          transition={{
                            scaleY: { duration: 0.4, delay: idx * 0.035, ease: [0.16, 1, 0.3, 1] },
                            y: { duration: 0.16, ease: [0.16, 1, 0.3, 1] },
                            opacity: { duration: 0.16 },
                          }}
                          className="w-full max-w-[44px] rounded-t-xl relative overflow-hidden"
                          style={{
                            height: `${pctHeight}%`,
                            transformOrigin: 'bottom',
                            background: `linear-gradient(180deg, ${theme.start} 0%, ${theme.end} 100%)`,
                          }}
                        >
                          <div className="h-1 w-full bg-white/30" />
                        </motion.div>
                      </div>

                      <span
                        className="mt-2 text-[10px] sm:text-[11px] font-medium text-slate-300 group-hover:text-white truncate max-w-full transition-colors"
                        title={item.name}
                      >
                        {shortLabel}
                      </span>
                      <span className="text-[10px] font-mono tabular-nums text-slate-500">
                        {isAmountMode ? item.percentage : item.countPercentage}%
                      </span>
                    </motion.button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Proportional Share Color Spectrum Bar */}
          <div className="space-y-1 pt-1">
            <div className="h-2.5 w-full rounded-full bg-slate-900 overflow-hidden flex gap-0.5 p-0.5">
              {chartItems.map((item, idx) => {
                const theme = ENTITY_PALETTE[idx % ENTITY_PALETTE.length];
                const share = isAmountMode ? item.percentage : item.countPercentage;
                if (share <= 0) return null;
                return (
                  <motion.div
                    key={`seg-${dimensionCol}-${item.name}`}
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.4, delay: idx * 0.03, ease: [0.16, 1, 0.3, 1] }}
                    title={`${item.name}: ${share}%`}
                    style={{
                      width: `${Math.max(2, share)}%`,
                      transformOrigin: 'left',
                      background: `linear-gradient(90deg, ${theme.start}, ${theme.end})`,
                    }}
                    className="h-full rounded-full"
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Colorful Ranked Entity Performance Cards */}
      <div className="space-y-2.5">
        {pagedItems.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-xs bg-slate-950/60 rounded-xl border border-slate-800">
            No matching {dimensionCol} found for current filters.
          </div>
        ) : (
          pagedItems.map((item, index) => {
            const rank = (currentPage - 1) * pageSize + index + 1;
            const theme = ENTITY_PALETTE[(rank - 1) % ENTITY_PALETTE.length];
            const isSelected = selectedCategories.includes(item.name);
            const amountBarScale = Math.max(0.05, Math.min(1, item.value / maxValue));
            const countBarScale = Math.max(0.05, Math.min(1, item.count / maxCount));
            const activeBarScale = isAmountMode ? amountBarScale : countBarScale;
            const discPct = item.value > 0 && item.discount > 0
              ? ((item.discount / item.value) * 100).toFixed(1)
              : null;

            return (
              <motion.button
                key={`${dimensionCol}-${currentPage}-${item.name}`}
                type="button"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                whileTap={{ scale: 0.99 }}
                transition={{ duration: 0.22, delay: index * 0.025, ease: [0.16, 1, 0.3, 1] }}
                onClick={() => setActiveStoreModal(item.name)}
                aria-label={`View detailed performance report for ${item.name}`}
                className={`w-full text-left p-3.5 sm:p-4 rounded-xl border transition-colors cursor-pointer group ${
                  isSelected
                    ? 'bg-slate-800/80 border-emerald-500/50 ring-1 ring-emerald-500/30'
                    : `bg-slate-950/65 hover:bg-slate-900/90 border-slate-800 ${theme.cardHoverBorder}`
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs mb-2.5 gap-2">
                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                    <span
                      className={`w-7 h-7 rounded-lg text-[11px] font-mono font-bold flex items-center justify-center shrink-0 border ${theme.badgeBg} ${theme.badgeText} ${theme.badgeBorder}`}
                    >
                      #{rank}
                    </span>

                    <div className="min-w-0 flex-1 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h4 className="font-semibold text-white group-hover:text-white transition-colors text-xs sm:text-sm leading-snug break-words">
                          {item.name}
                        </h4>
                        {isSelected && (
                          <span className="inline-block mt-1 text-[10px] text-emerald-300 font-mono">
                            Active Filter
                          </span>
                        )}
                      </div>

                      <div className="sm:hidden text-right shrink-0 font-mono tabular-nums">
                        <span className="font-bold text-white block text-xs">
                          {isAmountMode
                            ? isCurrency
                              ? formatIndianCurrency(item.value)
                              : item.value.toLocaleString('en-IN')
                            : `${item.count.toLocaleString('en-IN')} counts`}
                        </span>
                        <span className={`text-[10px] font-semibold block ${theme.accentText}`}>
                          {isAmountMode
                            ? `${item.count.toLocaleString('en-IN')} counts · ${item.percentage}%`
                            : `${formatIndianCurrency(item.value)} · ${item.countPercentage}%`}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="hidden sm:flex items-center gap-3 shrink-0 text-right font-mono tabular-nums">
                    <div>
                      {isAmountMode ? (
                        <>
                          <span className="font-bold text-white block text-sm">
                            {isCurrency ? formatIndianCurrency(item.value) : item.value.toLocaleString('en-IN')}
                          </span>
                          <span className="text-[11px] text-slate-400 block">
                            {item.count.toLocaleString('en-IN')} counts ·{' '}
                            <strong className={theme.accentText}>{item.percentage}%</strong>
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="font-bold text-white block text-sm">
                            {item.count.toLocaleString('en-IN')} counts
                          </span>
                          <span className="text-[11px] text-slate-400 block">
                            {isCurrency ? formatIndianCurrency(item.value) : `${item.value.toLocaleString('en-IN')} units`} ·{' '}
                            <strong className={theme.accentText}>{item.countPercentage}%</strong>
                          </span>
                        </>
                      )}
                    </div>

                    <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-white group-hover:translate-x-0.5 transition-all duration-150 shrink-0" />
                  </div>
                </div>

                {/* Vibrant Gradient Progress Bar (GPU scaleX) */}
                <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden mb-2.5">
                  <motion.div
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: activeBarScale }}
                    transition={{ duration: 0.34, delay: index * 0.02, ease: [0.16, 1, 0.3, 1] }}
                    className="h-full w-full rounded-full"
                    style={{
                      transformOrigin: 'left',
                      background: `linear-gradient(90deg, ${theme.start} 0%, ${theme.end} 100%)`,
                    }}
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 font-mono tabular-nums pt-0.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="truncate">
                      Avg: <strong className="text-slate-200">{isCurrency ? formatIndianCurrency(item.avgPerCount) : `${item.avgPerCount.toFixed(1)} units`}</strong> / count
                    </span>
                    {item.quantity > 0 && (
                      <span className="inline-flex items-center gap-1 text-slate-300">
                        <Layers className="w-3 h-3 text-sky-400" />
                        Qty: {formatIndianCount(item.quantity)}
                      </span>
                    )}
                    {item.discount > 0 && (
                      <span className="inline-flex items-center gap-1 text-slate-300">
                        <Tag className="w-3 h-3 text-amber-400" />
                        Disc: {formatIndianCurrency(item.discount)}
                        {discPct ? ` (${discPct}%)` : ''}
                      </span>
                    )}
                  </div>

                  <div className={`flex items-center gap-1 text-[11px] font-sans font-semibold ${theme.accentText} group-hover:text-white transition-colors`}>
                    <span>Detailed Report</span>
                    <span aria-hidden="true" className="transition-transform duration-150 group-hover:translate-x-0.5">→</span>
                  </div>
                </div>
              </motion.button>
            );
          })
        )}
      </div>

      {/* Pagination Footer */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-3 border-t border-slate-800/80 text-xs">
          <span className="text-slate-400 text-[11px] font-mono tabular-nums">
            Page {currentPage} of {totalPages} ({sortedItems.length} items)
          </span>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 text-slate-200 text-xs tactile-press border border-slate-700/60 cursor-pointer"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 text-slate-200 text-xs tactile-press border border-slate-700/60 cursor-pointer"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Detailed Store Performance Modal with AnimatePresence */}
      <AnimatePresence>
        {Boolean(activeStoreModal) && (
          <StoreDetailModal
            key="chartform-store-detail-modal"
            isOpen={Boolean(activeStoreModal)}
            onClose={() => setActiveStoreModal(null)}
            report={activeReport}
            onApplyStoreFilter={(storeName) => {
              onToggleCategory(storeName);
            }}
          />
        )}
      </AnimatePresence>
    </motion.section>
  );
};
