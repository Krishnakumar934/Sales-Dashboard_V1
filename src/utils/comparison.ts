import type { ColumnMeta, DataRow } from '../types/data.ts';
import {
  cleanNumber,
  detectDateOrder,
  findAmountCol,
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
  inferDatasetDefaultYear,
  isFinanceDataset,
  normalizeToMonthKey,
} from './aggregator.ts';

export type ComparisonDimension = 'gm' | 'asm' | 'branch';
export type ComparisonMode = 'sales' | 'finance';

export interface ComparisonOption {
  name: string;
  normalizedKey: string;
  salesAmount: number;
  salesQty: number;
  financeLoanAmount: number;
  financeCount: number;
  sortValue: number;
}

export interface ComparisonBreakdownRow {
  name: string;
  amount: number;
  count: number;
  sharePct: number;
}

export interface ComparisonMonthlyPoint {
  monthKey: string;
  monthLabel: string;
  amount: number;
  qty: number;
  financeAmount: number;
  financeCount: number;
}

export interface EntityComparisonMetrics {
  name: string;
  normalizedKey: string;
  mode: ComparisonMode;
  rankByPrimary: number;
  totalEntities: number;
  salesAmount: number;
  salesQty: number;
  salesDiscount: number;
  discountRatePct: number;
  avgTicket: number;
  salesRowCount: number;
  financeLoanAmount: number;
  financeLoginCount: number;
  avgLoanSize: number;
  financeRowCount: number;
  financePenetrationPct: number | null;
  branchCount: number;
  topCategories: ComparisonBreakdownRow[];
  topBrands: ComparisonBreakdownRow[];
  topFinanciers: ComparisonBreakdownRow[];
  topBranches: ComparisonBreakdownRow[];
  monthlyTrend: ComparisonMonthlyPoint[];
  bestMonth: { monthLabel: string; amount: number } | null;
  weakestMonth: { monthLabel: string; amount: number } | null;
}

export interface ComparisonMonthlyPair {
  monthKey: string;
  monthLabel: string;
  amountA: number;
  amountB: number;
  financeA: number;
  financeB: number;
}

export interface ComparisonGapDiagnosis {
  mode: ComparisonMode;
  leaderSide: 'A' | 'B' | 'tie';
  leaderName: string;
  trailingName: string;
  gapAmount: number;
  gapPercent: number;
  qtyGap: number;
  countGap: number;
  ticketGap: number;
  loanSizeGap: number;
  discountDeltaPct: number;
  financeGapAmount: number;
  whoLeadsText: string;
  whyDifference: string[];
  growthForLeader: string[];
  growthForTrailing: string[];
}

export interface HeadToHeadComparison {
  mode: ComparisonMode;
  dimension: ComparisonDimension;
  dimLabel: string;
  entityA: EntityComparisonMetrics;
  entityB: EntityComparisonMetrics;
  monthlyAligned: ComparisonMonthlyPair[];
  diagnosis: ComparisonGapDiagnosis;
}

export function normalizeEntityKey(raw: any): string {
  if (raw === null || raw === undefined) return '';
  return String(raw).trim().replace(/\s+/g, ' ').toLowerCase();
}

function cleanDisplayName(raw: any): string {
  if (raw === null || raw === undefined) return '';
  return String(raw).trim().replace(/\s+/g, ' ');
}

export function resolveComparisonColumn(
  columns: ColumnMeta[],
  dimension: ComparisonDimension
): string {
  if (!columns || columns.length === 0) return '';
  if (dimension === 'gm') return findGMCol(columns);
  if (dimension === 'asm') return findASMCol(columns);
  return findBranchCol(columns);
}

export function getComparisonDimensionLabel(dimension: ComparisonDimension): string {
  if (dimension === 'gm') return 'GM';
  if (dimension === 'asm') return 'ASM';
  return 'Branch';
}

function isIgnoredBucket(norm: string): boolean {
  return !norm || norm === 'other' || norm === 'unspecified' || norm === 'n/a' || norm === 'null';
}

/**
 * Extracts distinct, case-insensitively deduplicated entities for GM / ASM / Branch comparison.
 * Strictly prioritizes the active tab's dataset (`mode: 'finance'` -> Finance Data `Loan Amount` & `Count`,
 * `mode: 'sales'` -> Sales Report `Amount` & `Qty`).
 */
export function extractDistinctComparisonOptions(params: {
  dimension: ComparisonDimension;
  mode?: ComparisonMode;
  salesRows: DataRow[];
  salesCols: ColumnMeta[];
  financeRows: DataRow[];
  financeCols: ColumnMeta[];
}): ComparisonOption[] {
  const { dimension, mode = 'sales', salesRows, salesCols, financeRows, financeCols } = params;
  const sDimCol = resolveComparisonColumn(salesCols, dimension);
  const fDimCol = resolveComparisonColumn(financeCols, dimension);
  const sAmtCol = findAmountCol(salesCols) || 'Amount';
  const sQtyCol = findQuantityCol(salesCols);
  const fAmtCol = findAmountCol(financeCols) || 'Loan Amount';
  const fCountCol = findExplicitCountCol(financeCols);

  const map = new Map<
    string,
    {
      name: string;
      salesAmount: number;
      salesQty: number;
      financeLoanAmount: number;
      financeCount: number;
      inPrimarySource: boolean;
    }
  >();

  if (fDimCol && financeRows && financeRows.length > 0) {
    for (let i = 0; i < financeRows.length; i++) {
      const r = financeRows[i];
      const disp = cleanDisplayName(r[fDimCol]);
      const key = disp.toLowerCase();
      if (isIgnoredBucket(key)) continue;
      let entry = map.get(key);
      if (!entry) {
        entry = {
          name: disp,
          salesAmount: 0,
          salesQty: 0,
          financeLoanAmount: 0,
          financeCount: 0,
          inPrimarySource: mode === 'finance',
        };
        map.set(key, entry);
      } else if (mode === 'finance') {
        entry.inPrimarySource = true;
        entry.name = disp;
      }
      entry.financeLoanAmount += cleanNumber(r[fAmtCol]);
      entry.financeCount += fCountCol ? cleanNumber(r[fCountCol]) : 1;
    }
  }

  if (sDimCol && salesRows && salesRows.length > 0) {
    for (let i = 0; i < salesRows.length; i++) {
      const r = salesRows[i];
      const disp = cleanDisplayName(r[sDimCol]);
      const key = disp.toLowerCase();
      if (isIgnoredBucket(key)) continue;
      let entry = map.get(key);
      if (!entry) {
        if (mode === 'finance' && financeRows.length > 0) {
          // On Finance Report tab, only list entities present in the active Finance Data
          continue;
        }
        entry = {
          name: disp,
          salesAmount: 0,
          salesQty: 0,
          financeLoanAmount: 0,
          financeCount: 0,
          inPrimarySource: mode === 'sales',
        };
        map.set(key, entry);
      } else if (mode === 'sales') {
        entry.inPrimarySource = true;
      }
      entry.salesAmount += cleanNumber(r[sAmtCol]);
      entry.salesQty += sQtyCol ? cleanNumber(r[sQtyCol]) : 1;
    }
  }

  const list: ComparisonOption[] = [];
  for (const [normalizedKey, val] of map.entries()) {
    if (!val.inPrimarySource) continue;
    const salesAmount = Number(val.salesAmount.toFixed(2));
    const financeLoanAmount = Number(val.financeLoanAmount.toFixed(2));
    list.push({
      name: val.name,
      normalizedKey,
      salesAmount,
      salesQty: Math.round(val.salesQty),
      financeLoanAmount,
      financeCount: Math.round(val.financeCount),
      sortValue: mode === 'finance' ? financeLoanAmount : salesAmount,
    });
  }

  list.sort((a, b) => b.sortValue - a.sortValue || a.name.localeCompare(b.name));
  return list;
}

/**
 * Reconciles selected Entity A and Entity B against available options,
 * strictly guaranteeing A and B are never duplicates (even case-insensitively).
 */
export function reconcilePairSelection(
  options: ComparisonOption[],
  preferredA: string,
  preferredB: string
): { entityA: string; entityB: string } {
  if (!options || options.length === 0) {
    return { entityA: '', entityB: '' };
  }
  if (options.length === 1) {
    return { entityA: options[0].name, entityB: '' };
  }

  const findOption = (candidate: string) => {
    const key = normalizeEntityKey(candidate);
    if (!key) return null;
    return options.find((o) => o.normalizedKey === key) || null;
  };

  const optA = findOption(preferredA) || options[0];
  let optB = findOption(preferredB);

  if (!optB || optB.normalizedKey === optA.normalizedKey) {
    optB = options.find((o) => o.normalizedKey !== optA.normalizedKey) || options[1];
  }

  return {
    entityA: optA.name,
    entityB: optB ? optB.name : '',
  };
}

function summarizeSingleEntity(params: {
  targetName: string;
  mode: ComparisonMode;
  rankByPrimary: number;
  totalEntities: number;
  dimension: ComparisonDimension;
  salesRows: DataRow[];
  salesCols: ColumnMeta[];
  financeRows: DataRow[];
  financeCols: ColumnMeta[];
}): EntityComparisonMetrics {
  const {
    targetName,
    mode,
    rankByPrimary,
    totalEntities,
    dimension,
    salesRows,
    salesCols,
    financeRows,
    financeCols,
  } = params;

  const targetKey = normalizeEntityKey(targetName);
  const sDimCol = resolveComparisonColumn(salesCols, dimension);
  const fDimCol = resolveComparisonColumn(financeCols, dimension);
  const sAmtCol = findAmountCol(salesCols) || 'Amount';
  const sQtyCol = findQuantityCol(salesCols);
  const sDiscCol = findDiscountCol(salesCols);
  const sCatCol = findCategoryCol(salesCols) || 'Category';
  const sBrandCol = findBrandCol(salesCols) || 'Brand';
  const sBranchCol = findBranchCol(salesCols);
  const sDateCol = salesCols.find((c) => c.type === 'date')?.name || '';

  const fAmtCol = findAmountCol(financeCols) || 'Loan Amount';
  const fCountCol = findExplicitCountCol(financeCols);
  const fFinancierCol = findFinancierCol(financeCols);
  const fBranchCol = findBranchCol(financeCols);
  const fCatCol = findCategoryCol(financeCols) || 'Category';
  const fBrandCol = findBrandCol(financeCols) || 'Brand';
  const fDateCol = financeCols.find((c) => c.type === 'date')?.name || '';

  let salesAmount = 0;
  let salesQty = 0;
  let salesDiscount = 0;
  let salesRowCount = 0;

  let financeLoanAmount = 0;
  let financeLoginCount = 0;
  let financeRowCount = 0;

  const branchSet = new Set<string>();
  const catMap = new Map<string, { amount: number; count: number }>();
  const brandMap = new Map<string, { amount: number; count: number }>();
  const branchMap = new Map<string, { amount: number; count: number }>();
  const financierMap = new Map<string, { amount: number; count: number }>();
  const monthMap = new Map<
    string,
    { amount: number; qty: number; financeAmount: number; financeCount: number }
  >();

  // Process Sales rows
  if (sDimCol && salesRows.length > 0 && targetKey) {
    const sDateOrder = sDateCol ? detectDateOrder(salesRows, sDateCol) : 'MDY';
    const sDefaultYear = sDateCol
      ? inferDatasetDefaultYear(salesRows, sDateCol)
      : new Date().getFullYear();
    const sMonthCache = new Map<any, string>();
    const collectSalesBreakdowns = mode === 'sales';

    for (let i = 0; i < salesRows.length; i++) {
      const r = salesRows[i];
      if (normalizeEntityKey(r[sDimCol]) !== targetKey) continue;

      salesRowCount++;
      const amt = cleanNumber(r[sAmtCol]);
      const qty = sQtyCol ? cleanNumber(r[sQtyCol]) : 1;
      const disc = sDiscCol ? cleanNumber(r[sDiscCol]) : 0;

      salesAmount += amt;
      salesQty += qty;
      salesDiscount += disc;

      if (collectSalesBreakdowns) {
        if (sBranchCol && r[sBranchCol]) {
          const br = cleanDisplayName(r[sBranchCol]);
          if (br) {
            branchSet.add(br.toLowerCase());
            const bEntry = branchMap.get(br) || { amount: 0, count: 0 };
            bEntry.amount += amt;
            bEntry.count += qty;
            branchMap.set(br, bEntry);
          }
        }

        if (sCatCol && r[sCatCol]) {
          const cat = cleanDisplayName(r[sCatCol]);
          if (cat) {
            const cEntry = catMap.get(cat) || { amount: 0, count: 0 };
            cEntry.amount += amt;
            cEntry.count += qty;
            catMap.set(cat, cEntry);
          }
        }

        if (sBrandCol && r[sBrandCol]) {
          const brd = cleanDisplayName(r[sBrandCol]);
          if (brd) {
            const brEntry = brandMap.get(brd) || { amount: 0, count: 0 };
            brEntry.amount += amt;
            brEntry.count += qty;
            brandMap.set(brd, brEntry);
          }
        }
      }

      if (sDateCol) {
        const rawDate = r[sDateCol];
        const dKey = rawDate instanceof Date ? rawDate.getTime() : rawDate;
        let mKey = sMonthCache.get(dKey);
        if (mKey === undefined) {
          mKey = normalizeToMonthKey(rawDate, sDefaultYear, sDateOrder) || '';
          sMonthCache.set(dKey, mKey);
        }
        if (mKey) {
          const mEntry = monthMap.get(mKey) || {
            amount: 0,
            qty: 0,
            financeAmount: 0,
            financeCount: 0,
          };
          mEntry.amount += amt;
          mEntry.qty += qty;
          monthMap.set(mKey, mEntry);
        }
      }
    }
  }

  // Process Finance rows (on Finance tab, Finance rows populate categories, brands, branches, financiers, & monthly trend)
  if (fDimCol && financeRows.length > 0 && targetKey) {
    const fDateOrder = fDateCol ? detectDateOrder(financeRows, fDateCol) : 'MDY';
    const fDefaultYear = fDateCol
      ? inferDatasetDefaultYear(financeRows, fDateCol)
      : new Date().getFullYear();
    const fMonthCache = new Map<any, string>();
    const collectFinanceBreakdowns = mode === 'finance' || salesRowCount === 0;

    for (let i = 0; i < financeRows.length; i++) {
      const r = financeRows[i];
      if (normalizeEntityKey(r[fDimCol]) !== targetKey) continue;

      financeRowCount++;
      const loan = cleanNumber(r[fAmtCol]);
      const cnt = fCountCol ? cleanNumber(r[fCountCol]) : 1;
      financeLoanAmount += loan;
      financeLoginCount += cnt;

      if (collectFinanceBreakdowns) {
        if (fBranchCol && r[fBranchCol]) {
          const br = cleanDisplayName(r[fBranchCol]);
          if (br) {
            branchSet.add(br.toLowerCase());
            const bEntry = branchMap.get(br) || { amount: 0, count: 0 };
            bEntry.amount += loan;
            bEntry.count += cnt;
            branchMap.set(br, bEntry);
          }
        }

        if (fCatCol && r[fCatCol]) {
          const cat = cleanDisplayName(r[fCatCol]);
          if (cat) {
            const cEntry = catMap.get(cat) || { amount: 0, count: 0 };
            cEntry.amount += loan;
            cEntry.count += cnt;
            catMap.set(cat, cEntry);
          }
        }

        if (fBrandCol && r[fBrandCol]) {
          const brd = cleanDisplayName(r[fBrandCol]);
          if (brd) {
            const brEntry = brandMap.get(brd) || { amount: 0, count: 0 };
            brEntry.amount += loan;
            brEntry.count += cnt;
            brandMap.set(brd, brEntry);
          }
        }
      }

      if (fFinancierCol && r[fFinancierCol]) {
        const fin = cleanDisplayName(r[fFinancierCol]);
        if (fin) {
          const fnEntry = financierMap.get(fin) || { amount: 0, count: 0 };
          fnEntry.amount += loan;
          fnEntry.count += cnt;
          financierMap.set(fin, fnEntry);
        }
      }

      if (fDateCol) {
        const rawDate = r[fDateCol];
        const dKey = rawDate instanceof Date ? rawDate.getTime() : rawDate;
        let mKey = fMonthCache.get(dKey);
        if (mKey === undefined) {
          mKey = normalizeToMonthKey(rawDate, fDefaultYear, fDateOrder) || '';
          fMonthCache.set(dKey, mKey);
        }
        if (mKey) {
          const mEntry = monthMap.get(mKey) || {
            amount: 0,
            qty: 0,
            financeAmount: 0,
            financeCount: 0,
          };
          mEntry.financeAmount += loan;
          mEntry.financeCount += cnt;
          monthMap.set(mKey, mEntry);
        }
      }
    }
  }

  const baseForBreakdown = mode === 'finance' ? financeLoanAmount : salesAmount;
  const toTopList = (
    m: Map<string, { amount: number; count: number }>,
    limit: number,
    denom: number
  ): ComparisonBreakdownRow[] =>
    Array.from(m.entries())
      .sort(([, a], [, b]) => b.amount - a.amount || b.count - a.count)
      .slice(0, limit)
      .map(([name, d]) => ({
        name,
        amount: Number(d.amount.toFixed(2)),
        count: Math.round(d.count),
        sharePct: denom > 0 ? Number(((d.amount / denom) * 100).toFixed(1)) : 0,
      }));

  const monthlyTrend: ComparisonMonthlyPoint[] = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monthKey, m]) => ({
      monthKey,
      monthLabel: formatMonthLabel(monthKey),
      amount: Number(m.amount.toFixed(2)),
      qty: Math.round(m.qty),
      financeAmount: Number(m.financeAmount.toFixed(2)),
      financeCount: Math.round(m.financeCount),
    }));

  const valOfMonth = (m: ComparisonMonthlyPoint) =>
    mode === 'finance' ? m.financeAmount : m.amount;
  const activeMonths = monthlyTrend.filter((m) => valOfMonth(m) > 0);
  let bestMonth: { monthLabel: string; amount: number } | null = null;
  let weakestMonth: { monthLabel: string; amount: number } | null = null;
  if (activeMonths.length > 0) {
    let best = activeMonths[0];
    let low = activeMonths[0];
    for (const m of activeMonths) {
      if (valOfMonth(m) > valOfMonth(best)) best = m;
      if (valOfMonth(m) < valOfMonth(low)) low = m;
    }
    bestMonth = { monthLabel: best.monthLabel, amount: valOfMonth(best) };
    weakestMonth = { monthLabel: low.monthLabel, amount: valOfMonth(low) };
  }

  const roundedSales = Number(salesAmount.toFixed(2));
  const roundedQty = Math.round(salesQty);
  const roundedDisc = Number(salesDiscount.toFixed(2));
  const roundedFinance = Number(financeLoanAmount.toFixed(2));
  const roundedFinCount = Math.round(financeLoginCount);

  return {
    name: targetName,
    normalizedKey: targetKey,
    mode,
    rankByPrimary,
    totalEntities,
    salesAmount: roundedSales,
    salesQty: roundedQty,
    salesDiscount: roundedDisc,
    discountRatePct: roundedSales > 0 ? Number(((roundedDisc / roundedSales) * 100).toFixed(2)) : 0,
    avgTicket: roundedQty > 0 ? Number((roundedSales / roundedQty).toFixed(2)) : 0,
    salesRowCount,
    financeLoanAmount: roundedFinance,
    financeLoginCount: roundedFinCount,
    avgLoanSize: roundedFinCount > 0 ? Number((roundedFinance / roundedFinCount).toFixed(2)) : 0,
    financeRowCount,
    financePenetrationPct:
      roundedSales > 0 && roundedFinance > 0
        ? Number(((roundedFinance / roundedSales) * 100).toFixed(1))
        : null,
    branchCount: branchSet.size || (dimension === 'branch' ? 1 : 0),
    topCategories: toTopList(catMap, 6, baseForBreakdown),
    topBrands: toTopList(brandMap, 6, baseForBreakdown),
    topFinanciers: toTopList(financierMap, 5, roundedFinance),
    topBranches: toTopList(branchMap, 5, baseForBreakdown),
    monthlyTrend,
    bestMonth,
    weakestMonth,
  };
}

function buildDiagnosis(
  dimension: ComparisonDimension,
  mode: ComparisonMode,
  a: EntityComparisonMetrics,
  b: EntityComparisonMetrics
): ComparisonGapDiagnosis {
  const isFinanceMode = mode === 'finance';
  const valA = isFinanceMode ? a.financeLoanAmount : a.salesAmount;
  const valB = isFinanceMode ? b.financeLoanAmount : b.salesAmount;

  let leaderSide: 'A' | 'B' | 'tie' = 'tie';
  let leader = a;
  let trailing = b;
  if (valA > valB) {
    leaderSide = 'A';
    leader = a;
    trailing = b;
  } else if (valB > valA) {
    leaderSide = 'B';
    leader = b;
    trailing = a;
  }

  const leadVal = Math.max(valA, valB);
  const trailVal = Math.min(valA, valB);
  const gapAmount = Number((leadVal - trailVal).toFixed(2));
  const gapPercent =
    trailVal > 0 ? Number((((leadVal - trailVal) / trailVal) * 100).toFixed(1)) : leadVal > 0 ? 100 : 0;
  const qtyGap = Math.abs(a.salesQty - b.salesQty);
  const countGap = Math.abs(a.financeLoginCount - b.financeLoginCount);
  const ticketGap = Number(Math.abs(a.avgTicket - b.avgTicket).toFixed(2));
  const loanSizeGap = Number(Math.abs(a.avgLoanSize - b.avgLoanSize).toFixed(2));
  const discountDeltaPct = Number(Math.abs(a.discountRatePct - b.discountRatePct).toFixed(2));
  const financeGapAmount = Number(Math.abs(a.financeLoanAmount - b.financeLoanAmount).toFixed(2));

  const whoLeadsText = isFinanceMode
    ? leaderSide === 'tie'
      ? `${a.name} and ${b.name} are tied at ${formatIndianCurrency(leadVal, true)} in Finance Loan Amount.`
      : `${leader.name} has higher Finance Loan Amount (${formatIndianCurrency(leadVal, true)} across ${formatIndianCount(leader.financeLoginCount)} counts) than ${trailing.name} (${formatIndianCurrency(trailVal, true)} across ${formatIndianCount(trailing.financeLoginCount)} counts), leading by ${formatIndianCurrency(gapAmount, true)} (+${gapPercent}%).`
    : leaderSide === 'tie'
    ? `${a.name} and ${b.name} are tied at ${formatIndianCurrency(leadVal, true)} in sales.`
    : `${leader.name} has higher sales (${formatIndianCurrency(leadVal, true)}) than ${trailing.name} (${formatIndianCurrency(trailVal, true)}), leading by ${formatIndianCurrency(gapAmount, true)} (+${gapPercent}%).`;

  const whyDifference: string[] = [];

  if (dimension !== 'branch' && leader.branchCount !== trailing.branchCount) {
    const branchDiff = Math.abs(leader.branchCount - trailing.branchCount);
    const largerFootprint = leader.branchCount > trailing.branchCount ? leader.name : trailing.name;
    whyDifference.push(
      `Store footprint gap: ${largerFootprint} covers ${Math.max(leader.branchCount, trailing.branchCount)} branches vs ${Math.min(leader.branchCount, trailing.branchCount)} (${branchDiff} branch difference).`
    );
  }

  if (isFinanceMode) {
    if (leader.financeLoginCount !== trailing.financeLoginCount) {
      const highCnt = leader.financeLoginCount >= trailing.financeLoginCount ? leader : trailing;
      const lowCnt = leader.financeLoginCount >= trailing.financeLoginCount ? trailing : leader;
      whyDifference.push(
        `Login count volume: ${highCnt.name} logged ${formatIndianCount(highCnt.financeLoginCount)} finance counts vs ${formatIndianCount(lowCnt.financeLoginCount)} counts (+${formatIndianCount(countGap)} counts difference).`
      );
    }

    if (loanSizeGap > 200) {
      const highLoan = leader.avgLoanSize >= trailing.avgLoanSize ? leader : trailing;
      const lowLoan = leader.avgLoanSize >= trailing.avgLoanSize ? trailing : leader;
      whyDifference.push(
        `Average loan size spread: ${highLoan.name} averages ${formatIndianCurrency(highLoan.avgLoanSize, true)}/count vs ${formatIndianCurrency(lowLoan.avgLoanSize, true)}/count (${formatIndianCurrency(loanSizeGap, true)} per loan).`
      );
    }

    if (leader.topFinanciers.length > 0 && trailing.topFinanciers.length > 0) {
      const trailFinMap = new Map(trailing.topFinanciers.map((f) => [f.name.toLowerCase(), f.amount]));
      let topFinName = leader.topFinanciers[0].name;
      let topFinDiff = -Infinity;
      for (const f of leader.topFinanciers) {
        const diff = f.amount - (trailFinMap.get(f.name.toLowerCase()) || 0);
        if (diff > topFinDiff) {
          topFinDiff = diff;
          topFinName = f.name;
        }
      }
      if (topFinDiff > 0) {
        whyDifference.push(
          `Lender mix advantage: ${leader.name} generates ${formatIndianCurrency(topFinDiff, true)} more Loan Amount via ${topFinName}.`
        );
      }
    }
  } else {
    if (leader.salesQty !== trailing.salesQty) {
      const higherQtyEntity = leader.salesQty > trailing.salesQty ? leader : trailing;
      const lowerQtyEntity = leader.salesQty > trailing.salesQty ? trailing : leader;
      whyDifference.push(
        `Unit volume driver: ${higherQtyEntity.name} moved ${formatIndianCount(higherQtyEntity.salesQty)} units vs ${formatIndianCount(lowerQtyEntity.salesQty)} units (+${formatIndianCount(qtyGap)} units difference).`
      );
    }

    if (ticketGap > 200) {
      const higherTicket = leader.avgTicket >= trailing.avgTicket ? leader : trailing;
      const lowerTicket = leader.avgTicket >= trailing.avgTicket ? trailing : leader;
      whyDifference.push(
        `Average ticket size gap: ${higherTicket.name} averages ${formatIndianCurrency(higherTicket.avgTicket, true)}/unit vs ${formatIndianCurrency(lowerTicket.avgTicket, true)}/unit (${formatIndianCurrency(ticketGap, true)} per-bill spread).`
      );
    }
  }

  // Category & brand advantage (calculated strictly from active mode's dataset!)
  if (leader.topCategories.length > 0 && trailing.topCategories.length > 0) {
    const trailCatMap = new Map(trailing.topCategories.map((c) => [c.name.toLowerCase(), c.amount]));
    let biggestCatName = leader.topCategories[0].name;
    let biggestCatDiff = -Infinity;
    for (const c of leader.topCategories) {
      const diff = c.amount - (trailCatMap.get(c.name.toLowerCase()) || 0);
      if (diff > biggestCatDiff) {
        biggestCatDiff = diff;
        biggestCatName = c.name;
      }
    }
    if (biggestCatDiff > 0) {
      whyDifference.push(
        `Category mix edge: ${leader.name} outperforms by ${formatIndianCurrency(biggestCatDiff, true)} in ${biggestCatName}.`
      );
    }
  }

  if (leader.topBrands.length > 0 && trailing.topBrands.length > 0) {
    const trailBrandMap = new Map(trailing.topBrands.map((c) => [c.name.toLowerCase(), c.amount]));
    let topBrandName = leader.topBrands[0].name;
    let topBrandDiff = -Infinity;
    for (const br of leader.topBrands) {
      const diff = br.amount - (trailBrandMap.get(br.name.toLowerCase()) || 0);
      if (diff > topBrandDiff) {
        topBrandDiff = diff;
        topBrandName = br.name;
      }
    }
    if (topBrandDiff > 0) {
      whyDifference.push(
        `Brand concentration: ${leader.name} holds a ${formatIndianCurrency(topBrandDiff, true)} lead on ${topBrandName}.`
      );
    }
  }

  if (
    !isFinanceMode &&
    leader.financePenetrationPct !== null &&
    trailing.financePenetrationPct !== null &&
    Math.abs(leader.financePenetrationPct - trailing.financePenetrationPct) >= 2
  ) {
    whyDifference.push(
      `EMI / Finance attachment: ${leader.name} converts ${leader.financePenetrationPct}% via finance (${formatIndianCount(leader.financeLoginCount)} logins) vs ${trailing.name} at ${trailing.financePenetrationPct}% (${formatIndianCount(trailing.financeLoginCount)} logins).`
    );
  }

  const growthForLeader: string[] = [];
  const growthForTrailing: string[] = [];

  if (isFinanceMode) {
    if (leader.topFinanciers.length > 1) {
      const secondFin = leader.topFinanciers[1];
      growthForLeader.push(
        `Diversify lender velocity for ${leader.name}: expand ${secondFin.name} (${secondFin.sharePct}% share, ${formatIndianCount(secondFin.count)} counts) with instant secondary underwriting when primary schemes reject.`
      );
    }
    growthForLeader.push(
      `Lift average loan size for ${leader.name} above ${formatIndianCurrency(leader.avgLoanSize, true)} by bundling 0-DP upgrades on flagship ${leader.topCategories[0]?.name || 'categories'}.`
    );
    if (leader.weakestMonth && leader.bestMonth && leader.weakestMonth.monthLabel !== leader.bestMonth.monthLabel) {
      growthForLeader.push(
        `Smooth off-peak finance dips for ${leader.name}: ${leader.weakestMonth.monthLabel} (${formatIndianCurrency(leader.weakestMonth.amount, true)}) trailed ${leader.bestMonth.monthLabel} (${formatIndianCurrency(leader.bestMonth.amount, true)}).`
      );
    }

    if (leader.financeLoginCount > trailing.financeLoginCount) {
      growthForTrailing.push(
        `Close login count gap for ${trailing.name}: lift approvals from ${formatIndianCount(trailing.financeLoginCount)} counts toward ${leader.name}'s ${formatIndianCount(leader.financeLoginCount)} counts via pre-approved eligibility checks at billing.`
      );
    }
    if (leader.avgLoanSize > trailing.avgLoanSize) {
      growthForTrailing.push(
        `Raise avg loan ticket at ${trailing.name} from ${formatIndianCurrency(trailing.avgLoanSize, true)} toward ${formatIndianCurrency(leader.avgLoanSize, true)} with longer-tenure no-cost EMI plans.`
      );
    }
    if (leader.topFinanciers.length > 0) {
      const leadFin = leader.topFinanciers[0];
      growthForTrailing.push(
        `Activate ${leadFin.name} counter promotions at ${trailing.name} where ${leader.name} drives ${formatIndianCurrency(leadFin.amount, true)} (${formatIndianCount(leadFin.count)} counts).`
      );
    }
  } else {
    if (leader.discountRatePct > trailing.discountRatePct + 0.3 && leader.discountRatePct > 3.5) {
      growthForLeader.push(
        `Protect net margin on ${leader.name}: discount rate is ${leader.discountRatePct}% vs ${trailing.name}'s ${trailing.discountRatePct}% — tighten discretionary discounting by 0.5% to recover profit without losing volume.`
      );
    } else {
      growthForLeader.push(
        `Upsell accessories & warranty bundles on ${leader.name}'s ${formatIndianCount(leader.salesQty)} transactions to lift avg ticket above ${formatIndianCurrency(leader.avgTicket, true)}.`
      );
    }

    if (leader.weakestMonth && leader.bestMonth && leader.weakestMonth.monthLabel !== leader.bestMonth.monthLabel) {
      growthForLeader.push(
        `Smooth seasonal dip for ${leader.name}: ${leader.weakestMonth.monthLabel} (${formatIndianCurrency(leader.weakestMonth.amount, true)}) trailed peak ${leader.bestMonth.monthLabel} (${formatIndianCurrency(leader.bestMonth.amount, true)}) — schedule mid-month financier schemes in slow weeks.`
      );
    }

    if (leader.topCategories.length > 1) {
      const secondCat = leader.topCategories[1];
      growthForLeader.push(
        `Expand secondary category ${secondCat.name} (${secondCat.sharePct}% share) through cross-sell displays at top-footfall counters.`
      );
    }

    if (trailing.avgTicket > 0 && leader.avgTicket > trailing.avgTicket) {
      growthForTrailing.push(
        `Lift average bill value for ${trailing.name} from ${formatIndianCurrency(trailing.avgTicket, true)} toward ${leader.name}'s ${formatIndianCurrency(leader.avgTicket, true)} using zero-down-payment EMI upgrades on mid-tier models.`
      );
    }

    if (leader.topBrands.length > 0) {
      const targetBrand = leader.topBrands[0];
      growthForTrailing.push(
        `Close brand share gap in ${targetBrand.name}: ensure hero SKU stock availability and promotor focus where ${leader.name} generates ${formatIndianCurrency(targetBrand.amount, true)}.`
      );
    }

    if (
      leader.financePenetrationPct !== null &&
      trailing.financePenetrationPct !== null &&
      leader.financePenetrationPct > trailing.financePenetrationPct
    ) {
      growthForTrailing.push(
        `Raise EMI finance attachment at ${trailing.name} from ${trailing.financePenetrationPct}% toward ${leader.financePenetrationPct}% with faster Bajaj/IDFC counter approvals.`
      );
    } else if (trailing.weakestMonth) {
      growthForTrailing.push(
        `Target turnaround in weaker periods like ${trailing.weakestMonth.monthLabel} (${formatIndianCurrency(trailing.weakestMonth.amount, true)}) with weekend dealer-assist campaigns and targeted bundle offers.`
      );
    }
  }

  return {
    mode,
    leaderSide,
    leaderName: leader.name,
    trailingName: trailing.name,
    gapAmount,
    gapPercent,
    qtyGap,
    countGap,
    ticketGap,
    loanSizeGap,
    discountDeltaPct,
    financeGapAmount,
    whoLeadsText,
    whyDifference: whyDifference.slice(0, 4),
    growthForLeader: growthForLeader.slice(0, 3),
    growthForTrailing: growthForTrailing.slice(0, 3),
  };
}

/**
 * Computes a complete One-vs-One comparison for GM, ASM, or Branch strictly grounded
 * in the active report mode (`sales` -> Sales Report, `finance` -> Finance Data).
 */
export function computeHeadToHeadComparison(params: {
  dimension: ComparisonDimension;
  mode?: ComparisonMode;
  entityAName: string;
  entityBName: string;
  options: ComparisonOption[];
  salesRows: DataRow[];
  salesCols: ColumnMeta[];
  financeRows: DataRow[];
  financeCols: ColumnMeta[];
}): HeadToHeadComparison | null {
  const {
    dimension,
    mode = 'sales',
    entityAName,
    entityBName,
    options,
    salesRows,
    salesCols,
    financeRows,
    financeCols,
  } = params;

  const { entityA: safeA, entityB: safeB } = reconcilePairSelection(options, entityAName, entityBName);
  if (!safeA || !safeB) return null;

  const rankMap = new Map<string, number>();
  options.forEach((opt, idx) => rankMap.set(opt.normalizedKey, idx + 1));

  const totalEntities = options.length;
  const entityA = summarizeSingleEntity({
    targetName: safeA,
    mode,
    rankByPrimary: rankMap.get(normalizeEntityKey(safeA)) || 1,
    totalEntities,
    dimension,
    salesRows,
    salesCols,
    financeRows,
    financeCols,
  });

  const entityB = summarizeSingleEntity({
    targetName: safeB,
    mode,
    rankByPrimary: rankMap.get(normalizeEntityKey(safeB)) || 2,
    totalEntities,
    dimension,
    salesRows,
    salesCols,
    financeRows,
    financeCols,
  });

  const monthKeys = new Set<string>();
  entityA.monthlyTrend.forEach((m) => monthKeys.add(m.monthKey));
  entityB.monthlyTrend.forEach((m) => monthKeys.add(m.monthKey));

  const mapA = new Map(entityA.monthlyTrend.map((m) => [m.monthKey, m]));
  const mapB = new Map(entityB.monthlyTrend.map((m) => [m.monthKey, m]));

  const monthlyAligned: ComparisonMonthlyPair[] = Array.from(monthKeys)
    .sort()
    .map((mKey) => ({
      monthKey: mKey,
      monthLabel: formatMonthLabel(mKey),
      amountA: mapA.get(mKey)?.amount || 0,
      amountB: mapB.get(mKey)?.amount || 0,
      financeA: mapA.get(mKey)?.financeAmount || 0,
      financeB: mapB.get(mKey)?.financeAmount || 0,
    }));

  return {
    mode,
    dimension,
    dimLabel: getComparisonDimensionLabel(dimension),
    entityA,
    entityB,
    monthlyAligned,
    diagnosis: buildDiagnosis(dimension, mode, entityA, entityB),
  };
}

/**
 * Helper to resolve Sales & Finance row/col pairs cleanly regardless of which tab is currently active.
 */
export function resolveSalesAndFinanceSources(params: {
  isFinanceActive: boolean;
  activeRows: DataRow[];
  activeCols: ColumnMeta[];
  counterpartSalesRows: DataRow[];
  counterpartSalesCols?: ColumnMeta[];
  counterpartFinanceRows: DataRow[];
  counterpartFinanceCols?: ColumnMeta[];
}): {
  salesRows: DataRow[];
  salesCols: ColumnMeta[];
  financeRows: DataRow[];
  financeCols: ColumnMeta[];
} {
  const {
    isFinanceActive,
    activeRows,
    activeCols,
    counterpartSalesRows,
    counterpartSalesCols,
    counterpartFinanceRows,
    counterpartFinanceCols,
  } = params;

  if (isFinanceActive || isFinanceDataset(activeCols)) {
    return {
      salesRows: counterpartSalesRows || [],
      salesCols: counterpartSalesCols || [],
      financeRows: activeRows || [],
      financeCols: activeCols || [],
    };
  }

  return {
    salesRows: activeRows || [],
    salesCols: activeCols || [],
    financeRows: counterpartFinanceRows || [],
    financeCols: counterpartFinanceCols || [],
  };
}
