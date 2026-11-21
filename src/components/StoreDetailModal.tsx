import React, { useEffect } from 'react';
import { motion } from 'motion/react';
import {
  X,
  Store,
  Calendar,
  Layers,
  TrendingUp,
  Tag,
  Building2,
  Filter,
  Landmark,
  Users2,
  UserCheck,
  BarChart3,
  Wallet,
  Scale,
} from 'lucide-react';
import type { StoreDetailedReport } from '../utils/aggregator.ts';
import { formatIndianCurrency, formatIndianCount } from '../utils/aggregator.ts';

interface StoreDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  report: StoreDetailedReport | null;
  onApplyStoreFilter?: (storeName: string) => void;
}

function getEntityTypeLabel(dimensionLabel?: string): string {
  const l = (dimensionLabel || '').toLowerCase();
  if (l.includes('financier') || l.includes('financer')) return 'Financier';
  if (l === 'gm' || l.includes('general manager')) return 'GM';
  if (l === 'asm' || l.includes('area sales')) return 'ASM';
  if (l.includes('brand')) return 'Brand';
  if (l.includes('category')) return 'Category';
  if (l.includes('branch') || l.includes('store') || !l) return 'Store';
  return dimensionLabel || 'Entity';
}

export const StoreDetailModal: React.FC<StoreDetailModalProps> = ({
  isOpen,
  onClose,
  report,
  onApplyStoreFilter,
}) => {
  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !report) return null;

  const entityLabel = getEntityTypeLabel(report.dimensionLabel);
  const isBrandMode = entityLabel === 'Brand';
  const isCategoryMode = entityLabel === 'Category';
  const isFinanceMode = Boolean(report.isFinance);

  // Determine 1 of 3 distinct visual themes:
  // 1) Brand Financier Login Matrix (Violet)
  // 2) Finance Loan Report (Cyan / Amber)
  // 3) Normal Sales Report (Emerald)
  const theme = isBrandMode
    ? {
        topBar: 'border-t-4 border-t-violet-500',
        headerBg: 'bg-gradient-to-r from-violet-950/65 via-[#131c2e]/95 to-[#162033]',
        iconWrap: 'bg-violet-500/15 border-violet-500/35 text-violet-300',
        badge: 'text-violet-200 bg-violet-500/20 border-violet-400/40',
        badgeText: 'BRAND FINANCE MATRIX · FINANCIER LOGINS',
        subtitle: report.isFinance
          ? 'Financier-wise login counts & loan distribution across Finance Data'
          : 'Cross-linked Financier login counts paired with Brand Sales volume',
        filterBtn: 'bg-violet-500 hover:bg-violet-400 text-slate-950',
      }
    : isFinanceMode
    ? {
        topBar: 'border-t-4 border-t-cyan-400',
        headerBg: 'bg-gradient-to-r from-cyan-950/55 via-[#131c2e]/95 to-[#162033]',
        iconWrap: 'bg-cyan-500/15 border-cyan-500/35 text-cyan-300',
        badge: 'text-cyan-200 bg-cyan-500/15 border-cyan-400/40',
        badgeText:
          entityLabel === 'Financier'
            ? 'LENDER PORTFOLIO · FINANCE DATA'
            : `FINANCE LOAN REPORT · ${entityLabel.toUpperCase()}`,
        subtitle:
          entityLabel === 'Financier'
            ? 'Disbursed Loan Amount & Login Counts from Finance Data'
            : 'Financed Loan Amount & Login Counts with Normal Sales comparison',
        filterBtn: 'bg-cyan-400 hover:bg-cyan-300 text-slate-950',
      }
    : {
        topBar: 'border-t-4 border-t-emerald-500',
        headerBg: 'bg-gradient-to-r from-emerald-950/55 via-[#131c2e]/95 to-[#162033]',
        iconWrap: 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300',
        badge: 'text-emerald-200 bg-emerald-500/15 border-emerald-400/40',
        badgeText: `NORMAL SALES REPORT · ${entityLabel.toUpperCase()}`,
        subtitle: 'Gross Sales, Units Sold & Discount summary with Finance penetration split',
        filterBtn: 'bg-emerald-500 hover:bg-emerald-400 text-slate-950',
      };

  const showHierarchyTags =
    entityLabel === 'Store' ||
    (report.gm !== 'N/A' && report.gm.split(',').length <= 3);

  const renderEntityIcon = () => {
    if (entityLabel === 'Financier') return <Landmark className="w-5 h-5" />;
    if (entityLabel === 'GM') return <Users2 className="w-5 h-5" />;
    if (entityLabel === 'ASM') return <UserCheck className="w-5 h-5" />;
    if (entityLabel === 'Brand') return <Tag className="w-5 h-5" />;
    if (entityLabel === 'Category') return <Layers className="w-5 h-5" />;
    return <Store className="w-5 h-5" />;
  };

  // Compute Normal (Cash / Non-Financed) Sales vs Financed Loan Split when both datasets align
  const grossSalesAmount = isFinanceMode
    ? report.salesSummary?.totalSalesAmount ?? null
    : report.totalAmount;
  const financedLoanAmount = isFinanceMode
    ? report.totalAmount
    : report.financeSummary?.totalLoanAmount ?? null;
  const financeLoginCount = isFinanceMode
    ? report.recordCount
    : report.financeSummary?.totalLoginCount ?? 0;

  const hasSplitComparison =
    entityLabel !== 'Financier' &&
    grossSalesAmount !== null &&
    grossSalesAmount > 0 &&
    financedLoanAmount !== null;

  const normalSalesAmount = hasSplitComparison
    ? Math.max(0, grossSalesAmount! - financedLoanAmount!)
    : 0;
  const rawFinancedPct =
    hasSplitComparison && grossSalesAmount! > 0
      ? (financedLoanAmount! / grossSalesAmount!) * 100
      : 0;
  const financedPct = Number(Math.min(100, Math.max(0, rawFinancedPct)).toFixed(1));
  const normalPct = Number(Math.max(0, 100 - financedPct).toFixed(1));

  // Reusable Normal vs Finance Split Card (clearly answers "which is normal vs which is financed/get")
  const normalVsFinanceSplitBlock = hasSplitComparison ? (
    <div className="bg-slate-950/80 border border-slate-700/70 rounded-xl p-4 space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 pb-2 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Scale className="w-4 h-4 text-amber-300 shrink-0" />
          <h3 className="text-xs sm:text-sm font-semibold text-white">
            Normal Sales vs Financed (Loan) Split — {report.storeName}
          </h3>
        </div>
        <span className="text-[11px] font-mono text-slate-300 bg-slate-900 border border-slate-700 px-2.5 py-0.5 rounded-md self-start sm:self-auto">
          Gross Sales: {formatIndianCurrency(grossSalesAmount)}
        </span>
      </div>

      {/* Visual Dual Stacked Bar */}
      <div className="space-y-1.5">
        <div className="h-3 w-full rounded-full bg-slate-800 overflow-hidden flex p-0.5 gap-0.5">
          {normalPct > 0 && (
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all"
              style={{ width: `${Math.max(3, normalPct)}%` }}
              title={`Normal (Non-Financed) Sales: ${formatIndianCurrency(normalSalesAmount)} (${normalPct}%)`}
            />
          )}
          {financedPct > 0 && (
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-amber-400 transition-all"
              style={{ width: `${Math.max(3, financedPct)}%` }}
              title={`Finance (Loan) Sales: ${formatIndianCurrency(financedLoanAmount)} (${financedPct}%)`}
            />
          )}
        </div>
        <div className="flex items-center justify-between text-[11px] font-mono">
          <span className="text-emerald-300 font-semibold">
            Normal / Cash: {normalPct}%
          </span>
          <span className="text-cyan-300 font-semibold">
            Financed (Loan): {financedPct}%
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div className="bg-emerald-950/30 border border-emerald-500/35 rounded-xl p-3 flex items-center justify-between gap-2">
          <div>
            <span className="text-[10px] uppercase tracking-wider font-semibold text-emerald-300 flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5" />
              Normal Sales (Cash / Direct)
            </span>
            <div className="text-base sm:text-lg font-bold text-white font-mono mt-0.5">
              {formatIndianCurrency(normalSalesAmount)}
            </div>
            <span className="text-[10px] text-emerald-300/90 font-mono">
              Non-financed sales portion
            </span>
          </div>
          <span className="text-sm font-bold font-mono text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-1 rounded-lg">
            {normalPct}%
          </span>
        </div>

        <div className="bg-cyan-950/30 border border-cyan-500/35 rounded-xl p-3 flex items-center justify-between gap-2">
          <div>
            <span className="text-[10px] uppercase tracking-wider font-semibold text-cyan-300 flex items-center gap-1.5">
              <Landmark className="w-3.5 h-3.5" />
              Financed Loan Sales (Get)
            </span>
            <div className="text-base sm:text-lg font-bold text-white font-mono mt-0.5">
              {formatIndianCurrency(financedLoanAmount)}
            </div>
            <span className="text-[10px] text-cyan-300/90 font-mono">
              {formatIndianCount(financeLoginCount)} finance logins
            </span>
          </div>
          <span className="text-sm font-bold font-mono text-cyan-300 bg-cyan-500/15 border border-cyan-500/30 px-2.5 py-1 rounded-lg">
            {financedPct}%
          </span>
        </div>
      </div>
    </div>
  ) : null;

  const financierBreakdownBlock =
    report.financierBreakdown && report.financierBreakdown.length > 0 ? (
      <div
        className={`rounded-xl p-4 space-y-3 border ${
          isBrandMode
            ? 'bg-violet-950/20 border-violet-500/40'
            : 'bg-slate-800/40 border-cyan-500/25'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 pb-2 border-b border-slate-700/60">
          <div>
            <h3 className="text-xs sm:text-sm font-semibold text-white flex items-center gap-2">
              <Landmark className={`w-4 h-4 shrink-0 ${isBrandMode ? 'text-violet-300' : 'text-amber-400'}`} />
              <span>Finance Login Counts by Financier — {report.storeName}</span>
            </h3>
            <span className="text-[11px] text-slate-400 block mt-0.5">
              Count logged per specific finance company (SUM of Count) with Loan Amount & Avg Loan Size
            </span>
          </div>
          <span
            className={`text-[10px] font-mono px-2.5 py-0.5 rounded-lg self-start sm:self-auto shrink-0 border ${
              isBrandMode
                ? 'text-violet-200 bg-violet-500/15 border-violet-400/35'
                : 'text-cyan-300 bg-cyan-500/10 border-cyan-500/25'
            }`}
          >
            {report.financierBreakdown.length} Financiers
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {report.financierBreakdown.map((fin, idx) => (
            <div
              key={fin.name}
              className="p-3 rounded-xl bg-slate-900/85 border border-slate-700/60 space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 border ${
                      isBrandMode
                        ? 'text-violet-200 bg-violet-500/15 border-violet-500/30'
                        : 'text-amber-300 bg-amber-500/10 border-amber-500/25'
                    }`}
                  >
                    #{idx + 1}
                  </span>
                  <span className="font-semibold text-white truncate" title={fin.name}>
                    {fin.name}
                  </span>
                </div>
                <span className="font-bold text-cyan-300 font-mono tabular-nums shrink-0">
                  {fin.count.toLocaleString('en-IN')} logins
                </span>
              </div>

              <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    isBrandMode
                      ? 'bg-gradient-to-r from-violet-400 to-cyan-400'
                      : 'bg-gradient-to-r from-cyan-400 to-emerald-400'
                  }`}
                  style={{ width: `${Math.max(4, fin.countPercentage)}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 pt-0.5">
                <span className="text-emerald-300 font-medium">
                  Loan: {formatIndianCurrency(fin.amount)}
                </span>
                <span>
                  {fin.countPercentage}% share · Avg {formatIndianCurrency(fin.avgLoan)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    ) : null;

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={`${theme.badgeText} for ${report.storeName}`}
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-[#040812]/65 backdrop-blur-md"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
        className={`bg-[#162033] border border-slate-600/80 ring-1 ring-white/10 ${theme.topBar} rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-[0_28px_70px_-12px_rgba(0,0,0,0.88)] overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Distinct Mode Header */}
        <div className={`p-4 sm:p-5 border-b border-slate-700/75 ${theme.headerBg} flex items-start justify-between gap-3 shrink-0`}>
          <div className="flex items-start gap-3 min-w-0">
            <div className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 mt-0.5 ${theme.iconWrap}`}>
              {renderEntityIcon()}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-xl font-bold text-white break-words">
                  {report.storeName}
                </h2>
                <span className={`text-[10px] font-mono font-semibold border px-2.5 py-0.5 rounded-md shrink-0 ${theme.badge}`}>
                  {theme.badgeText}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">{theme.subtitle}</p>

              {/* Hierarchy tags: GM, ASM, Zone */}
              {showHierarchyTags ? (
                <div className="flex items-center gap-2 mt-2 flex-wrap text-xs text-slate-400">
                  {report.gm !== 'N/A' && (
                    <span className="inline-flex items-center gap-1 bg-slate-800/90 px-2 py-0.5 rounded-md border border-slate-700/60">
                      <Building2 className="w-3 h-3 text-emerald-400" />
                      <span className="text-slate-400">GM:</span>
                      <span className="font-medium text-slate-200">{report.gm}</span>
                    </span>
                  )}
                  {report.asm !== 'N/A' && (
                    <span className="inline-flex items-center gap-1 bg-slate-800/90 px-2 py-0.5 rounded-md border border-slate-700/60">
                      <span className="text-slate-400">ASM:</span>
                      <span className="font-medium text-slate-200">{report.asm}</span>
                    </span>
                  )}
                  {report.zone !== 'N/A' && (
                    <span className="inline-flex items-center gap-1 bg-slate-800/90 px-2 py-0.5 rounded-md border border-slate-700/60">
                      <span className="text-slate-400">Zone:</span>
                      <span className="font-medium text-slate-200">{report.zone}</span>
                    </span>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 mt-2 flex-wrap text-xs text-slate-400">
                  {report.topBranchesBreakdown && (
                    <span className="inline-flex items-center gap-1 bg-slate-800/90 px-2 py-0.5 rounded-md border border-slate-700/60">
                      <Store className="w-3 h-3 text-emerald-400" />
                      <span>Top Branches tracked: {report.topBranchesBreakdown.length}+</span>
                    </span>
                  )}
                  {report.brandBreakdown && (
                    <span className="inline-flex items-center gap-1 bg-slate-800/90 px-2 py-0.5 rounded-md border border-slate-700/60">
                      <Tag className="w-3 h-3 text-violet-400" />
                      <span>Top Brands tracked: {report.brandBreakdown.length}+</span>
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close detailed report"
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white tactile-press shrink-0 cursor-pointer"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 flex-1">
          {/* Format-Specific Hero Strip */}
          {isBrandMode ? (
            /* BRAND MODE HERO: Dual Contrast Cards (Finance Logins vs Brand Sales) */
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-violet-950/30 border border-violet-500/35 rounded-xl p-3.5 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-semibold text-violet-300 uppercase tracking-wider">
                  <span className="flex items-center gap-1.5">
                    <Landmark className="w-3.5 h-3.5" />
                    Finance Logins & Loans
                  </span>
                  <span className="font-mono text-[10px] text-violet-200 bg-violet-500/20 px-2 py-0.5 rounded">
                    {report.financierBreakdown?.length || 0} Financiers
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2 font-mono">
                  <span className="text-xl sm:text-2xl font-bold text-cyan-300">
                    {formatIndianCount(financeLoginCount)} logins
                  </span>
                  <span className="text-sm font-bold text-white">
                    {formatIndianCurrency(financedLoanAmount ?? report.totalAmount)}
                  </span>
                </div>
                <span className="text-[11px] text-slate-400 font-mono block">
                  Avg Loan: {formatIndianCurrency(
                    financeLoginCount > 0 && financedLoanAmount
                      ? financedLoanAmount / financeLoginCount
                      : report.avgTicket
                  )}
                </span>
              </div>

              <div className="bg-emerald-950/25 border border-emerald-500/35 rounded-xl p-3.5 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-semibold text-emerald-300 uppercase tracking-wider">
                  <span className="flex items-center gap-1.5">
                    <BarChart3 className="w-3.5 h-3.5" />
                    Gross Sales vs Normal Share
                  </span>
                  <span className="font-mono text-[10px] text-emerald-200 bg-emerald-500/20 px-2 py-0.5 rounded">
                    {hasSplitComparison ? `${normalPct}% Normal` : 'Brand Sales'}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2 font-mono">
                  <span className="text-xl sm:text-2xl font-bold text-emerald-300">
                    {formatIndianCurrency(grossSalesAmount ?? report.totalAmount)}
                  </span>
                  {hasSplitComparison && (
                    <span className="text-sm font-bold text-white">
                      Normal: {formatIndianCurrency(normalSalesAmount)}
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-slate-400 font-mono block">
                  {isFinanceMode
                    ? `Units: ${formatIndianCount(report.salesSummary?.totalQuantity ?? report.totalQuantity)} · Disc: ${formatIndianCurrency(report.salesSummary?.totalDiscount ?? 0)}`
                    : `Units: ${formatIndianCount(report.totalQuantity)} · Disc: ${formatIndianCurrency(report.totalDiscount)} (${report.discountPercentage}%)`}
                </span>
              </div>
            </div>
          ) : (
            /* ENTITY MODE HERO: Emerald Sales Cards vs Cyan Finance Cards */
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3.5">
              <div
                className={`rounded-xl p-3 border ${
                  isFinanceMode
                    ? 'bg-cyan-950/25 border-cyan-500/30'
                    : 'bg-emerald-950/25 border-emerald-500/30'
                }`}
              >
                <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider block">
                  {isFinanceMode ? 'Total Loan Amount' : 'Gross Sales Amount'}
                </span>
                <div className="text-lg sm:text-xl font-bold text-white font-mono mt-0.5">
                  {formatIndianCurrency(report.totalAmount)}
                </div>
                <span
                  className={`text-[10px] font-mono block mt-0.5 ${
                    isFinanceMode ? 'text-cyan-300' : 'text-emerald-400'
                  }`}
                >
                  {isFinanceMode ? 'Total Financed Value (Get)' : 'Gross Normal + Financed'}
                </span>
              </div>

              {isFinanceMode ? (
                <div className="bg-slate-800/60 border border-cyan-500/20 rounded-xl p-3">
                  <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider block">
                    Total Login Count
                  </span>
                  <div className="text-lg sm:text-xl font-bold text-cyan-300 font-mono mt-0.5">
                    {formatIndianCount(report.recordCount)}
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono block mt-0.5">
                    SUM of Count Column
                  </span>
                </div>
              ) : (
                <div className="bg-slate-800/60 border border-emerald-500/20 rounded-xl p-3">
                  <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider block">
                    Total Quantity
                  </span>
                  <div className="text-lg sm:text-xl font-bold text-emerald-300 font-mono mt-0.5">
                    {formatIndianCount(report.totalQuantity)}
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono block mt-0.5">
                    Units / Volume Sold
                  </span>
                </div>
              )}

              {isFinanceMode ? (
                <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3">
                  <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider block">
                    Total Qty
                  </span>
                  <div className="text-lg sm:text-xl font-bold text-amber-300 font-mono mt-0.5">
                    {formatIndianCount(report.totalQuantity)}
                  </div>
                  <span className="text-[10px] text-amber-400 font-mono block mt-0.5">
                    Financed Units
                  </span>
                </div>
              ) : (
                <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3">
                  <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider block">
                    Total Discount
                  </span>
                  <div className="text-lg sm:text-xl font-bold text-amber-300 font-mono mt-0.5">
                    {formatIndianCurrency(report.totalDiscount)}
                  </div>
                  <span className="text-[10px] text-amber-400 font-mono block mt-0.5">
                    {report.discountPercentage}% of Sales
                  </span>
                </div>
              )}

              <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3">
                <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider block">
                  {isFinanceMode ? 'Avg Loan Size' : 'Record Count & Ticket'}
                </span>
                <div className="text-lg sm:text-xl font-bold text-white font-mono mt-0.5">
                  {isFinanceMode
                    ? formatIndianCurrency(report.avgTicket)
                    : report.recordCount.toLocaleString('en-IN')}
                </div>
                <span className="text-[10px] text-slate-400 font-mono block mt-0.5">
                  {isFinanceMode
                    ? `${report.recordCount.toLocaleString('en-IN')} total logins`
                    : `Avg: ${formatIndianCurrency(report.avgTicket)} / row`}
                </span>
              </div>
            </div>
          )}

          {/* In Brand / Category Mode, lead directly with Financier Login Counts FIRST */}
          {(isBrandMode || isCategoryMode) && financierBreakdownBlock}

          {/* Side-by-Side Normal Sales vs Financed (Loan) Split Card */}
          {normalVsFinanceSplitBlock}

          {/* Cross-Linked Sales Summary (shown on Finance Report for GM / ASM / Store / Category / Brand) */}
          {!isBrandMode && report.salesSummary && (
            <div className="bg-emerald-950/25 border border-emerald-500/30 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-emerald-500/20">
                <h3 className="text-xs sm:text-sm font-semibold text-white flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Normal Sales Report Counterpart — {report.storeName}</span>
                </h3>
                <span className="text-[10px] font-mono text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 px-2 py-0.5 rounded-md">
                  Sales Report Sheet
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono">
                <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2.5">
                  <span className="text-[10px] text-slate-400 uppercase block font-sans">Gross Sales</span>
                  <span className="text-sm sm:text-base font-bold text-emerald-300">
                    {formatIndianCurrency(report.salesSummary.totalSalesAmount)}
                  </span>
                </div>
                <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2.5">
                  <span className="text-[10px] text-slate-400 uppercase block font-sans">Units Sold (Qty)</span>
                  <span className="text-sm sm:text-base font-bold text-white">
                    {formatIndianCount(report.salesSummary.totalQuantity)}
                  </span>
                </div>
                <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2.5">
                  <span className="text-[10px] text-slate-400 uppercase block font-sans">Discount</span>
                  <span className="text-sm sm:text-base font-bold text-amber-300">
                    {formatIndianCurrency(report.salesSummary.totalDiscount)}
                  </span>
                  <span className="text-[10px] text-slate-400 block">
                    {report.salesSummary.discountPercentage}% of sales
                  </span>
                </div>
                <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2.5">
                  <span className="text-[10px] text-slate-400 uppercase block font-sans">Finance Share</span>
                  <span className="text-sm sm:text-base font-bold text-cyan-300">
                    {report.salesSummary.financePenetrationPct !== null
                      ? `${report.salesSummary.financePenetrationPct}%`
                      : '—'}
                  </span>
                  <span className="text-[10px] text-slate-400 block">Loan / Sales</span>
                </div>
              </div>
            </div>
          )}

          {/* Cross-Linked Finance Summary (shown when clicking GM/ASM/Store on Sales Report) */}
          {!isBrandMode && report.financeSummary && (
            <div className="bg-cyan-950/25 border border-cyan-500/30 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-cyan-500/20">
                <h3 className="text-xs sm:text-sm font-semibold text-white flex items-center gap-2">
                  <Landmark className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>Finance Data Counterpart — {report.storeName}</span>
                </h3>
                <span className="text-[10px] font-mono text-cyan-300 bg-cyan-500/10 border border-cyan-500/25 px-2 py-0.5 rounded-md">
                  Finance Data Sheet
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono">
                <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2.5">
                  <span className="text-[10px] text-slate-400 uppercase block font-sans">Total Loan Amount</span>
                  <span className="text-sm sm:text-base font-bold text-cyan-300">
                    {formatIndianCurrency(report.financeSummary.totalLoanAmount)}
                  </span>
                </div>
                <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2.5">
                  <span className="text-[10px] text-slate-400 uppercase block font-sans">Finance Logins</span>
                  <span className="text-sm sm:text-base font-bold text-white">
                    {formatIndianCount(report.financeSummary.totalLoginCount)}
                  </span>
                </div>
                <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2.5">
                  <span className="text-[10px] text-slate-400 uppercase block font-sans">Avg Loan Size</span>
                  <span className="text-sm sm:text-base font-bold text-emerald-300">
                    {formatIndianCurrency(report.financeSummary.avgLoanSize)}
                  </span>
                </div>
                <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2.5">
                  <span className="text-[10px] text-slate-400 uppercase block font-sans">Finance Penetration</span>
                  <span className="text-sm sm:text-base font-bold text-amber-300">
                    {report.financeSummary.financeSharePct !== null
                      ? `${report.financeSummary.financeSharePct}%`
                      : '—'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* In Sales Report (Store/GM/ASM), render Financier logins after Normal/Finance split */}
          {!isBrandMode && !isCategoryMode && !isFinanceMode && financierBreakdownBlock}

          {/* Monthly Breakdown Table */}
          <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-700/60">
              <h3 className="text-xs sm:text-sm font-semibold text-white flex items-center gap-2">
                <Calendar className={`w-4 h-4 ${isFinanceMode ? 'text-cyan-400' : 'text-emerald-400'}`} />
                <span>
                  {isFinanceMode ? 'Monthly Loan Amount & Count Report' : 'Monthly Normal Sales and Discount Report'}
                </span>
              </h3>
              <span className="text-[10px] text-slate-400 font-mono">
                {report.monthlyBreakdown.length} Months Tracked
              </span>
            </div>

            {report.monthlyBreakdown.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-500">
                No monthly breakdown available.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    {isFinanceMode ? (
                      <tr className="text-[11px] text-slate-400 border-b border-slate-700/60 pb-1.5 font-medium">
                        <th className="py-2 pr-3">Month</th>
                        <th className="py-2 px-3 text-right">Loan Amount</th>
                        <th className="py-2 px-3 text-right">Count</th>
                        <th className="py-2 px-3 text-right">Qty</th>
                        <th className="py-2 pl-3 text-right">Avg Loan</th>
                      </tr>
                    ) : (
                      <tr className="text-[11px] text-slate-400 border-b border-slate-700/60 pb-1.5 font-medium">
                        <th className="py-2 pr-3">Month</th>
                        <th className="py-2 px-3 text-right">Sales Amount</th>
                        <th className="py-2 px-3 text-right">Discount</th>
                        <th className="py-2 px-3 text-right">Net Sales</th>
                        <th className="py-2 px-3 text-right">Disc %</th>
                        <th className="py-2 pl-3 text-right">Quantity</th>
                      </tr>
                    )}
                  </thead>
                  <tbody className="divide-y divide-slate-800 font-mono text-[11px]">
                    {report.monthlyBreakdown.map((m) => {
                      const net = m.amount - m.discount;
                      const avgLoan = m.count > 0 ? m.amount / m.count : 0;
                      return isFinanceMode ? (
                        <tr key={m.monthKey} className="hover:bg-slate-800/50 transition-colors">
                          <td className="py-2.5 pr-3 font-semibold text-slate-200">
                            {m.monthLabel}
                          </td>
                          <td className="py-2.5 px-3 text-right text-cyan-300 font-bold">
                            {formatIndianCurrency(m.amount)}
                          </td>
                          <td className="py-2.5 px-3 text-right text-emerald-300 font-semibold">
                            {m.count.toLocaleString('en-IN')}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-300">
                            {m.quantity.toLocaleString('en-IN')}
                          </td>
                          <td className="py-2.5 pl-3 text-right text-white">
                            {formatIndianCurrency(avgLoan)}
                          </td>
                        </tr>
                      ) : (
                        <tr key={m.monthKey} className="hover:bg-slate-800/50 transition-colors">
                          <td className="py-2.5 pr-3 font-semibold text-slate-200">
                            {m.monthLabel}
                          </td>
                          <td className="py-2.5 px-3 text-right text-emerald-400 font-bold">
                            {formatIndianCurrency(m.amount)}
                          </td>
                          <td className="py-2.5 px-3 text-right text-amber-300">
                            {formatIndianCurrency(m.discount)}
                          </td>
                          <td className="py-2.5 px-3 text-right text-white">
                            {formatIndianCurrency(net)}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-300">
                            {m.discountPercent}%
                          </td>
                          <td className="py-2.5 pl-3 text-right text-slate-400">
                            {m.quantity.toLocaleString('en-IN')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* For GM / ASM / Store on Finance Report, render Financier-wise Login Counts here as well */}
          {!isBrandMode && !isCategoryMode && isFinanceMode && financierBreakdownBlock}

          {/* Top Brands Breakdown (when viewing Financier / GM / ASM / Store / Category) */}
          {report.brandBreakdown && report.brandBreakdown.length > 0 && (
            <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-700/60">
                <h3 className="text-xs sm:text-sm font-semibold text-white flex items-center gap-2">
                  <Tag className="w-4 h-4 text-violet-400" />
                  <span>
                    {isFinanceMode ? 'Top Brands (Finance Count & Loan Amount)' : 'Top Brands (Sales & Volume)'}
                  </span>
                </h3>
                <span className="text-[10px] text-slate-400 font-mono">
                  Top {report.brandBreakdown.length} Brands
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {report.brandBreakdown.map((b, idx) => (
                  <div
                    key={b.name}
                    className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-700/50 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px] font-mono text-slate-400">#{idx + 1}</span>
                      <span className="font-semibold text-slate-100 truncate">{b.name}</span>
                    </div>
                    <div className="text-right font-mono shrink-0">
                      <span className="text-white font-bold block">
                        {isFinanceMode
                          ? `${b.count.toLocaleString('en-IN')} counts`
                          : formatIndianCurrency(b.amount)}
                      </span>
                      <span className="text-[10px] text-slate-400 block">
                        {isFinanceMode
                          ? `${formatIndianCurrency(b.amount)} · ${b.countPercentage}%`
                          : `${b.count.toLocaleString('en-IN')} rows · ${b.percentage}%`}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top Branches Breakdown (when inspecting Financier / GM / ASM / Brand / Category) */}
          {report.topBranchesBreakdown && report.topBranchesBreakdown.length > 0 && (
            <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-700/60">
                <h3 className="text-xs sm:text-sm font-semibold text-white flex items-center gap-2">
                  <Store className="w-4 h-4 text-emerald-400" />
                  <span>Top Branches for {report.storeName}</span>
                </h3>
                <span className="text-[10px] text-slate-400 font-mono">
                  Top {report.topBranchesBreakdown.length} Stores
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {report.topBranchesBreakdown.map((br, idx) => (
                  <div
                    key={br.name}
                    className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-700/50 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px] font-mono text-slate-400">#{idx + 1}</span>
                      <span className="font-semibold text-slate-100 truncate" title={br.name}>
                        {br.name}
                      </span>
                    </div>
                    <div className="text-right font-mono shrink-0">
                      <span className="text-emerald-300 font-bold block">
                        {formatIndianCurrency(br.amount)}
                      </span>
                      <span className="text-[10px] text-slate-400 block">
                        {br.count.toLocaleString('en-IN')} {isFinanceMode ? 'counts' : 'rows'} · {br.percentage}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Category-wise Breakdown */}
          <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-700/60">
              <h3 className="text-xs sm:text-sm font-semibold text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-cyan-400" />
                <span>
                  {isFinanceMode ? 'Category-wise Finance Count & Loan Breakdown' : 'Category-wise Sales Breakdown'}
                </span>
              </h3>
              <span className="text-[10px] text-slate-400 font-mono">
                {report.categoryBreakdown.length} Categories
              </span>
            </div>

            <div className="space-y-2.5">
              {report.categoryBreakdown.map((cat, idx) => {
                return (
                  <div
                    key={cat.category}
                    className="p-2.5 rounded-lg bg-slate-800/60 border border-slate-700/50 space-y-1.5"
                  >
                    <div className="flex items-center justify-between text-xs gap-2">
                      <div className="flex items-center gap-2 truncate">
                        <span className="text-[10px] font-mono text-slate-400">#{idx + 1}</span>
                        <span className="font-semibold text-slate-200 truncate">{cat.category}</span>
                      </div>
                      <div className="flex items-center gap-3 font-mono shrink-0">
                        <span className="text-slate-400 text-[11px]">{cat.percentage}%</span>
                        <span className="font-bold text-white text-xs">
                          {isFinanceMode
                            ? `${cat.count.toLocaleString('en-IN')} counts · ${formatIndianCurrency(cat.amount)}`
                            : formatIndianCurrency(cat.amount)}
                        </span>
                      </div>
                    </div>

                    <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          isFinanceMode ? 'bg-cyan-400' : 'bg-emerald-400'
                        }`}
                        style={{ width: `${Math.max(4, cat.percentage)}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono pt-0.5">
                      {isFinanceMode ? (
                        <>
                          <span>Count: {cat.count.toLocaleString('en-IN')}</span>
                          <span>Qty: {cat.quantity.toLocaleString('en-IN')} units</span>
                        </>
                      ) : (
                        <>
                          <span>Volume: {cat.quantity.toLocaleString('en-IN')} units</span>
                          <span>Discount: {formatIndianCurrency(cat.discount)}</span>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* All Parameters from Data Source */}
          <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-700/60">
              <h3 className="text-xs sm:text-sm font-semibold text-white flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-amber-400" />
                <span>All Parameters from Data Source</span>
              </h3>
              <span className="text-[10px] text-slate-400 font-mono">
                {report.allParameters.length} Numeric Parameters
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
              {report.allParameters.map((param) => (
                <div
                  key={param.name}
                  className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-2.5 space-y-1"
                >
                  <span className="text-[11px] text-slate-400 truncate block font-medium">
                    {param.name}
                  </span>
                  <div className="text-sm font-bold text-white font-mono tabular-nums">
                    {param.isCurrency
                      ? formatIndianCurrency(param.sum)
                      : param.sum.toLocaleString('en-IN')}
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono">
                    Avg: {param.isCurrency ? formatIndianCurrency(param.avg) : param.avg.toLocaleString('en-IN')} / entry
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Modal Bottom Actions */}
        <div className="p-3.5 sm:p-4 border-t border-slate-700/75 bg-[#101829]/95 flex items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-slate-400 font-mono truncate hidden sm:inline">
            {isBrandMode ? 'Brand Financier Matrix' : isFinanceMode ? 'Finance Loan Profile' : 'Normal Sales Profile'}: {report.storeName}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            {onApplyStoreFilter && report.storeName.toLowerCase() !== 'other' && (
              <button
                type="button"
                onClick={() => {
                  onApplyStoreFilter(report.storeName);
                  onClose();
                }}
                className={`px-3.5 py-1.5 font-semibold rounded-lg text-xs tactile-press flex items-center gap-1.5 shadow-sm cursor-pointer ${theme.filterBtn}`}
              >
                <Filter className="w-3.5 h-3.5" />
                <span>Filter Dashboard by this {entityLabel}</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs tactile-press cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};
