import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Users2, UserCheck, Landmark, Layers, Tag, ChevronRight } from 'lucide-react';
import type { DimensionSlice } from '../types/data.ts';
import { formatIndianCurrency, formatIndianCount } from '../utils/aggregator.ts';

interface GMAndASMShareChartsProps {
  gmShares: DimensionSlice[];
  asmShares: DimensionSlice[];
  financierShares?: DimensionSlice[];
  categoryCountShares?: DimensionSlice[];
  brandCountShares?: DimensionSlice[];
  financierColName?: string;
  gmColName?: string;
  asmColName?: string;
  categoryColName?: string;
  brandColName?: string;
  onSelectEntity?: (dimensionCol: string, entityName: string, excludeNames?: string[]) => void;
  isFinance?: boolean;
  metricName?: string;
  isMobileFrame?: boolean;
}

const PALETTE = [
  '#059669', // emerald
  '#0284c7', // sky
  '#6366f1', // indigo
  '#d97706', // amber
  '#db2777', // pink
  '#0d9488', // teal
  '#7c3aed', // violet
  '#64748b', // slate
];

type PanelVariant = 'normal-sales' | 'finance-lender' | 'finance-entity' | 'brand-matrix';

const VARIANT_STYLES: Record<
  PanelVariant,
  {
    cardAccent: string;
    badgeText: string;
    badgeClass: string;
    hoverArrow: string;
    ctaLabel: string;
  }
> = {
  'normal-sales': {
    cardAccent: 'border-slate-800 border-t-2 border-t-emerald-500/70',
    badgeText: 'Normal Sales',
    badgeClass: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
    hoverArrow: 'group-hover:text-emerald-300',
    ctaLabel: 'Click card → Normal Sales + Finance Split',
  },
  'finance-lender': {
    cardAccent: 'border-slate-800 border-t-2 border-t-amber-400/75',
    badgeText: 'Lender Loans',
    badgeClass: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
    hoverArrow: 'group-hover:text-amber-300',
    ctaLabel: 'Click card → Lender Loan Portfolio',
  },
  'finance-entity': {
    cardAccent: 'border-slate-800 border-t-2 border-t-cyan-400/75',
    badgeText: 'Finance + Sales Split',
    badgeClass: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/30',
    hoverArrow: 'group-hover:text-cyan-300',
    ctaLabel: 'Click card → Finance vs Normal Sales',
  },
  'brand-matrix': {
    cardAccent: 'border-violet-500/25 border-t-2 border-t-violet-400/80',
    badgeText: 'Brand → Financier Logins',
    badgeClass: 'text-violet-300 bg-violet-500/15 border-violet-400/35',
    hoverArrow: 'group-hover:text-violet-300',
    ctaLabel: 'Click Brand → Financier Login Matrix',
  },
};

interface DonutStackedCardProps {
  title: string;
  subtitle: string;
  data: DimensionSlice[];
  icon: React.ReactNode;
  primaryMode?: 'value' | 'count';
  variant?: PanelVariant;
  onSelectSlice?: (entityName: string, excludeNames?: string[]) => void;
  isMobileFrame?: boolean;
  cardIndex?: number;
}

const DonutStackedCard: React.FC<DonutStackedCardProps> = ({
  title,
  subtitle,
  data,
  icon,
  primaryMode = 'value',
  variant = 'normal-sales',
  onSelectSlice,
  isMobileFrame = false,
  cardIndex = 0,
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const vStyle = VARIANT_STYLES[variant];

  if (!data || data.length === 0) {
    return (
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 text-center text-slate-400 text-xs">
        No distribution data for {title}.
      </div>
    );
  }

  const isCountPrimary = primaryMode === 'count';
  const totalValue = data.reduce((sum, d) => sum + d.value, 0);
  const totalCount = data.reduce((sum, d) => sum + d.count, 0);
  const concreteNames = data
    .filter((d) => d.category.toLowerCase() !== 'other')
    .map((d) => d.category);

  const size = 180;
  const strokeWidth = 22;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  let currentOffset = 0;
  const segments = data.map((slice, i) => {
    const pct = isCountPrimary
      ? slice.countPercentage ?? (totalCount > 0 ? (slice.count / totalCount) * 100 : 0)
      : slice.percentage;
    const strokeDash = (pct / 100) * circumference;
    const offset = -currentOffset;
    currentOffset += strokeDash;
    return {
      slice,
      pct: Number(pct.toFixed(1)),
      color: PALETTE[i % PALETTE.length],
      strokeDasharray: `${strokeDash} ${circumference - strokeDash}`,
      strokeDashoffset: offset,
    };
  });

  const activeSlice = hoverIdx !== null ? segments[hoverIdx] : null;

  const handleCardClick = (category: string) => {
    if (!onSelectSlice) return;
    if (category.toLowerCase() === 'other') {
      onSelectSlice(category, concreteNames);
    } else {
      onSelectSlice(category);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: Math.min(cardIndex * 0.05, 0.2), ease: [0.16, 1, 0.3, 1] }}
      className={`bg-slate-900/80 border rounded-2xl p-3.5 sm:p-5 overflow-hidden flex flex-col justify-between shadow-xs w-full ${vStyle.cardAccent}`}
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800/80 mb-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm sm:text-base font-semibold text-white flex items-center gap-2">
              {icon}
              <span>{title}</span>
            </h3>
            <span className={`text-[10px] font-mono font-semibold border px-2 py-0.5 rounded-md ${vStyle.badgeClass}`}>
              {vStyle.badgeText}
            </span>
          </div>
          <span className="text-[11px] text-slate-400 block mt-0.5">
            {subtitle}
            {onSelectSlice ? ` · ${vStyle.ctaLabel}` : ''}
          </span>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
          <span className="text-[10px] font-mono text-slate-300 bg-slate-950/70 border border-slate-800 px-2.5 py-0.5 rounded-lg">
            {formatIndianCount(totalCount)} total counts
          </span>
          <span className="text-[10px] font-mono font-bold text-white bg-slate-800 border border-slate-700 px-2.5 py-0.5 rounded-lg">
            {formatIndianCurrency(totalValue)}
          </span>
        </div>
      </div>

      {/* Donut and Legend */}
      <div
        className={`flex items-center gap-5 sm:gap-6 justify-between w-full ${
          isMobileFrame ? 'flex-col' : 'flex-col lg:flex-row'
        }`}
      >
        <div className="relative w-44 h-44 sm:w-48 sm:h-48 shrink-0 flex items-center justify-center mx-auto my-1">
          <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full -rotate-90">
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="#1e293b"
              strokeWidth={strokeWidth}
            />

            {segments.map((seg, i) => {
              const isHovered = hoverIdx === i;
              const isDimmed = hoverIdx !== null && !isHovered;
              return (
                <circle
                  key={seg.slice.category}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth={isHovered ? strokeWidth + 5 : strokeWidth}
                  strokeDasharray={seg.strokeDasharray}
                  strokeDashoffset={seg.strokeDashoffset}
                  style={{ opacity: isDimmed ? 0.36 : 1 }}
                  className="transition-all duration-200 cursor-pointer"
                  onMouseEnter={() => setHoverIdx(i)}
                  onMouseLeave={() => setHoverIdx(null)}
                  onClick={() => handleCardClick(seg.slice.category)}
                />
              );
            })}
          </svg>

          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center px-2">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={activeSlice ? activeSlice.slice.category : 'total'}
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.94 }}
                transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                className="flex flex-col items-center"
              >
                <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold truncate max-w-[120px]">
                  {activeSlice ? activeSlice.slice.category : isCountPrimary ? 'TOTAL COUNTS' : 'TOTAL SHARE'}
                </span>
                <span className="text-sm sm:text-base font-bold text-white font-mono tabular-nums mt-0.5">
                  {activeSlice
                    ? isCountPrimary
                      ? `${formatIndianCount(activeSlice.slice.count)}`
                      : formatIndianCurrency(activeSlice.slice.value)
                    : isCountPrimary
                    ? `${formatIndianCount(totalCount)}`
                    : formatIndianCurrency(totalValue)}
                </span>
                <span className="text-xs font-mono font-medium text-slate-300 mt-0.5">
                  {activeSlice ? `${activeSlice.pct}%` : '100%'}
                </span>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        <div
          className={`grid gap-2 w-full flex-1 ${
            isMobileFrame ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'
          }`}
        >
          {segments.map((seg, idx) => {
            const { slice, pct, color } = seg;
            const isHovered = hoverIdx === idx;
            const barScale = Math.max(0.04, Math.min(1, pct / 100));

            return (
              <motion.button
                key={slice.category}
                type="button"
                whileTap={{ scale: 0.985 }}
                onMouseEnter={() => setHoverIdx(idx)}
                onMouseLeave={() => setHoverIdx(null)}
                onClick={() => handleCardClick(slice.category)}
                aria-label={`Inspect ${slice.category} summary in ${title}`}
                className={`w-full text-left p-2.5 rounded-xl border transition-colors cursor-pointer min-w-0 group ${
                  isHovered
                    ? 'bg-slate-800/90 border-slate-600 shadow-xs'
                    : 'bg-slate-950/60 border-slate-800 hover:border-slate-700/80'
                }`}
              >
                <div className="flex items-center justify-between text-xs gap-2 mb-1.5 min-w-0">
                  <div className="flex items-center gap-2 truncate min-w-0 flex-1">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0 shadow-xs transition-transform duration-150 group-hover:scale-125"
                      style={{ backgroundColor: color }}
                    />
                    <span
                      className={`truncate font-medium text-xs sm:text-sm transition-colors ${
                        isHovered ? 'text-white' : 'text-slate-200'
                      }`}
                      title={slice.category}
                    >
                      {slice.category}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 font-mono text-right">
                    <span className="text-slate-400 text-xs font-medium">{pct}%</span>
                    <span className="font-bold text-white text-xs tabular-nums">
                      {isCountPrimary
                        ? `${formatIndianCount(slice.count)} counts`
                        : formatIndianCurrency(slice.value)}
                    </span>
                    {onSelectSlice && (
                      <ChevronRight className={`w-3.5 h-3.5 text-slate-500 ${vStyle.hoverArrow} group-hover:translate-x-0.5 transition-all duration-150 shrink-0`} />
                    )}
                  </div>
                </div>

                <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden mb-1.5">
                  <motion.div
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: barScale }}
                    transition={{ duration: 0.36, delay: idx * 0.025, ease: [0.16, 1, 0.3, 1] }}
                    className="h-full w-full rounded-full"
                    style={{
                      transformOrigin: 'left',
                      backgroundColor: color,
                    }}
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono pt-0.5 min-w-0">
                  <span className="truncate">
                    {isCountPrimary
                      ? `Loan: ${formatIndianCurrency(slice.value)}`
                      : `Count: ${formatIndianCount(slice.count)}`}
                  </span>
                  <span className="truncate ml-2">
                    {variant === 'brand-matrix'
                      ? 'Financier Logins →'
                      : `Avg: ${formatIndianCurrency(slice.value / Math.max(slice.count, 1))}`}
                  </span>
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
};

export const GMAndASMShareCharts: React.FC<GMAndASMShareChartsProps> = ({
  gmShares,
  asmShares,
  financierShares,
  categoryCountShares,
  brandCountShares,
  financierColName = 'Financier',
  gmColName = 'GM',
  asmColName = 'ASM',
  categoryColName = 'Category',
  brandColName = 'Brand',
  onSelectEntity,
  isFinance = false,
  metricName = 'Amount',
  isMobileFrame = false,
}) => {
  const entityVariant: PanelVariant = isFinance ? 'finance-entity' : 'normal-sales';

  return (
    <div className="flex flex-col gap-4 sm:gap-5 w-full">
      {/* Finance-first Share of Financier */}
      {isFinance && financierShares && financierShares.length > 0 && (
        <DonutStackedCard
          title="Share of Financier (Loan Amount & Count)"
          subtitle={`Proportional financing breakdown across lenders in ${metricName}`}
          data={financierShares}
          icon={<Landmark className="w-4 h-4 text-amber-300" />}
          primaryMode="value"
          variant="finance-lender"
          onSelectSlice={
            onSelectEntity
              ? (name, exclude) => onSelectEntity(financierColName, name, exclude)
              : undefined
          }
          isMobileFrame={isMobileFrame}
          cardIndex={0}
        />
      )}

      {/* Share of GM */}
      <DonutStackedCard
        title="Share of GM (General Manager Portfolio)"
        subtitle={`Proportional breakdown by General Manager in ${metricName}`}
        data={gmShares}
        icon={<Users2 className={`w-4 h-4 ${isFinance ? 'text-cyan-300' : 'text-emerald-300'}`} />}
        primaryMode="value"
        variant={entityVariant}
        onSelectSlice={
          onSelectEntity ? (name, exclude) => onSelectEntity(gmColName, name, exclude) : undefined
        }
        isMobileFrame={isMobileFrame}
        cardIndex={1}
      />

      {/* Share of ASM */}
      <DonutStackedCard
        title="Share of ASM (Area Sales Manager Territories)"
        subtitle={`Proportional breakdown by Area Sales Manager in ${metricName}`}
        data={asmShares}
        icon={<UserCheck className={`w-4 h-4 ${isFinance ? 'text-cyan-300' : 'text-emerald-300'}`} />}
        primaryMode="value"
        variant={entityVariant}
        onSelectSlice={
          onSelectEntity ? (name, exclude) => onSelectEntity(asmColName, name, exclude) : undefined
        }
        isMobileFrame={isMobileFrame}
        cardIndex={2}
      />

      {/* Category Counts & Brand Counts Breakdown (Finance Report) */}
      {isFinance && categoryCountShares && categoryCountShares.length > 0 && (
        <DonutStackedCard
          title="Category Counts & Loan Amount"
          subtitle="Ranked by SUM(Count) across product categories with corresponding Loan Amount"
          data={categoryCountShares}
          icon={<Layers className="w-4 h-4 text-cyan-300" />}
          primaryMode="count"
          variant="finance-entity"
          onSelectSlice={
            onSelectEntity
              ? (name, exclude) => onSelectEntity(categoryColName, name, exclude)
              : undefined
          }
          isMobileFrame={isMobileFrame}
          cardIndex={3}
        />
      )}

      {isFinance && brandCountShares && brandCountShares.length > 0 && (
        <DonutStackedCard
          title="Brand Counts & Loan Amount"
          subtitle="Ranked by SUM(Count) across top brands with corresponding Financier login counts"
          data={brandCountShares}
          icon={<Tag className="w-4 h-4 text-violet-300" />}
          primaryMode="count"
          variant="brand-matrix"
          onSelectSlice={
            onSelectEntity
              ? (name, exclude) => onSelectEntity(brandColName, name, exclude)
              : undefined
          }
          isMobileFrame={isMobileFrame}
          cardIndex={4}
        />
      )}
    </div>
  );
};
