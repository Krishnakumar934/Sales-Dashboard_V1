import React, { useMemo, useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeftRight,
  TrendingUp,
  TrendingDown,
  Scale,
  Lightbulb,
  BrainCircuit,
  RefreshCw,
  AlertCircle,
  Award,
  Target,
} from 'lucide-react';
import type { ColumnMeta, DataRow } from '../types/data.ts';
import { formatIndianCount, formatIndianCurrency } from '../utils/aggregator.ts';
import {
  computeHeadToHeadComparison,
  extractDistinctComparisonOptions,
  normalizeEntityKey,
  reconcilePairSelection,
  resolveSalesAndFinanceSources,
  type ComparisonDimension,
} from '../utils/comparison.ts';

interface ComparisonPanelProps {
  isFinanceActive: boolean;
  activeRows: DataRow[];
  activeCols: ColumnMeta[];
  counterpartSalesRows: DataRow[];
  counterpartSalesCols?: ColumnMeta[];
  counterpartFinanceRows: DataRow[];
  counterpartFinanceCols?: ColumnMeta[];
  dateRangeLabel: string;
}

interface AICompareResponse {
  whoLeadsHeadline: string;
  whyDifference: Array<{
    factor: string;
    detail: string;
    evidence: string;
  }>;
  leaderGrowthActions: Array<{
    title: string;
    action: string;
    targetMetric: string;
  }>;
  trailingGrowthActions: Array<{
    title: string;
    action: string;
    targetMetric: string;
  }>;
  combinedOutlook: string;
}

const DIMENSION_TABS: Array<{ id: ComparisonDimension; label: string; shortLabel: string }> = [
  { id: 'gm', label: 'GM Wise Comparison', shortLabel: 'GM Wise' },
  { id: 'asm', label: 'ASM Wise Comparison', shortLabel: 'ASM Wise' },
  { id: 'branch', label: 'Branch Wise Comparison', shortLabel: 'Branch Wise' },
];

export const ComparisonPanel: React.FC<ComparisonPanelProps> = ({
  isFinanceActive,
  activeRows,
  activeCols,
  counterpartSalesRows,
  counterpartSalesCols,
  counterpartFinanceRows,
  counterpartFinanceCols,
  dateRangeLabel,
}) => {
  const [dimension, setDimension] = useState<ComparisonDimension>('gm');
  const [selectedA, setSelectedA] = useState<string>('');
  const [selectedB, setSelectedB] = useState<string>('');

  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<AICompareResponse | null>(null);
  const [aiCacheKey, setAiCacheKey] = useState<string>('');
  const abortRef = useRef<AbortController | null>(null);

  const { salesRows, salesCols, financeRows, financeCols } = useMemo(
    () =>
      resolveSalesAndFinanceSources({
        isFinanceActive,
        activeRows,
        activeCols,
        counterpartSalesRows,
        counterpartSalesCols,
        counterpartFinanceRows,
        counterpartFinanceCols,
      }),
    [
      isFinanceActive,
      activeRows,
      activeCols,
      counterpartSalesRows,
      counterpartSalesCols,
      counterpartFinanceRows,
      counterpartFinanceCols,
    ]
  );

  const activeMode = isFinanceActive ? 'finance' : 'sales';

  // Extract distinct deduplicated options ranked by active tab metric (Loan Amount on Finance, Amount on Sales)
  const options = useMemo(
    () =>
      extractDistinctComparisonOptions({
        dimension,
        mode: activeMode,
        salesRows,
        salesCols,
        financeRows,
        financeCols,
      }),
    [dimension, activeMode, salesRows, salesCols, financeRows, financeCols]
  );

  // Enforce unique selection A vs B whenever dimension or filtered data updates
  const { entityA, entityB } = useMemo(
    () => reconcilePairSelection(options, selectedA, selectedB),
    [options, selectedA, selectedB]
  );

  // Sync reconciled selection back cleanly when defaults or filter changes require adjustment
  useEffect(() => {
    if (entityA !== selectedA) setSelectedA(entityA);
    if (entityB !== selectedB) setSelectedB(entityB);
  }, [entityA, entityB, selectedA, selectedB]);

  const comparison = useMemo(() => {
    if (!entityA || !entityB) return null;
    return computeHeadToHeadComparison({
      dimension,
      mode: activeMode,
      entityAName: entityA,
      entityBName: entityB,
      options,
      salesRows,
      salesCols,
      financeRows,
      financeCols,
    });
  }, [dimension, activeMode, entityA, entityB, options, salesRows, salesCols, financeRows, financeCols]);

  const currentPairKey = `${dimension}|${normalizeEntityKey(entityA)}|${normalizeEntityKey(entityB)}|${dateRangeLabel}|${activeMode}`;

  useEffect(() => {
    setAiError(null);
    if (aiCacheKey && aiCacheKey !== currentPairKey) {
      setAiResult(null);
    }
  }, [currentPairKey, aiCacheKey]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const entityAKey = normalizeEntityKey(entityA);
  const entityBKey = normalizeEntityKey(entityB);

  // Dropdown A strictly excludes Entity B; Dropdown B strictly excludes Entity A
  const optionsForA = useMemo(
    () => options.filter((o) => o.normalizedKey !== entityBKey),
    [options, entityBKey]
  );
  const optionsForB = useMemo(
    () => options.filter((o) => o.normalizedKey !== entityAKey),
    [options, entityAKey]
  );

  const handleSelectA = (val: string) => {
    if (normalizeEntityKey(val) === entityBKey) return;
    setSelectedA(val);
  };

  const handleSelectB = (val: string) => {
    if (normalizeEntityKey(val) === entityAKey) return;
    setSelectedB(val);
  };

  const handleSwap = () => {
    if (!entityA || !entityB) return;
    setSelectedA(entityB);
    setSelectedB(entityA);
  };

  const handleRunAICompare = async () => {
    if (!comparison) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setAiLoading(true);
    setAiError(null);

    try {
      const res = await fetch('/api/ai/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          dimension: comparison.dimension,
          dimLabel: comparison.dimLabel,
          entityA: comparison.entityA,
          entityB: comparison.entityB,
          diagnosis: comparison.diagnosis,
          dateRangeLabel,
          activeReportTab: isFinanceActive ? 'Finance Report' : 'Sales Report',
        }),
      });

      const rawText = await res.text();
      let payload: any = {};
      try {
        payload = rawText ? JSON.parse(rawText) : {};
      } catch {
        payload = {};
      }

      if (!res.ok) {
        throw new Error(payload?.error || `Comparison AI request failed (HTTP ${res.status})`);
      }

      if (payload?.comparisonAI) {
        setAiResult(payload.comparisonAI);
        setAiCacheKey(currentPairKey);
      } else {
        throw new Error('Comparison AI returned an unexpected response.');
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setAiError(err?.message || 'Unable to generate AI comparison strategy.');
      }
    } finally {
      setAiLoading(false);
    }
  };

  const renderMetricBar = (
    label: string,
    valA: number,
    valB: number,
    formattedA: string,
    formattedB: string,
    accentA: string,
    accentB: string
  ) => {
    const total = Math.max(0, valA) + Math.max(0, valB);
    const pctA = total > 0 ? Math.round((Math.max(0, valA) / total) * 100) : 50;
    const pctB = 100 - pctA;

    return (
      <div className="space-y-1.5 py-2.5 border-b border-slate-800/70 last:border-b-0">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-mono tabular-nums font-semibold text-emerald-300 truncate">
            {formattedA}
          </span>
          <span className="text-[11px] font-medium text-slate-400 whitespace-nowrap shrink-0">
            {label}
          </span>
          <span className="font-mono tabular-nums font-semibold text-cyan-300 truncate text-right">
            {formattedB}
          </span>
        </div>
        <div className="h-2 w-full rounded-full bg-slate-950/90 border border-slate-800/80 overflow-hidden flex">
          <div
            className={`h-full ${accentA} transition-all duration-300`}
            style={{ width: `${pctA}%` }}
          />
          <div
            className={`h-full ${accentB} transition-all duration-300`}
            style={{ width: `${pctB}%` }}
          />
        </div>
      </div>
    );
  };

  const isFinanceMode = activeMode === 'finance';
  const maxMonthVal = useMemo(() => {
    if (!comparison) return 1;
    let m = 0;
    for (const pt of comparison.monthlyAligned) {
      const a = isFinanceMode ? pt.financeA : pt.amountA;
      const b = isFinanceMode ? pt.financeB : pt.amountB;
      if (a > m) m = a;
      if (b > m) m = b;
    }
    return m || 1;
  }, [comparison, isFinanceMode]);

  return (
    <section
      id="section-compare"
      aria-label={isFinanceMode ? 'One-vs-One Finance Comparison' : 'One-vs-One Sales Comparison'}
      className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-5 scroll-mt-20"
    >
      {/* Header + 3 Comparison Parameter Tabs */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3.5 pb-4 border-b border-slate-800/80">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 shrink-0">
              <Scale className="w-4 h-4" />
            </div>
            <h2 className="text-base sm:text-lg font-semibold text-white tracking-tight">
              {isFinanceMode ? 'Head-to-Head Finance Comparison' : 'Head-to-Head Sales Comparison'}
            </h2>
          </div>
          <p className="text-xs text-slate-400">
            {isFinanceMode
              ? `Compare 1-vs-1 Finance Data (Loan Amount & Count) across GM, ASM, or Branch · ${dateRangeLabel}`
              : `Compare 1-vs-1 Sales Report across GM, ASM, or Branch · ${dateRangeLabel}`}
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Comparison Parameter"
          className="grid grid-cols-3 gap-1 bg-slate-950/90 border border-slate-800 rounded-xl p-1 shrink-0"
        >
          {DIMENSION_TABS.map((tab) => {
            const active = dimension === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setDimension(tab.id);
                  setSelectedA('');
                  setSelectedB('');
                }}
                className={`relative px-3 py-2 min-h-[40px] rounded-lg text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                  active ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="compare-dim-tab-bg"
                    transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                    className="absolute inset-0 rounded-lg bg-slate-800 border border-slate-700/80 shadow-xs"
                  />
                )}
                <span className="relative z-10 hidden sm:inline">{tab.label}</span>
                <span className="relative z-10 sm:hidden">{tab.shortLabel}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 1-vs-1 Anti-Duplicate Dropdown Controls */}
      {options.length < 2 ? (
        <div className="py-8 text-center text-sm text-slate-400 border border-dashed border-slate-800 rounded-xl">
          {options.length === 1
            ? `Only "${options[0].name}" exists under current filters. Clear a filter or select a broader date range to compare two ${DIMENSION_TABS.find((t) => t.id === dimension)?.shortLabel || 'entities'}.`
            : `No ${DIMENSION_TABS.find((t) => t.id === dimension)?.shortLabel || 'entity'} records found for the active filter selection.`}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-end gap-3 bg-slate-950/60 border border-slate-800/80 rounded-xl p-3 sm:p-4">
            <div className="space-y-1.5 min-w-0">
              <label
                htmlFor="compare-select-a"
                className="flex items-center justify-between text-xs font-medium text-emerald-300"
              >
                <span>Side A ({comparison?.dimLabel || 'Entity'} 1)</span>
                {comparison && (
                  <span className="font-mono text-[11px] text-slate-400">
                    Rank #{comparison.entityA.rankByPrimary} of {comparison.entityA.totalEntities}
                  </span>
                )}
              </label>
              <select
                id="compare-select-a"
                aria-label="Compare Side A"
                value={entityA}
                onChange={(e) => handleSelectA(e.target.value)}
                className="w-full min-h-[44px] bg-slate-900 border border-emerald-500/35 focus:border-emerald-400 focus:outline-none rounded-xl px-3 py-2 text-xs sm:text-sm font-medium text-slate-100 truncate cursor-pointer"
              >
                {optionsForA.map((opt) => (
                  <option key={opt.normalizedKey} value={opt.name}>
                    {opt.name} — {formatIndianCurrency(isFinanceMode ? opt.financeLoanAmount : opt.salesAmount, true)}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-center md:pb-0.5">
              <button
                type="button"
                onClick={handleSwap}
                aria-label="Swap Side A and Side B"
                title="Swap Side A and Side B"
                className="inline-flex items-center justify-center gap-2 min-h-[44px] px-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-slate-200 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
              >
                <ArrowLeftRight className="w-4 h-4 text-emerald-400" />
                <span className="md:hidden">Swap A ↔ B</span>
              </button>
            </div>

            <div className="space-y-1.5 min-w-0">
              <label
                htmlFor="compare-select-b"
                className="flex items-center justify-between text-xs font-medium text-cyan-300"
              >
                <span>Side B ({comparison?.dimLabel || 'Entity'} 2)</span>
                {comparison && (
                  <span className="font-mono text-[11px] text-slate-400">
                    Rank #{comparison.entityB.rankByPrimary} of {comparison.entityB.totalEntities}
                  </span>
                )}
              </label>
              <select
                id="compare-select-b"
                aria-label="Compare Side B"
                value={entityB}
                onChange={(e) => handleSelectB(e.target.value)}
                className="w-full min-h-[44px] bg-slate-900 border border-cyan-500/35 focus:border-cyan-400 focus:outline-none rounded-xl px-3 py-2 text-xs sm:text-sm font-medium text-slate-100 truncate cursor-pointer"
              >
                {optionsForB.map((opt) => (
                  <option key={opt.normalizedKey} value={opt.name}>
                    {opt.name} — {formatIndianCurrency(isFinanceMode ? opt.financeLoanAmount : opt.salesAmount, true)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {comparison && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
              {/* Left Stage: Sales & Finance Head-to-Head Metrics */}
              <div className="lg:col-span-7 flex flex-col justify-start bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 sm:p-5 space-y-4">
                {/* Winner / Leader Summary Line */}
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3.5 border-b border-slate-800/80">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <Award className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <p className="text-xs sm:text-sm font-medium text-slate-100 leading-snug">
                      {comparison.diagnosis.whoLeadsText}
                    </p>
                  </div>
                  {comparison.diagnosis.leaderSide !== 'tie' && (
                    <span className="font-mono tabular-nums text-xs font-semibold text-emerald-300 whitespace-nowrap shrink-0">
                      +{comparison.diagnosis.gapPercent}% Lead
                    </span>
                  )}
                </div>

                {/* Top Entity Scorecards (A vs B) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Side A Summary */}
                  <div className="space-y-2 pb-3 sm:pb-0 sm:pr-4 border-b sm:border-b-0 sm:border-r border-slate-800/80">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-emerald-300 truncate">
                        {comparison.entityA.name}
                      </h3>
                      <span className="text-[11px] font-medium text-slate-300 whitespace-nowrap shrink-0 flex items-center gap-1">
                        {comparison.diagnosis.leaderSide === 'A' ? (
                          <>
                            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                            <span>{isFinanceMode ? 'Higher Loan Vol' : 'Higher Sales'}</span>
                          </>
                        ) : comparison.diagnosis.leaderSide === 'B' ? (
                          <>
                            <TrendingDown className="w-3.5 h-3.5 text-amber-400" />
                            <span>{isFinanceMode ? 'Lower Loan Vol' : 'Lower Sales'}</span>
                          </>
                        ) : (
                          <span>Tied</span>
                        )}
                      </span>
                    </div>
                    <div className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-white">
                      {formatIndianCurrency(
                        isFinanceMode
                          ? comparison.entityA.financeLoanAmount
                          : comparison.entityA.salesAmount,
                        true
                      )}
                    </div>
                    {isFinanceMode ? (
                      <>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-400 font-mono tabular-nums">
                          <span>{formatIndianCount(comparison.entityA.financeLoginCount)} Counts</span>
                          <span aria-hidden="true">·</span>
                          <span>Avg Loan {formatIndianCurrency(comparison.entityA.avgLoanSize, true)}</span>
                          {dimension !== 'branch' && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{comparison.entityA.branchCount} Branches</span>
                            </>
                          )}
                        </div>
                        {comparison.entityA.salesAmount > 0 && (
                          <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                            Sales Ref: {formatIndianCurrency(comparison.entityA.salesAmount, true)}
                            {comparison.entityA.financePenetrationPct !== null
                              ? ` (${comparison.entityA.financePenetrationPct}% Financed)`
                              : ''}
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-400 font-mono tabular-nums">
                          <span>{formatIndianCount(comparison.entityA.salesQty)} Qty</span>
                          <span aria-hidden="true">·</span>
                          <span>Avg {formatIndianCurrency(comparison.entityA.avgTicket, true)}</span>
                          {dimension !== 'branch' && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{comparison.entityA.branchCount} Branches</span>
                            </>
                          )}
                        </div>
                        {comparison.entityA.financeLoanAmount > 0 && (
                          <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                            Finance: {formatIndianCurrency(comparison.entityA.financeLoanAmount, true)} (
                            {formatIndianCount(comparison.entityA.financeLoginCount)} counts)
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Side B Summary */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-cyan-300 truncate">
                        {comparison.entityB.name}
                      </h3>
                      <span className="text-[11px] font-medium text-slate-300 whitespace-nowrap shrink-0 flex items-center gap-1">
                        {comparison.diagnosis.leaderSide === 'B' ? (
                          <>
                            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                            <span>{isFinanceMode ? 'Higher Loan Vol' : 'Higher Sales'}</span>
                          </>
                        ) : comparison.diagnosis.leaderSide === 'A' ? (
                          <>
                            <TrendingDown className="w-3.5 h-3.5 text-amber-400" />
                            <span>{isFinanceMode ? 'Lower Loan Vol' : 'Lower Sales'}</span>
                          </>
                        ) : (
                          <span>Tied</span>
                        )}
                      </span>
                    </div>
                    <div className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-white">
                      {formatIndianCurrency(
                        isFinanceMode
                          ? comparison.entityB.financeLoanAmount
                          : comparison.entityB.salesAmount,
                        true
                      )}
                    </div>
                    {isFinanceMode ? (
                      <>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-400 font-mono tabular-nums">
                          <span>{formatIndianCount(comparison.entityB.financeLoginCount)} Counts</span>
                          <span aria-hidden="true">·</span>
                          <span>Avg Loan {formatIndianCurrency(comparison.entityB.avgLoanSize, true)}</span>
                          {dimension !== 'branch' && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{comparison.entityB.branchCount} Branches</span>
                            </>
                          )}
                        </div>
                        {comparison.entityB.salesAmount > 0 && (
                          <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                            Sales Ref: {formatIndianCurrency(comparison.entityB.salesAmount, true)}
                            {comparison.entityB.financePenetrationPct !== null
                              ? ` (${comparison.entityB.financePenetrationPct}% Financed)`
                              : ''}
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-400 font-mono tabular-nums">
                          <span>{formatIndianCount(comparison.entityB.salesQty)} Qty</span>
                          <span aria-hidden="true">·</span>
                          <span>Avg {formatIndianCurrency(comparison.entityB.avgTicket, true)}</span>
                          {dimension !== 'branch' && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{comparison.entityB.branchCount} Branches</span>
                            </>
                          )}
                        </div>
                        {comparison.entityB.financeLoanAmount > 0 && (
                          <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                            Finance: {formatIndianCurrency(comparison.entityB.financeLoanAmount, true)} (
                            {formatIndianCount(comparison.entityB.financeLoginCount)} counts)
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Proportional Metric Bars */}
                <div className="pt-2 border-t border-slate-800/80">
                  {isFinanceMode ? (
                    <>
                      {renderMetricBar(
                        'Total Loan Amount',
                        comparison.entityA.financeLoanAmount,
                        comparison.entityB.financeLoanAmount,
                        formatIndianCurrency(comparison.entityA.financeLoanAmount, true),
                        formatIndianCurrency(comparison.entityB.financeLoanAmount, true),
                        'bg-emerald-500',
                        'bg-cyan-500'
                      )}
                      {renderMetricBar(
                        'Finance Count (SUM)',
                        comparison.entityA.financeLoginCount,
                        comparison.entityB.financeLoginCount,
                        formatIndianCount(comparison.entityA.financeLoginCount),
                        formatIndianCount(comparison.entityB.financeLoginCount),
                        'bg-emerald-500',
                        'bg-cyan-500'
                      )}
                      {renderMetricBar(
                        'Avg Loan Size',
                        comparison.entityA.avgLoanSize,
                        comparison.entityB.avgLoanSize,
                        formatIndianCurrency(comparison.entityA.avgLoanSize, true),
                        formatIndianCurrency(comparison.entityB.avgLoanSize, true),
                        'bg-emerald-500',
                        'bg-cyan-500'
                      )}
                      {(comparison.entityA.financePenetrationPct !== null ||
                        comparison.entityB.financePenetrationPct !== null) &&
                        renderMetricBar(
                          'Finance Share of Sales',
                          comparison.entityA.financePenetrationPct || 0,
                          comparison.entityB.financePenetrationPct || 0,
                          `${comparison.entityA.financePenetrationPct ?? 0}%`,
                          `${comparison.entityB.financePenetrationPct ?? 0}%`,
                          'bg-emerald-500/80',
                          'bg-cyan-500/80'
                        )}
                    </>
                  ) : (
                    <>
                      {renderMetricBar(
                        'Total Sales Amount',
                        comparison.entityA.salesAmount,
                        comparison.entityB.salesAmount,
                        formatIndianCurrency(comparison.entityA.salesAmount, true),
                        formatIndianCurrency(comparison.entityB.salesAmount, true),
                        'bg-emerald-500',
                        'bg-cyan-500'
                      )}
                      {renderMetricBar(
                        'Units Sold',
                        comparison.entityA.salesQty,
                        comparison.entityB.salesQty,
                        formatIndianCount(comparison.entityA.salesQty),
                        formatIndianCount(comparison.entityB.salesQty),
                        'bg-emerald-500',
                        'bg-cyan-500'
                      )}
                      {renderMetricBar(
                        'Avg Ticket Value',
                        comparison.entityA.avgTicket,
                        comparison.entityB.avgTicket,
                        formatIndianCurrency(comparison.entityA.avgTicket, true),
                        formatIndianCurrency(comparison.entityB.avgTicket, true),
                        'bg-emerald-500',
                        'bg-cyan-500'
                      )}
                      {renderMetricBar(
                        'Discount Rate %',
                        comparison.entityA.discountRatePct,
                        comparison.entityB.discountRatePct,
                        `${comparison.entityA.discountRatePct}%`,
                        `${comparison.entityB.discountRatePct}%`,
                        'bg-emerald-500/80',
                        'bg-cyan-500/80'
                      )}
                      {(comparison.entityA.financeLoanAmount > 0 ||
                        comparison.entityB.financeLoanAmount > 0) &&
                        renderMetricBar(
                          'Finance Loan Volume',
                          comparison.entityA.financeLoanAmount,
                          comparison.entityB.financeLoanAmount,
                          `${formatIndianCurrency(comparison.entityA.financeLoanAmount, true)} (${formatIndianCount(comparison.entityA.financeLoginCount)})`,
                          `${formatIndianCurrency(comparison.entityB.financeLoanAmount, true)} (${formatIndianCount(comparison.entityB.financeLoginCount)})`,
                          'bg-emerald-500',
                          'bg-cyan-500'
                        )}
                    </>
                  )}
                </div>

                {/* Monthly Trajectory Comparison Strip */}
                {comparison.monthlyAligned.length > 0 && (
                  <div className="pt-3 border-t border-slate-800/80 space-y-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-300">
                        {isFinanceMode ? 'Monthly Loan Trajectory' : 'Monthly Sales Trajectory'}
                      </span>
                      <div className="flex items-center gap-3 text-[11px] text-slate-400">
                        <span className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-xs bg-emerald-400 inline-block" />
                          <span className="truncate max-w-[90px]">{comparison.entityA.name}</span>
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-xs bg-cyan-400 inline-block" />
                          <span className="truncate max-w-[90px]">{comparison.entityB.name}</span>
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-flow-col auto-cols-fr gap-2 items-end h-20 pt-2">
                      {comparison.monthlyAligned.slice(-7).map((pt) => {
                        const vA = isFinanceMode ? pt.financeA : pt.amountA;
                        const vB = isFinanceMode ? pt.financeB : pt.amountB;
                        const hA = Math.max(6, Math.round((vA / maxMonthVal) * 100));
                        const hB = Math.max(6, Math.round((vB / maxMonthVal) * 100));
                        return (
                          <div
                            key={pt.monthKey}
                            className="flex flex-col items-center justify-end h-full gap-1 min-w-0"
                            title={`${pt.monthLabel}: ${comparison.entityA.name} ${formatIndianCurrency(vA, true)} vs ${comparison.entityB.name} ${formatIndianCurrency(vB, true)}`}
                          >
                            <div className="flex items-end justify-center gap-1 w-full h-14">
                              <div
                                className="w-2.5 sm:w-3 rounded-t-sm bg-emerald-500/90 transition-all duration-300"
                                style={{ height: `${hA}%` }}
                              />
                              <div
                                className="w-2.5 sm:w-3 rounded-t-sm bg-cyan-500/90 transition-all duration-300"
                                style={{ height: `${hB}%` }}
                              />
                            </div>
                            <span className="text-[10px] font-mono text-slate-400 truncate max-w-full">
                              {pt.monthLabel.split(' ')[0]}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Top Financiers (Finance Tab) & Top Categories Mix Side-by-Side */}
                {isFinanceMode &&
                (comparison.entityA.topFinanciers.length > 0 ||
                  comparison.entityB.topFinanciers.length > 0) ? (
                  <div className="pt-3 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div className="space-y-2">
                      <div className="font-medium text-emerald-300 truncate">
                        {comparison.entityA.name} · Top Financiers
                      </div>
                      <div className="space-y-1.5">
                        {comparison.entityA.topFinanciers.slice(0, 3).map((f) => (
                          <div key={f.name} className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="text-slate-300 truncate">{f.name}</span>
                            <span className="font-mono tabular-nums text-slate-200 whitespace-nowrap shrink-0">
                              {formatIndianCurrency(f.amount, true)} · {formatIndianCount(f.count)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="font-medium text-cyan-300 truncate">
                        {comparison.entityB.name} · Top Financiers
                      </div>
                      <div className="space-y-1.5">
                        {comparison.entityB.topFinanciers.slice(0, 3).map((f) => (
                          <div key={f.name} className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="text-slate-300 truncate">{f.name}</span>
                            <span className="font-mono tabular-nums text-slate-200 whitespace-nowrap shrink-0">
                              {formatIndianCurrency(f.amount, true)} · {formatIndianCount(f.count)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  (comparison.entityA.topCategories.length > 0 ||
                    comparison.entityB.topCategories.length > 0) && (
                    <div className="pt-3 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                      <div className="space-y-2">
                        <div className="font-medium text-emerald-300 truncate">
                          {comparison.entityA.name} · Top Categories
                        </div>
                        <div className="space-y-1.5">
                          {comparison.entityA.topCategories.slice(0, 3).map((c) => (
                            <div key={c.name} className="flex items-center justify-between gap-2 text-[11px]">
                              <span className="text-slate-300 truncate">{c.name}</span>
                              <span className="font-mono tabular-nums text-slate-200 whitespace-nowrap shrink-0">
                                {formatIndianCurrency(c.amount, true)} ({c.sharePct}%)
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="font-medium text-cyan-300 truncate">
                          {comparison.entityB.name} · Top Categories
                        </div>
                        <div className="space-y-1.5">
                          {comparison.entityB.topCategories.slice(0, 3).map((c) => (
                            <div key={c.name} className="flex items-center justify-between gap-2 text-[11px]">
                              <span className="text-slate-300 truncate">{c.name}</span>
                              <span className="font-mono tabular-nums text-slate-200 whitespace-nowrap shrink-0">
                                {formatIndianCurrency(c.amount, true)} ({c.sharePct}%)
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )
                )}
              </div>

              {/* Right Stage: Instant Suggestion + Why Difference + Growth Both Sides + Optional AI Deep Dive */}
              <div className="lg:col-span-5 flex flex-col justify-between bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 sm:p-5 space-y-4">
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-800/80">
                    <div className="flex items-center gap-2">
                      <Lightbulb className="w-4 h-4 text-amber-400 shrink-0" />
                      <h3 className="text-sm font-semibold text-white">
                        Gap Diagnosis & Growth Suggestions
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={handleRunAICompare}
                      disabled={aiLoading}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {aiLoading ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <BrainCircuit className="w-3.5 h-3.5" />
                      )}
                      <span>{aiLoading ? 'Analyzing...' : aiResult ? 'Refresh AI Plan' : 'AI Growth Plan'}</span>
                    </button>
                  </div>

                  {aiError && (
                    <div className="flex items-start gap-2 text-xs text-rose-300 bg-rose-950/30 border border-rose-800/60 rounded-lg p-3">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{aiError}</span>
                    </div>
                  )}

                  <AnimatePresence mode="wait">
                    {aiResult ? (
                      <motion.div
                        key={`ai-compare-${currentPairKey}`}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.12 }}
                        className="space-y-4 text-xs"
                      >
                        <div className="pb-3 border-b border-slate-800/80 space-y-1">
                          <div className="font-semibold text-emerald-300">AI Executive Verdict</div>
                          <p className="text-slate-200 leading-relaxed">{aiResult.whoLeadsHeadline}</p>
                        </div>

                        <div className="space-y-2 pb-3 border-b border-slate-800/80">
                          <div className="font-semibold text-slate-200">
                            {isFinanceMode ? 'Why the Finance Difference' : 'Why the Sales Difference'}
                          </div>
                          <ul className="space-y-2">
                            {aiResult.whyDifference.map((w, idx) => (
                              <li key={idx} className="text-slate-300 leading-relaxed">
                                <span className="font-semibold text-white">{w.factor}:</span> {w.detail}{' '}
                                <span className="font-mono text-slate-400">({w.evidence})</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        <div className="space-y-2 pb-3 border-b border-slate-800/80">
                          <div className="font-semibold text-emerald-300 flex items-center gap-1.5">
                            <Target className="w-3.5 h-3.5" />
                            <span>How to Grow — {comparison.diagnosis.leaderName}</span>
                          </div>
                          <ul className="space-y-2">
                            {aiResult.leaderGrowthActions.map((act, idx) => (
                              <li key={idx} className="text-slate-300 leading-relaxed">
                                <span className="font-semibold text-white">{act.title}:</span> {act.action}{' '}
                                <span className="font-mono text-emerald-400">[{act.targetMetric}]</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        <div className="space-y-2">
                          <div className="font-semibold text-cyan-300 flex items-center gap-1.5">
                            <Target className="w-3.5 h-3.5" />
                            <span>How to Grow — {comparison.diagnosis.trailingName}</span>
                          </div>
                          <ul className="space-y-2">
                            {aiResult.trailingGrowthActions.map((act, idx) => (
                              <li key={idx} className="text-slate-300 leading-relaxed">
                                <span className="font-semibold text-white">{act.title}:</span> {act.action}{' '}
                                <span className="font-mono text-cyan-400">[{act.targetMetric}]</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        {aiResult.combinedOutlook && (
                          <div className="pt-2 border-t border-slate-800/80 text-slate-300 leading-relaxed">
                            <span className="font-semibold text-white">Joint Upside:</span>{' '}
                            {aiResult.combinedOutlook}
                          </div>
                        )}
                      </motion.div>
                    ) : (
                      <motion.div
                        key={`instant-compare-${currentPairKey}`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="space-y-4 text-xs"
                      >
                        {/* Why Difference (Data Grounded) */}
                        <div className="space-y-2 pb-3 border-b border-slate-800/80">
                          <div className="font-semibold text-slate-200">
                            {isFinanceMode ? 'Why the Finance Difference Exists' : 'Why the Sales Difference Exists'}
                          </div>
                          {comparison.diagnosis.whyDifference.length > 0 ? (
                            <ul className="space-y-2 text-slate-300 leading-relaxed">
                              {comparison.diagnosis.whyDifference.map((reason, i) => (
                                <li key={i} className="flex items-start gap-2">
                                  <span className="font-mono text-slate-500 mt-0.5">{i + 1}.</span>
                                  <span>{reason}</span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-slate-400">
                              Both entities show closely balanced volume across active periods and categories.
                            </p>
                          )}
                        </div>

                        {/* Growth Tactics for Leader */}
                        <div className="space-y-2 pb-3 border-b border-slate-800/80">
                          <div className="font-semibold text-emerald-300">
                            How to Grow Higher Side ({comparison.diagnosis.leaderName})
                          </div>
                          <ul className="space-y-1.5 text-slate-300 leading-relaxed">
                            {comparison.diagnosis.growthForLeader.map((step, i) => (
                              <li key={i} className="flex items-start gap-2">
                                <span className="text-emerald-400 font-bold">·</span>
                                <span>{step}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        {/* Growth Tactics for Trailing Side */}
                        <div className="space-y-2">
                          <div className="font-semibold text-cyan-300">
                            How to Grow Lower Side ({comparison.diagnosis.trailingName})
                          </div>
                          <ul className="space-y-1.5 text-slate-300 leading-relaxed">
                            {comparison.diagnosis.growthForTrailing.map((step, i) => (
                              <li key={i} className="flex items-start gap-2">
                                <span className="text-cyan-400 font-bold">·</span>
                                <span>{step}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Top Financier (Finance Tab) / Category (Sales Tab) Overlap Summary Footer */}
                {(() => {
                  const summaryA =
                    isFinanceMode && comparison.entityA.topFinanciers[0]
                      ? comparison.entityA.topFinanciers[0]
                      : comparison.entityA.topCategories[0];
                  const summaryB =
                    isFinanceMode && comparison.entityB.topFinanciers[0]
                      ? comparison.entityB.topFinanciers[0]
                      : comparison.entityB.topCategories[0];
                  if (!summaryA && !summaryB) return null;
                  return (
                    <div className="pt-3 border-t border-slate-800/80 text-[11px] text-slate-400 flex flex-wrap items-center justify-between gap-2">
                      <span className="truncate">
                        Top {isFinanceMode && comparison.entityA.topFinanciers[0] ? 'Lender · ' : ''}
                        {comparison.entityA.name}:{' '}
                        <strong className="text-slate-200">{summaryA?.name || '—'}</strong> (
                        {summaryA?.sharePct || 0}%)
                      </span>
                      <span className="truncate">
                        Top {isFinanceMode && comparison.entityB.topFinanciers[0] ? 'Lender · ' : ''}
                        {comparison.entityB.name}:{' '}
                        <strong className="text-slate-200">{summaryB?.name || '—'}</strong> (
                        {summaryB?.sharePct || 0}%)
                      </span>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
};
