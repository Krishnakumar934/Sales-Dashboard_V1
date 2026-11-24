import type {
  AggregationConfig,
  ColumnMeta,
  DataRow,
  DateRangeFilter,
  DimensionSlice,
  KPIMetric,
  TimeSeriesPoint,
} from '../types/data.ts';
import {
  aggregateShareByDimension,
  aggregateTopStores,
  cleanNumber,
  findASMCol,
  findBranchCol,
  findBrandCol,
  findCategoryCol,
  findDiscountCol,
  findExplicitCountCol,
  findFinancierCol,
  findGMCol,
  findQuantityCol,
  formatIndianCount,
  formatIndianCurrency,
  formatMonthLabel,
  isCurrencyMetric,
  isFinanceDataset,
} from './aggregator.ts';

export interface ForecastPoint {
  period: string;
  label: string;
  projectedValue: number;
  formattedValue: string;
  lowerBound: number;
  upperBound: number;
  momGrowthPercent: number;
}

export interface EntityPerformanceSummary {
  name: string;
  value: number;
  formattedValue: string;
  sharePercent: number;
  count: number;
  quantity: number;
  discount: number;
  discountRatePercent: number;
  avgTicketFormatted: string;
  gm?: string;
  asm?: string;
}

export interface HighDiscountEntity {
  name: string;
  formattedValue: string;
  formattedDiscount: string;
  discountRatePercent: number;
}

export interface SalesAnalyticsSnapshot {
  datasetName: string;
  dateRangeLabel: string;
  activeFiltersSummary: string;
  metricCol: string;
  dimCol: string;
  isCurrency: boolean;
  totalRows: number;
  totalValue: number;
  formattedTotalValue: string;
  totalQuantity: number;
  formattedTotalQuantity: string;
  totalDiscount: number;
  formattedTotalDiscount: string;
  discountRatePercent: number;
  avgTicketFormatted: string;
  monthlySeries: {
    period: string;
    label: string;
    value: number;
    formattedValue: string;
    count: number;
  }[];
  momGrowthPercent: number | null;
  overallTrendPercent: number;
  trendDirection: 'up' | 'down' | 'flat';
  peakMonth: { label: string; formattedValue: string; value: number } | null;
  lowestMonth: { label: string; formattedValue: string; value: number } | null;
  forecasts: ForecastPoint[];
  topEntities: EntityPerformanceSummary[];
  bottomEntities: EntityPerformanceSummary[];
  allEntities?: EntityPerformanceSummary[];
  branchEntities?: EntityPerformanceSummary[];
  highDiscountEntities: HighDiscountEntity[];
  conversionSignals: string[];
  gmShares: { name: string; formattedValue: string; percentage: number; count: number }[];
  asmShares: { name: string; formattedValue: string; percentage: number; count: number }[];
  categoryShares: { name: string; formattedValue: string; percentage: number; count: number }[];
  brandShares?: { name: string; formattedValue: string; percentage: number; count: number }[];
  financierShares?: { name: string; formattedValue: string; percentage: number; count: number }[];
}

/**
 * Adds N calendar months to a 'YYYY-MM' key cleanly across year boundaries.
 */
export function addMonths(yyyyMm: string, offset: number): string {
  const parts = yyyyMm.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  if (isNaN(year) || isNaN(month)) return yyyyMm;

  const totalMonths = year * 12 + (month - 1) + offset;
  const nextYear = Math.floor(totalMonths / 12);
  const nextMonth = (totalMonths % 12) + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
}

/**
 * Computes a deterministic, non-negative linear regression + damped momentum forecast
 * for the next `horizon` months from historical monthly time-series points.
 */
export function computeLinearForecast(
  series: TimeSeriesPoint[],
  horizon = 3,
  isCurrency = true
): {
  forecasts: ForecastPoint[];
  momGrowthPercent: number | null;
  overallTrendPercent: number;
  trendDirection: 'up' | 'down' | 'flat';
} {
  if (!series || series.length === 0) {
    return {
      forecasts: [],
      momGrowthPercent: null,
      overallTrendPercent: 0,
      trendDirection: 'flat',
    };
  }

  // Filter out empty trailing/leading zero placeholders only if there are active months
  const activePoints = series.filter((p) => p.count > 0 || p.value > 0);
  const effectiveSeries = activePoints.length >= 2 ? activePoints : series;
  const lastPeriod = series[series.length - 1].period;
  const n = effectiveSeries.length;

  // Latest Month-over-Month delta
  let momGrowthPercent: number | null = null;
  if (n >= 2) {
    const prev = effectiveSeries[n - 2].value;
    const curr = effectiveSeries[n - 1].value;
    if (prev > 0) {
      momGrowthPercent = Number((((curr - prev) / prev) * 100).toFixed(1));
    } else if (curr > 0) {
      momGrowthPercent = 100;
    } else {
      momGrowthPercent = 0;
    }
  }

  if (n === 1) {
    const baseVal = Math.max(0, effectiveSeries[0].value);
    const forecasts: ForecastPoint[] = [];
    for (let step = 1; step <= horizon; step++) {
      const nextPeriod = addMonths(lastPeriod, step);
      forecasts.push({
        period: nextPeriod,
        label: formatMonthLabel(nextPeriod),
        projectedValue: Number(baseVal.toFixed(2)),
        formattedValue: isCurrency ? formatIndianCurrency(baseVal) : formatIndianCount(baseVal),
        lowerBound: Number((baseVal * 0.92).toFixed(2)),
        upperBound: Number((baseVal * 1.08).toFixed(2)),
        momGrowthPercent: 0,
      });
    }
    return {
      forecasts,
      momGrowthPercent: null,
      overallTrendPercent: 0,
      trendDirection: 'flat',
    };
  }

  // Ordinary Least Squares linear regression: y = intercept + slope * x
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (let i = 0; i < n; i++) {
    const x = i;
    const y = effectiveSeries[i].value;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }

  const denominator = n * sumXX - sumX * sumX;
  const slope = denominator !== 0 ? (n * sumXY - sumX * sumY) / denominator : 0;
  const intercept = (sumY - slope * sumX) / n;

  const meanY = sumY / n;
  const overallTrendPercent =
    meanY > 0 ? Number(((slope / meanY) * 100).toFixed(1)) : 0;

  const trendDirection: 'up' | 'down' | 'flat' =
    overallTrendPercent > 1 ? 'up' : overallTrendPercent < -1 ? 'down' : 'flat';

  // Residual standard error for realistic confidence band
  let sqErr = 0;
  for (let i = 0; i < n; i++) {
    const fitted = intercept + slope * i;
    sqErr += Math.pow(effectiveSeries[i].value - fitted, 2);
  }
  const stdErr = n > 2 ? Math.sqrt(sqErr / (n - 2)) : meanY * 0.08;
  const bandHalf = Math.max(stdErr, meanY * 0.05);

  const lastActual = effectiveSeries[n - 1].value;
  let prevProjected = lastActual;
  const forecasts: ForecastPoint[] = [];

  for (let step = 1; step <= horizon; step++) {
    const xFuture = n - 1 + step;
    const regressionVal = intercept + slope * xFuture;
    // Blend 65% regression trajectory with 35% anchored momentum from last actual to avoid wild spikes
    const anchoredVal = lastActual + slope * step * 0.85;
    const rawProjected = 0.65 * regressionVal + 0.35 * anchoredVal;
    const projectedValue = Math.max(0, Number(rawProjected.toFixed(2)));
    const stepGrowth =
      prevProjected > 0
        ? Number((((projectedValue - prevProjected) / prevProjected) * 100).toFixed(1))
        : 0;
    prevProjected = projectedValue;

    const nextPeriod = addMonths(lastPeriod, step);
    const uncertaintyMultiplier = 1 + (step - 1) * 0.22;
    const lowerBound = Math.max(0, Number((projectedValue - bandHalf * uncertaintyMultiplier).toFixed(2)));
    const upperBound = Math.max(
      projectedValue,
      Number((projectedValue + bandHalf * uncertaintyMultiplier).toFixed(2))
    );

    forecasts.push({
      period: nextPeriod,
      label: formatMonthLabel(nextPeriod),
      projectedValue,
      formattedValue: isCurrency
        ? formatIndianCurrency(projectedValue)
        : formatIndianCount(projectedValue),
      lowerBound,
      upperBound,
      momGrowthPercent: stepGrowth,
    });
  }

  return {
    forecasts,
    momGrowthPercent,
    overallTrendPercent,
    trendDirection,
  };
}

/**
 * Builds a complete, grounded analytics snapshot from the current filtered rows and dashboard state
 * to power both statistical forecasts and Gemini AI reasoning.
 */
export function buildSalesAnalyticsSnapshot(params: {
  datasetName: string;
  dateRangeLabel: string;
  dateRange: DateRangeFilter;
  categoryFilters: Record<string, string[]>;
  searchQuery: string;
  filteredRows: DataRow[];
  columns: ColumnMeta[];
  aggConfig: AggregationConfig;
  kpiMetrics: KPIMetric[];
  timeSeriesData: TimeSeriesPoint[];
  gmShares: DimensionSlice[];
  asmShares: DimensionSlice[];
}): SalesAnalyticsSnapshot {
  const {
    datasetName,
    dateRangeLabel,
    categoryFilters,
    searchQuery,
    filteredRows,
    columns,
    aggConfig,
    kpiMetrics,
    timeSeriesData,
    gmShares,
    asmShares,
  } = params;

  const isCurrency = isCurrencyMetric(aggConfig.metricCol, aggConfig.aggType);
  const isFinance = isFinanceDataset(columns);
  const explicitCountCol = findExplicitCountCol(columns);
  const qtyCol = findQuantityCol(columns);
  const discCol = findDiscountCol(columns);
  const catCol = findCategoryCol(columns);
  const brandCol = findBrandCol(columns);
  const financierCol = findFinancierCol(columns);
  const branchCol = findBranchCol(columns) || aggConfig.dimCol;
  const gmCol = findGMCol(columns);
  const asmCol = findASMCol(columns);

  const amountKpi = kpiMetrics.find((k) => k.id === 'kpi-amount') || kpiMetrics[0];
  const qtyKpi = kpiMetrics.find((k) => k.id === 'kpi-quantity') || kpiMetrics[1];
  const discKpi = kpiMetrics.find((k) => k.id === 'kpi-discount') || kpiMetrics[2];

  const totalValue = amountKpi ? amountKpi.value : 0;
  const totalQuantity = qtyKpi ? qtyKpi.value : 0;
  const totalDiscount = !isFinance && discKpi ? discKpi.value : 0;
  const discountRatePercent =
    !isFinance && totalValue > 0 ? Number(((totalDiscount / totalValue) * 100).toFixed(2)) : 0;

  // Format active filters summary
  const activeFilterParts: string[] = [];
  for (const [col, vals] of Object.entries(categoryFilters || {})) {
    if (vals && vals.length > 0) {
      activeFilterParts.push(`${col}: ${vals.join(', ')}`);
    }
  }
  if (searchQuery.trim()) {
    activeFilterParts.push(`Search: "${searchQuery.trim()}"`);
  }
  const activeFiltersSummary =
    activeFilterParts.length > 0 ? activeFilterParts.join(' | ') : 'All data (no dimension filter active)';

  // Compute forecasts
  const { forecasts, momGrowthPercent, overallTrendPercent, trendDirection } =
    computeLinearForecast(timeSeriesData, 3, isCurrency);

  // Peak and lowest active months
  const activeMonths = timeSeriesData.filter((pt) => pt.count > 0 || pt.value > 0);
  let peakMonth: { label: string; formattedValue: string; value: number } | null = null;
  let lowestMonth: { label: string; formattedValue: string; value: number } | null = null;

  if (activeMonths.length > 0) {
    const sortedByVal = [...activeMonths].sort((a, b) => b.value - a.value);
    const p = sortedByVal[0];
    const l = sortedByVal[sortedByVal.length - 1];
    peakMonth = {
      label: p.label,
      value: p.value,
      formattedValue: isCurrency ? formatIndianCurrency(p.value) : formatIndianCount(p.value),
    };
    lowestMonth = {
      label: l.label,
      value: l.value,
      formattedValue: isCurrency ? formatIndianCurrency(l.value) : formatIndianCount(l.value),
    };
  }

  // Aggregate all entities in active dimension (or branch)
  const targetEntityCol = aggConfig.dimCol || financierCol || branchCol;
  const allEntities = aggregateTopStores(
    filteredRows,
    targetEntityCol,
    aggConfig.metricCol,
    500,
    columns
  );

  const entityTotal = allEntities.reduce((sum, e) => sum + Math.max(0, e.value), 0);

  const mapEntity = (s: DimensionSlice): EntityPerformanceSummary => {
    const disc = s.discount ?? 0;
    const discRate = s.value > 0 ? Number(((disc / s.value) * 100).toFixed(2)) : 0;
    const denom = Math.max(1, s.count || s.quantity || 1);
    const ticketVal = s.value / denom;
    return {
      name: s.category,
      value: s.value,
      formattedValue: isCurrency ? formatIndianCurrency(s.value) : formatIndianCount(s.value),
      sharePercent: entityTotal > 0 ? Number(((s.value / entityTotal) * 100).toFixed(1)) : s.percentage,
      count: s.count,
      quantity: s.quantity ?? 0,
      discount: disc,
      discountRatePercent: discRate,
      avgTicketFormatted: isCurrency ? formatIndianCurrency(ticketVal) : formatIndianCount(ticketVal),
      gm: s.gm,
      asm: s.asm,
    };
  };

  const mappedAllEntities = allEntities.map(mapEntity);
  const topEntities = mappedAllEntities.slice(0, 8);
  const bottomEntities =
    mappedAllEntities.length > 8
      ? mappedAllEntities.slice(-5).reverse()
      : mappedAllEntities.slice().reverse().slice(0, 5);

  // Always retain full branch/store breakdown even when grouped by GM/ASM/Category/Financier
  const branchEntities: EntityPerformanceSummary[] =
    branchCol && branchCol !== targetEntityCol
      ? aggregateTopStores(filteredRows, branchCol, aggConfig.metricCol, 500, columns).map((s) => {
          const disc = s.discount ?? 0;
          const discRate = s.value > 0 ? Number(((disc / s.value) * 100).toFixed(2)) : 0;
          const denom = Math.max(1, s.count || s.quantity || 1);
          const ticketVal = s.value / denom;
          return {
            name: s.category,
            value: s.value,
            formattedValue: isCurrency ? formatIndianCurrency(s.value) : formatIndianCount(s.value),
            sharePercent: totalValue > 0 ? Number(((s.value / totalValue) * 100).toFixed(1)) : s.percentage,
            count: s.count,
            quantity: s.quantity ?? 0,
            discount: disc,
            discountRatePercent: discRate,
            avgTicketFormatted: isCurrency ? formatIndianCurrency(ticketVal) : formatIndianCount(ticketVal),
            gm: s.gm,
            asm: s.asm,
          };
        })
      : mappedAllEntities;

  // High-discount leakage entities (discount rate above portfolio average, sorted by discount spend)
  const highDiscountEntities: HighDiscountEntity[] = mappedAllEntities
    .filter((e) => e.discount > 0 && e.value > 0 && e.discountRatePercent >= Math.max(0.5, discountRatePercent))
    .sort((a, b) => b.discount - a.discount)
    .slice(0, 5)
    .map((e) => ({
      name: e.name,
      formattedValue: e.formattedValue,
      formattedDiscount: formatIndianCurrency(e.discount),
      discountRatePercent: e.discountRatePercent,
    }));

  // Category, Brand & Financier shares (reuses WeakMap caches where available)
  const catSlices = catCol
    ? aggregateShareByDimension(
        filteredRows,
        catCol,
        aggConfig.metricCol,
        15,
        explicitCountCol,
        isFinance ? 'count' : 'value'
      )
    : [];
  const brandSlices = brandCol
    ? aggregateShareByDimension(
        filteredRows,
        brandCol,
        aggConfig.metricCol,
        15,
        explicitCountCol,
        isFinance ? 'count' : 'value'
      )
    : [];
  const financierSlices = financierCol
    ? aggregateShareByDimension(
        filteredRows,
        financierCol,
        aggConfig.metricCol,
        15,
        explicitCountCol,
        'value'
      )
    : [];

  // Fallback quantity & discount checks if KPIs weren't present
  let resolvedQty = totalQuantity;
  let resolvedDisc = totalDiscount;
  if (!qtyKpi && explicitCountCol) {
    resolvedQty = filteredRows.reduce((acc, r) => acc + cleanNumber(r[explicitCountCol]), 0);
  } else if (!qtyKpi && qtyCol) {
    resolvedQty = filteredRows.reduce((acc, r) => acc + cleanNumber(r[qtyCol]), 0);
  }
  if (!isFinance && !discKpi && discCol) {
    resolvedDisc = filteredRows.reduce((acc, r) => acc + cleanNumber(r[discCol]), 0);
  }

  const totalDenom = Math.max(1, isFinance && resolvedQty > 0 ? resolvedQty : filteredRows.length);
  const avgTicketVal = totalValue / totalDenom;
  const avgTicketFormatted = isCurrency
    ? formatIndianCurrency(avgTicketVal)
    : formatIndianCount(avgTicketVal);

  // Deterministic conversion & growth signals grounded in current rows
  const conversionSignals: string[] = [];
  if (topEntities.length >= 3) {
    const top3Share = topEntities
      .slice(0, 3)
      .reduce((acc, e) => acc + e.sharePercent, 0)
      .toFixed(1);
    conversionSignals.push(
      `Top 3 ${targetEntityCol || 'Entities'} (${topEntities
        .slice(0, 3)
        .map((e) => e.name)
        .join(', ')}) generate ${top3Share}% of ${aggConfig.metricCol || 'sales'}.`
    );
  }
  if (highDiscountEntities.length > 0) {
    conversionSignals.push(
      `Discount concentration: ${highDiscountEntities[0].name} carries a ${highDiscountEntities[0].discountRatePercent}% discount rate (${highDiscountEntities[0].formattedDiscount}) vs ${discountRatePercent}% portfolio average.`
    );
  }
  if (peakMonth && lowestMonth && peakMonth.label !== lowestMonth.label && lowestMonth.value > 0) {
    const spreadPct = (((peakMonth.value - lowestMonth.value) / lowestMonth.value) * 100).toFixed(0);
    conversionSignals.push(
      `Seasonal swing of +${spreadPct}% between trough (${lowestMonth.label}: ${lowestMonth.formattedValue}) and peak (${peakMonth.label}: ${peakMonth.formattedValue}).`
    );
  }
  if (forecasts.length > 0 && bottomEntities.length > 0) {
    const lag = bottomEntities[0];
    conversionSignals.push(
      `Conversion upside: Lifting bottom ${targetEntityCol || 'entity'} ${lag.name} (${lag.formattedValue}, avg ticket ${lag.avgTicketFormatted}) toward portfolio average increases Q+1 run-rate.`
    );
  }

  return {
    datasetName,
    dateRangeLabel,
    activeFiltersSummary,
    metricCol: aggConfig.metricCol || 'Amount',
    dimCol: targetEntityCol || 'Branch',
    isCurrency,
    totalRows: filteredRows.length,
    totalValue: Number(totalValue.toFixed(2)),
    formattedTotalValue: amountKpi
      ? amountKpi.formattedValue
      : isCurrency
      ? formatIndianCurrency(totalValue)
      : formatIndianCount(totalValue),
    totalQuantity: Math.round(resolvedQty),
    formattedTotalQuantity: formatIndianCount(resolvedQty),
    totalDiscount: Number(resolvedDisc.toFixed(2)),
    formattedTotalDiscount: formatIndianCurrency(resolvedDisc),
    discountRatePercent,
    avgTicketFormatted,
    monthlySeries: timeSeriesData.map((pt) => ({
      period: pt.period,
      label: pt.label,
      value: pt.value,
      formattedValue: isCurrency ? formatIndianCurrency(pt.value) : formatIndianCount(pt.value),
      count: pt.count,
    })),
    momGrowthPercent,
    overallTrendPercent,
    trendDirection,
    peakMonth,
    lowestMonth,
    forecasts,
    topEntities,
    bottomEntities,
    allEntities: mappedAllEntities,
    branchEntities,
    highDiscountEntities,
    conversionSignals,
    gmShares: (gmCol ? gmShares : []).slice(0, 15).map((s) => ({
      name: s.category,
      formattedValue: isCurrency ? formatIndianCurrency(s.value) : formatIndianCount(s.value),
      percentage: s.percentage,
      count: s.count,
    })),
    asmShares: (asmCol ? asmShares : []).slice(0, 20).map((s) => ({
      name: s.category,
      formattedValue: isCurrency ? formatIndianCurrency(s.value) : formatIndianCount(s.value),
      percentage: s.percentage,
      count: s.count,
    })),
    categoryShares: catSlices.map((s) => ({
      name: s.category,
      formattedValue: isCurrency ? formatIndianCurrency(s.value) : formatIndianCount(s.value),
      percentage: s.percentage,
      count: s.count,
    })),
    brandShares: brandSlices.map((s) => ({
      name: s.category,
      formattedValue: isCurrency ? formatIndianCurrency(s.value) : formatIndianCount(s.value),
      percentage: s.percentage,
      count: s.count,
    })),
    financierShares: financierSlices.map((s) => ({
      name: s.category,
      formattedValue: isCurrency ? formatIndianCurrency(s.value) : formatIndianCount(s.value),
      percentage: s.percentage,
      count: s.count,
    })),
  };
}

export interface PromptMatchedEntity {
  matchedType: string;
  rank?: number;
  totalInDimension?: number;
  name: string;
  formattedValue: string;
  sharePercent: number;
  count: number;
  quantity?: number;
  discountRatePercent?: number;
  avgTicketFormatted?: string;
  gm?: string;
  asm?: string;
}

const PROMPT_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'about', 'from', 'into', 'this', 'that', 'these', 'those',
  'what', 'which', 'when', 'where', 'who', 'whom', 'how', 'why', 'are', 'is', 'was', 'were',
  'will', 'would', 'can', 'could', 'should', 'have', 'has', 'had', 'does', 'did', 'not',
  'store', 'stores', 'branch', 'branches', 'shop', 'shops', 'show', 'give', 'tell', 'list',
  'find', 'check', 'compare', 'versus', 'vs', 'all', 'our', 'my', 'your', 'me', 'us',
  'sales', 'sale', 'finance', 'loan', 'amount', 'count', 'qty', 'quantity', 'discount',
  'report', 'data', 'month', 'months', 'monthly', 'quarter', 'next', 'last', 'current',
  'analyze', 'analysis', 'forecast', 'predict', 'prediction', 'predictions', 'performance',
  'summary', 'details', 'detail', 'insight', 'insights', 'conversion', 'plan', 'status',
  'good', 'bad', 'best', 'top', 'bottom', 'high', 'low', 'much', 'many', 'total', 'only',
]);

function normalizeAlphaNum(str: string): string {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function tokenizeAlphaNum(str: string): string[] {
  return (str || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

function scoreEntityMatch(entityName: string, queryTokens: string[], fullQueryNorm: string): number {
  const nameLower = (entityName || '').toLowerCase();
  const nameNorm = normalizeAlphaNum(entityName);
  const nameTokens = tokenizeAlphaNum(entityName);
  if (!nameNorm || nameTokens.length === 0) return 0;

  // 1. Direct full query match (excluding overly generic single words handled by queryTokens)
  if (fullQueryNorm.length >= 3 && nameNorm === fullQueryNorm) return 100;

  let bestScore = 0;
  for (const tok of queryTokens) {
    const tokNorm = normalizeAlphaNum(tok);
    if (tokNorm.length < 2) continue;

    // Code prefix match: e.g. "vpm" matches "Vpm-01 (Nehruji Road, Vilupuram)" first token "vpm"
    if (nameTokens[0] === tokNorm || nameLower.startsWith(`${tokNorm}-`) || nameLower.startsWith(`${tokNorm} `)) {
      bestScore = Math.max(bestScore, 96);
      continue;
    }

    // Exact word token inside entity name (e.g. "vilupuram", "nehruji", "bajaj")
    if (nameTokens.includes(tokNorm)) {
      bestScore = Math.max(bestScore, 88);
      continue;
    }

    // Compact code match (e.g. "vpm01" matches "vpm01nehrujiroadvilupuram")
    if (tokNorm.length >= 3 && nameNorm.startsWith(tokNorm)) {
      bestScore = Math.max(bestScore, 84);
      continue;
    }

    // Substring match for tokens >= 3 chars (or 2+ char prefix on first token)
    if (tokNorm.length >= 3 && (nameLower.includes(tokNorm) || nameNorm.includes(tokNorm))) {
      bestScore = Math.max(bestScore, 72);
      continue;
    }

    if (tokNorm.length >= 2 && nameTokens[0].startsWith(tokNorm)) {
      bestScore = Math.max(bestScore, 65);
    }
  }

  return bestScore;
}

/**
 * Resolves store codes, abbreviations, branch names, cities, GM/ASM names, brands, categories,
 * and financiers mentioned in a user's prompt against ALL entities in the snapshot.
 * E.g. "VPM" matches "Vpm-01 (Nehruji Road, Vilupuram)".
 */
export function matchPromptEntities(
  question: string | undefined,
  snapshot: SalesAnalyticsSnapshot,
  limit = 12
): PromptMatchedEntity[] {
  const q = (question || '').trim();
  if (!q) return [];

  const rawTokens = tokenizeAlphaNum(q);
  const queryTokens = Array.from(
    new Set(
      rawTokens.filter((t) => t.length >= 2 && !PROMPT_STOP_WORDS.has(t))
    )
  );
  // Also preserve compound alphanumeric tokens like "vpm01" when user typed "vpm-01"
  for (let i = 0; i < rawTokens.length - 1; i++) {
    if (!PROMPT_STOP_WORDS.has(rawTokens[i]) && /^\d+$/.test(rawTokens[i + 1])) {
      queryTokens.push(`${rawTokens[i]}${rawTokens[i + 1]}`);
    }
  }

  if (queryTokens.length === 0) return [];
  const fullQueryNorm = normalizeAlphaNum(q);

  const candidates: Array<{ score: number; item: PromptMatchedEntity }> = [];
  const seenKeys = new Set<string>();

  const pushEntityList = (list: EntityPerformanceSummary[] | undefined, typeLabel: string) => {
    if (!Array.isArray(list)) return;
    const total = list.length;
    for (let i = 0; i < total; i++) {
      const e = list[i];
      const score = scoreEntityMatch(e.name, queryTokens, fullQueryNorm);
      if (score <= 0) continue;
      const key = `${typeLabel}:${e.name.toLowerCase()}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      candidates.push({
        score,
        item: {
          matchedType: typeLabel,
          rank: i + 1,
          totalInDimension: total,
          name: e.name,
          formattedValue: e.formattedValue,
          sharePercent: e.sharePercent,
          count: e.count,
          quantity: e.quantity,
          discountRatePercent: e.discountRatePercent,
          avgTicketFormatted: e.avgTicketFormatted,
          gm: e.gm,
          asm: e.asm,
        },
      });
    }
  };

  const pushShareList = (
    list: { name: string; formattedValue: string; percentage: number; count: number }[] | undefined,
    typeLabel: string
  ) => {
    if (!Array.isArray(list)) return;
    const total = list.length;
    for (let i = 0; i < total; i++) {
      const s = list[i];
      const score = scoreEntityMatch(s.name, queryTokens, fullQueryNorm);
      if (score <= 0) continue;
      const key = `${typeLabel}:${s.name.toLowerCase()}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      candidates.push({
        score,
        item: {
          matchedType: typeLabel,
          rank: i + 1,
          totalInDimension: total,
          name: s.name,
          formattedValue: s.formattedValue,
          sharePercent: s.percentage,
          count: s.count,
        },
      });
    }
  };

  pushEntityList(
    snapshot.branchEntities && snapshot.branchEntities.length > 0
      ? snapshot.branchEntities
      : [...(snapshot.topEntities || []), ...(snapshot.bottomEntities || [])],
    'Branch / Store'
  );
  if (snapshot.allEntities && snapshot.allEntities !== snapshot.branchEntities) {
    pushEntityList(snapshot.allEntities, snapshot.dimCol || 'Entity');
  }
  pushShareList(snapshot.gmShares, 'GM');
  pushShareList(snapshot.asmShares, 'ASM');
  pushShareList(snapshot.categoryShares, 'Category');
  pushShareList(snapshot.brandShares, 'Brand');
  pushShareList(snapshot.financierShares, 'Financier');

  candidates.sort((a, b) => b.score - a.score || (a.item.rank ?? 999) - (b.item.rank ?? 999));
  return candidates.slice(0, limit).map((c) => c.item);
}

/**
 * Produces a token-lean, high-signal summary object for fast Gemini inference
 * including prompt-matched entities and complete store/entity directories so abbreviations
 * (like "VPM" -> "Vpm-01 (Nehruji Road, Vilupuram)") are always resolved accurately.
 */
export function buildCompactSnapshotForAI(
  snapshot: SalesAnalyticsSnapshot,
  question?: string
) {
  const promptMatchedEntities = matchPromptEntities(question, snapshot, 12);
  const fullBranchList =
    snapshot.branchEntities && snapshot.branchEntities.length > 0
      ? snapshot.branchEntities
      : snapshot.allEntities && snapshot.allEntities.length > 0
      ? snapshot.allEntities
      : [...(snapshot.topEntities || []), ...(snapshot.bottomEntities || [])];

  return {
    dataset: snapshot.datasetName,
    period: snapshot.dateRangeLabel,
    filters: snapshot.activeFiltersSummary,
    metric: snapshot.metricCol,
    dimension: snapshot.dimCol,
    rows: snapshot.totalRows,
    promptMatchedEntities,
    totals: {
      sales: snapshot.formattedTotalValue,
      qty: snapshot.formattedTotalQuantity,
      discount: snapshot.formattedTotalDiscount,
      discountRatePct: snapshot.discountRatePercent,
      avgTicket: snapshot.avgTicketFormatted,
    },
    momentum: {
      latestMoMPct: snapshot.momGrowthPercent,
      slopePctPerMo: snapshot.overallTrendPercent,
      direction: snapshot.trendDirection,
      peak: snapshot.peakMonth ? `${snapshot.peakMonth.label} (${snapshot.peakMonth.formattedValue})` : null,
      low: snapshot.lowestMonth ? `${snapshot.lowestMonth.label} (${snapshot.lowestMonth.formattedValue})` : null,
    },
    monthlyRecent: (snapshot.monthlySeries || []).slice(-8).map((m) => ({
      m: m.label,
      val: m.formattedValue,
      cnt: m.count,
    })),
    forecasts3Mo: (snapshot.forecasts || []).map((f) => ({
      m: f.label,
      pred: f.formattedValue,
      momPct: f.momGrowthPercent,
    })),
    topEntities: (snapshot.topEntities || []).slice(0, 8).map((e) => ({
      name: e.name,
      val: e.formattedValue,
      sharePct: e.sharePercent,
      discPct: e.discountRatePercent,
      avgTicket: e.avgTicketFormatted,
      gm: e.gm,
      asm: e.asm,
    })),
    laggingEntities: (snapshot.bottomEntities || []).slice(0, 5).map((e) => ({
      name: e.name,
      val: e.formattedValue,
      sharePct: e.sharePercent,
      discPct: e.discountRatePercent,
      avgTicket: e.avgTicketFormatted,
      gm: e.gm,
      asm: e.asm,
    })),
    allBranchesDirectory: fullBranchList.slice(0, 200).map((e, idx) => ({
      r: idx + 1,
      n: e.name,
      v: e.formattedValue,
      s: e.sharePercent,
      c: e.count,
      t: e.avgTicketFormatted,
      d: e.discountRatePercent,
      gm: e.gm,
      asm: e.asm,
    })),
    highDiscountTargets: (snapshot.highDiscountEntities || []).slice(0, 5),
    signals: snapshot.conversionSignals || [],
    gmShares: (snapshot.gmShares || []).slice(0, 15).map((g) => `${g.name}: ${g.formattedValue} (${g.percentage}%)`),
    asmShares: (snapshot.asmShares || []).slice(0, 20).map((a) => `${a.name}: ${a.formattedValue} (${a.percentage}%)`),
    categoryShares: (snapshot.categoryShares || []).slice(0, 15).map((c) => `${c.name}: ${c.formattedValue} (${c.percentage}%)`),
    brandShares: (snapshot.brandShares || []).slice(0, 15).map((b) => `${b.name}: ${b.formattedValue} (${b.percentage}%)`),
    financierShares: (snapshot.financierShares || []).slice(0, 15).map((f) => `${f.name}: ${f.formattedValue} (${f.percentage}%)`),
  };
}
