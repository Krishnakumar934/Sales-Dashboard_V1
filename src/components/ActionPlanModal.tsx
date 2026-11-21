import React, { useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import {
  X,
  Target,
  TrendingUp,
  CheckCircle2,
  ShieldAlert,
  Clock,
  UserCheck,
  Sparkles,
  ArrowRight,
  ListChecks,
} from 'lucide-react';
import type { SalesAnalyticsSnapshot } from '../utils/forecasting.ts';

export interface AIRecommendation {
  priority: 'High' | 'Medium' | string;
  targetEntity: string;
  headline?: string;
  action: string;
  expectedImpact: string;
  conversionStrategy?: string;
  executionSteps?: string[];
  kpiTarget?: string;
  ownerRole?: string;
  timeframe?: string;
  riskMitigation?: string;
}

interface ActionPlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  recommendation: AIRecommendation | null;
  snapshot: SalesAnalyticsSnapshot;
  onDeepDive?: (rec: AIRecommendation) => void;
}

interface MatchedEntityTelemetry {
  label: string;
  salesFormatted: string;
  shareOrCount: string;
  discountInfo?: string;
  avgTicket?: string;
  hierarchy?: string;
}

function findMatchedTelemetry(
  targetEntity: string,
  snapshot: SalesAnalyticsSnapshot
): MatchedEntityTelemetry | null {
  const needle = (targetEntity || '').trim().toLowerCase();
  if (!needle) return null;

  const matches = (candidate?: string) => {
    if (!candidate) return false;
    const c = candidate.trim().toLowerCase();
    return c === needle || needle.includes(c) || c.includes(needle);
  };

  const entity = [...(snapshot.topEntities || []), ...(snapshot.bottomEntities || [])].find((e) =>
    matches(e.name)
  );
  if (entity) {
    const hierarchyParts = [
      entity.gm ? `GM: ${entity.gm}` : null,
      entity.asm ? `ASM: ${entity.asm}` : null,
    ].filter(Boolean);
    return {
      label: entity.name,
      salesFormatted: entity.formattedValue,
      shareOrCount: `${entity.sharePercent}% share · ${entity.count.toLocaleString('en-IN')} rows`,
      discountInfo: `${entity.discountRatePercent}%`,
      avgTicket: entity.avgTicketFormatted,
      hierarchy: hierarchyParts.length > 0 ? hierarchyParts.join(' · ') : undefined,
    };
  }

  const highDisc = (snapshot.highDiscountEntities || []).find((e) => matches(e.name));
  if (highDisc) {
    return {
      label: highDisc.name,
      salesFormatted: highDisc.formattedValue,
      shareOrCount: `Discount: ${highDisc.formattedDiscount}`,
      discountInfo: `${highDisc.discountRatePercent}%`,
    };
  }

  const slice = [
    ...(snapshot.gmShares || []),
    ...(snapshot.asmShares || []),
    ...(snapshot.categoryShares || []),
  ].find((s) => matches(s.name));
  if (slice) {
    return {
      label: slice.name,
      salesFormatted: slice.formattedValue,
      shareOrCount: `${slice.percentage}% share · ${slice.count.toLocaleString('en-IN')} rows`,
    };
  }

  return null;
}

export const ActionPlanModal: React.FC<ActionPlanModalProps> = ({
  isOpen,
  onClose,
  recommendation,
  snapshot,
  onDeepDive,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const telemetry = useMemo(() => {
    if (!recommendation) return null;
    return findMatchedTelemetry(recommendation.targetEntity, snapshot);
  }, [recommendation, snapshot]);

  if (!isOpen || !recommendation) return null;

  const isHigh = String(recommendation.priority).toLowerCase() === 'high';
  const steps =
    recommendation.executionSteps && recommendation.executionSteps.length > 0
      ? recommendation.executionSteps
      : [
          `Audit current sales funnel and transaction conversion baseline for ${recommendation.targetEntity}.`,
          recommendation.action,
          `Track weekly conversion rate and average ticket movement against ${recommendation.expectedImpact}.`,
        ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="action-plan-modal-title"
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
        className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 bg-slate-950/70 flex items-start justify-between gap-3 shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5 border ${
                isHigh
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                  : 'bg-sky-500/10 border-sky-500/30 text-sky-300'
              }`}
            >
              <Target className="w-5 h-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
                <span
                  className={`font-semibold uppercase tracking-wide px-2 py-0.5 rounded-md border ${
                    isHigh
                      ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                      : 'bg-sky-500/10 border-sky-500/30 text-sky-300'
                  }`}
                >
                  {recommendation.priority} Priority
                </span>
                <span className="text-slate-300 bg-slate-800/80 border border-slate-700/60 px-2 py-0.5 rounded-md truncate max-w-[220px] sm:max-w-xs">
                  Target: {recommendation.targetEntity}
                </span>
              </div>

              <h2
                id="action-plan-modal-title"
                className="text-base sm:text-lg font-bold text-white leading-snug"
              >
                {recommendation.headline || recommendation.targetEntity}
              </h2>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                <span className="inline-flex items-center gap-1">
                  <UserCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>{recommendation.ownerRole || 'Branch / Territory Lead'}</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  <span>{recommendation.timeframe || 'Next 30–60 Days'}</span>
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close execution plan"
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors shrink-0 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1">
          {/* Matched Live Entity Snapshot Telemetry */}
          {telemetry && (
            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                <span className="font-semibold text-slate-300">
                  Live Snapshot Baseline — {telemetry.label}
                </span>
                {telemetry.hierarchy && <span className="font-mono">{telemetry.hierarchy}</span>}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
                <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2.5">
                  <span className="text-[10px] uppercase tracking-wider text-slate-400 block">
                    Current Performance
                  </span>
                  <span className="font-mono font-bold text-white text-sm mt-0.5 block">
                    {telemetry.salesFormatted}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono block truncate">
                    {telemetry.shareOrCount}
                  </span>
                </div>

                {telemetry.discountInfo && (
                  <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2.5">
                    <span className="text-[10px] uppercase tracking-wider text-slate-400 block">
                      Discount Profile
                    </span>
                    <span className="font-mono font-bold text-amber-300 text-sm mt-0.5 block">
                      {telemetry.discountInfo}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono block">
                      Portfolio Avg: {snapshot.discountRatePercent}%
                    </span>
                  </div>
                )}

                {telemetry.avgTicket && (
                  <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2.5">
                    <span className="text-[10px] uppercase tracking-wider text-slate-400 block">
                      Avg Ticket / Entry
                    </span>
                    <span className="font-mono font-bold text-emerald-300 text-sm mt-0.5 block">
                      {telemetry.avgTicket}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono block">
                      Portfolio Avg: {snapshot.avgTicketFormatted}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Expected Conversion Impact Banner */}
          <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3.5 flex items-start gap-2.5">
            <TrendingUp className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5 min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
                Expected Conversion Impact
              </div>
              <p className="text-xs sm:text-sm font-medium text-white leading-relaxed">
                {recommendation.expectedImpact}
              </p>
            </div>
          </div>

          {/* Core Action & Conversion Strategy */}
          <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-4 space-y-2.5">
            <h3 className="text-xs sm:text-sm font-semibold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-sky-400 shrink-0" />
              <span>Conversion Strategy & Core Action</span>
            </h3>
            <p className="text-xs sm:text-sm text-slate-200 leading-relaxed">
              {recommendation.action}
            </p>
            {recommendation.conversionStrategy && (
              <p className="text-xs text-slate-300 leading-relaxed pt-2 border-t border-slate-700/60">
                {recommendation.conversionStrategy}
              </p>
            )}
          </div>

          {/* Step-by-Step Execution Playbook */}
          <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs sm:text-sm font-semibold text-white flex items-center gap-2">
                <ListChecks className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Step-by-Step Execution Playbook</span>
              </h3>
              <span className="text-[11px] font-mono text-slate-400">
                {steps.length} Action Steps
              </span>
            </div>

            <ol className="space-y-2.5">
              {steps.map((step, idx) => (
                <li
                  key={idx}
                  className="flex items-start gap-3 p-2.5 rounded-lg bg-slate-900/70 border border-slate-800/90"
                >
                  <span className="w-6 h-6 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-mono text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                    {idx + 1}
                  </span>
                  <span className="text-xs sm:text-sm text-slate-200 leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* Success KPI & Risk Guardrail */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 space-y-1.5">
              <div className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>Success KPI Target</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                {recommendation.kpiTarget ||
                  `Deliver ${recommendation.expectedImpact} while holding net margin above portfolio baseline.`}
              </p>
            </div>

            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 space-y-1.5">
              <div className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                <span>Risk Mitigation Guardrail</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                {recommendation.riskMitigation ||
                  'Monitor discount % weekly alongside conversion rate so ticket volume gains do not dilute realized margin.'}
              </p>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-3.5 sm:p-4 border-t border-slate-800 bg-slate-950/80 flex flex-wrap items-center justify-between gap-2.5 shrink-0">
          {onDeepDive && (
            <button
              type="button"
              onClick={() => onDeepDive(recommendation)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs tactile-press cursor-pointer"
            >
              <span>Ask AI Deeper on This Target</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 tactile-press cursor-pointer"
          >
            Close
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};
