import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  BrainCircuit,
  TrendingUp,
  TrendingDown,
  Minus,
  Send,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  Target,
  Lightbulb,
  Zap,
  ChevronRight,
} from 'lucide-react';
import { matchPromptEntities, type SalesAnalyticsSnapshot } from '../utils/forecasting.ts';
import { formatIndianCurrency, formatIndianCount } from '../utils/aggregator.ts';
import { ActionPlanModal, type AIRecommendation } from './ActionPlanModal.tsx';

interface AIInsightItem {
  title: string;
  detail: string;
  sentiment: 'positive' | 'warning' | 'neutral' | string;
  metricValue: string;
}

interface AIMonthlyOutlook {
  monthLabel: string;
  predictedFormatted: string;
  rationale: string;
}

interface AIAnalysisResult {
  executiveAnswer: string;
  currentSalesInsights: AIInsightItem[];
  futurePredictions: {
    summary: string;
    trendDirection: 'up' | 'down' | 'stable' | string;
    confidenceLevel: 'High' | 'Medium' | 'Low' | string;
    growthDrivers: string[];
    riskFactors: string[];
    monthlyOutlook: AIMonthlyOutlook[];
  };
  actionableRecommendations: AIRecommendation[];
}

interface AISalesAdvisorProps {
  snapshot: SalesAnalyticsSnapshot;
}

const PRESET_QUESTIONS = [
  {
    id: 'full-forecast',
    label: 'Sales & 3-Mo Conversion Plan',
    prompt:
      'Analyze current sales performance, forecast the next 3 months, and provide high-ROI conversion plays to lift revenue.',
  },
  {
    id: 'branches',
    label: 'Top & Lagging Branches',
    prompt:
      'Compare our top-performing and underperforming entities and give a step-by-step execution plan to convert lagging volume.',
  },
  {
    id: 'discounts',
    label: 'Discount & Margin Recovery',
    prompt:
      'Identify where high discount rates are leaking margin and recommend targeted pricing/bundling tactics to lift net conversion.',
  },
  {
    id: 'gm-asm',
    label: 'GM & ASM Territory Review',
    prompt:
      'Evaluate GM and ASM territory shares, forecast next-quarter momentum, and prioritize manager conversion targets.',
  },
];

export const AISalesAdvisor: React.FC<AISalesAdvisorProps> = ({ snapshot }) => {
  const [question, setQuestion] = useState('');
  const [activePresetId, setActivePresetId] = useState<string>('full-forecast');
  const [loading, setLoading] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [responseMs, setResponseMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AIAnalysisResult | null>(null);
  const [lastAnalyzedKey, setLastAnalyzedKey] = useState<string>('');
  const [selectedPlan, setSelectedPlan] = useState<AIRecommendation | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const currentContextKey = `${snapshot.datasetName}|${snapshot.dateRangeLabel}|${snapshot.activeFiltersSummary}|${snapshot.metricCol}|${snapshot.totalRows}`;
  const isStale = Boolean(analysis && lastAnalyzedKey && lastAnalyzedKey !== currentContextKey);

  const promptMatches = React.useMemo(
    () => matchPromptEntities(question, snapshot, 4),
    [question, snapshot]
  );

  // Clear stale error when dataset changes
  useEffect(() => {
    setError(null);
  }, [snapshot.datasetName]);

  // Abort any pending AI call on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // Track elapsed seconds while request is running
  useEffect(() => {
    if (!loading) return;
    setElapsedSec(0);
    const id = window.setInterval(() => {
      setElapsedSec((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [loading]);

  const runAnalysis = async (promptText?: string, presetId?: string) => {
    if (snapshot.totalRows === 0) {
      setError('No rows match the active filters. Adjust filters or date range to analyze sales.');
      return;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const finalQuestion = (promptText ?? question).trim() || PRESET_QUESTIONS[0].prompt;
    if (presetId) setActivePresetId(presetId);
    setLoading(true);
    setError(null);

    const startedAt = performance.now();

    try {
      const res = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          snapshot,
          question: finalQuestion,
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
        throw new Error(
          payload?.error ||
            (res.status === 413
              ? 'Analytics payload was too large for the request limit. Please narrow your filter and retry.'
              : `AI request failed (HTTP ${res.status}). Please retry.`)
        );
      }

      if (!payload?.analysis) {
        throw new Error('Unexpected response structure from analysis service.');
      }

      setAnalysis(payload.analysis);
      setResponseMs(Math.round(performance.now() - startedAt));
      setLastAnalyzedKey(currentContextKey);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      setError(err?.message || 'Unable to complete AI analysis. Please try again.');
    } finally {
      if (abortControllerRef.current === controller) {
        setLoading(false);
      }
    }
  };

  const handleSubmitQuestion = (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() && !loading) {
      runAnalysis(PRESET_QUESTIONS[0].prompt, 'full-forecast');
      return;
    }
    setActivePresetId('custom');
    runAnalysis(question.trim());
  };

  const handleDeepDiveFromPlan = (rec: AIRecommendation) => {
    const deepPrompt = `Build a detailed conversion execution plan for ${rec.targetEntity}: focus on "${rec.headline || rec.action}", lifting average ticket size, optimizing discounts, and projecting the exact next-quarter upside.`;
    setSelectedPlan(null);
    setActivePresetId('custom');
    setQuestion(deepPrompt);
    runAnalysis(deepPrompt, 'custom');
  };

  const trendIcon =
    snapshot.trendDirection === 'up' ? (
      <TrendingUp className="w-4 h-4 text-emerald-400 shrink-0" />
    ) : snapshot.trendDirection === 'down' ? (
      <TrendingDown className="w-4 h-4 text-rose-400 shrink-0" />
    ) : (
      <Minus className="w-4 h-4 text-amber-400 shrink-0" />
    );

  return (
    <>
      <motion.section
        aria-labelledby="ai-advisor-heading"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
        className="bg-slate-900/85 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-5 overflow-hidden"
      >
        {/* Header Row */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-4 border-b border-slate-800/80">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-500/20 to-sky-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-300 shrink-0">
                <BrainCircuit className="w-4 h-4" />
              </div>
              <h2
                id="ai-advisor-heading"
                className="text-base sm:text-lg font-semibold text-white tracking-tight"
              >
                AI Sales Analyst & Conversion Forecast
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
              <span>{snapshot.datasetName}</span>
              <span aria-hidden="true">·</span>
              <span>{snapshot.dateRangeLabel}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-slate-300">
                {snapshot.totalRows.toLocaleString('en-IN')} rows
              </span>
              {snapshot.discountRatePercent > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums text-amber-300">
                    Disc: {snapshot.discountRatePercent}%
                  </span>
                </>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => runAnalysis(question.trim() || PRESET_QUESTIONS[0].prompt, activePresetId)}
            disabled={loading || snapshot.totalRows === 0}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 tactile-press shadow-sm shrink-0 whitespace-nowrap cursor-pointer"
          >
            {loading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Analyzing... {elapsedSec > 0 ? `(${elapsedSec}s)` : ''}</span>
              </>
            ) : (
              <>
                <BrainCircuit className="w-4 h-4" />
                <span>{analysis ? 'Refresh AI Forecast' : 'Analyze Sales & Forecast'}</span>
              </>
            )}
          </button>
        </div>

        {/* Deterministic 3-Month Statistical Forecast Baseline Strip */}
        {snapshot.forecasts.length > 0 && (
          <div className="space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs">
              <div className="flex items-center gap-2 text-slate-300 font-medium">
                {trendIcon}
                <span>3-Month Statistical Trajectory (Linear Trend Projection)</span>
              </div>
              <div className="flex items-center gap-2 text-slate-400 font-mono tabular-nums text-[11px]">
                {snapshot.momGrowthPercent !== null && (
                  <span>
                    Latest MoM:{' '}
                    <strong
                      className={
                        snapshot.momGrowthPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }
                    >
                      {snapshot.momGrowthPercent >= 0 ? '+' : ''}
                      {snapshot.momGrowthPercent}%
                    </strong>
                  </span>
                )}
                <span aria-hidden="true">·</span>
                <span>
                  Slope:{' '}
                  <strong
                    className={
                      snapshot.overallTrendPercent >= 0 ? 'text-sky-400' : 'text-amber-400'
                    }
                  >
                    {snapshot.overallTrendPercent >= 0 ? '+' : ''}
                    {snapshot.overallTrendPercent}% / mo
                  </strong>
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {snapshot.forecasts.map((fc, idx) => {
                const cardGradients = [
                  'bg-slate-950/90 border-emerald-500/35 border-t-2 border-t-emerald-400/80',
                  'bg-slate-950/90 border-sky-500/35 border-t-2 border-t-sky-400/80',
                  'bg-slate-950/90 border-violet-500/35 border-t-2 border-t-violet-400/80',
                ];
                const labelColors = ['text-emerald-300', 'text-sky-300', 'text-violet-300'];

                return (
                  <div
                    key={fc.period}
                    className={`${cardGradients[idx % 3]} border rounded-xl p-3 sm:p-3.5 flex flex-col justify-between`}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className={`font-semibold ${labelColors[idx % 3]}`}>
                        {fc.label}
                      </span>
                      <span className="text-[11px] font-mono tabular-nums text-slate-400">
                        Month +{idx + 1} Forecast
                      </span>
                    </div>
                    <div className="mt-1.5 text-lg sm:text-xl font-bold text-white font-mono tabular-nums">
                      {fc.formattedValue}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-400 font-mono tabular-nums truncate">
                      Range:{' '}
                      {snapshot.isCurrency
                        ? `${formatIndianCurrency(fc.lowerBound)} – ${formatIndianCurrency(fc.upperBound)}`
                        : `${formatIndianCount(fc.lowerBound)} – ${formatIndianCount(fc.upperBound)}`}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Deterministic Conversion Signals Strip */}
        {snapshot.conversionSignals && snapshot.conversionSignals.length > 0 && (
          <div className="bg-slate-950/60 border border-slate-800/90 rounded-xl p-3 sm:p-3.5 space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-sky-300 flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                Live Conversion Signals (Grounded in Filtered Data)
              </span>
              <span className="text-[11px] font-mono text-slate-400 hidden sm:inline">
                Avg Ticket: {snapshot.avgTicketFormatted}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {snapshot.conversionSignals.map((sig, i) => (
                <div
                  key={i}
                  className="text-xs text-slate-300 leading-relaxed flex items-start gap-2 bg-slate-900/70 border border-slate-800/70 rounded-lg px-2.5 py-2"
                >
                  <span className="text-emerald-400 font-mono font-bold mt-0.5 shrink-0">•</span>
                  <span>{sig}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Interactive Question Bar & Quick Topic Presets */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5">
            {PRESET_QUESTIONS.map((preset) => {
              const isActive = activePresetId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setQuestion(preset.prompt);
                    runAnalysis(preset.prompt, preset.id);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium tactile-press whitespace-nowrap shrink-0 border cursor-pointer ${
                    isActive
                      ? 'bg-slate-800 text-white border-emerald-500/40'
                      : 'bg-slate-950/70 text-slate-300 hover:text-white border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          <form onSubmit={handleSubmitQuestion} className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <label htmlFor="ai-sales-question" className="sr-only">
                Ask a question about current sales or future conversion predictions
              </label>
              <input
                id="ai-sales-question"
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask about conversion drivers, discount leaks, lagging branches, or next-quarter outlook..."
                className="w-full bg-slate-950/80 border border-slate-800 focus:border-emerald-500/60 focus:outline-none text-white rounded-xl px-3.5 py-2.5 text-xs sm:text-sm placeholder:text-slate-500 transition-colors"
              />
            </div>
            <button
              type="submit"
              disabled={loading || snapshot.totalRows === 0}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white text-xs sm:text-sm font-medium border border-slate-700 transition-colors shrink-0 whitespace-nowrap cursor-pointer"
            >
              <Send className="w-3.5 h-3.5 text-emerald-400" />
              <span>Ask AI</span>
            </button>
          </form>

          {promptMatches.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-300">
              <span className="text-slate-400">Matched in sheet:</span>
              {promptMatches.map((m) => (
                <span
                  key={`${m.matchedType}-${m.name}`}
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 font-mono"
                >
                  <span className="truncate max-w-[220px]">{m.name}</span>
                  <span className="text-emerald-400 font-semibold">{m.formattedValue}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Stale Filter Notice */}
        {isStale && !loading && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
            <span>Filters or dataset changed since the last AI analysis.</span>
            <button
              type="button"
              onClick={() => runAnalysis(question.trim() || PRESET_QUESTIONS[0].prompt, activePresetId)}
              className="text-xs font-semibold text-amber-300 hover:text-white underline underline-offset-2 self-start sm:self-auto cursor-pointer"
            >
              Re-analyze updated view
            </button>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div
            role="alert"
            className="rounded-xl bg-rose-950/40 border border-rose-500/40 p-3.5 sm:p-4 flex items-start gap-3 text-xs sm:text-sm text-rose-200"
          >
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="flex-1 space-y-1">
              <div className="font-semibold text-rose-100">AI Analysis Notice</div>
              <p className="text-rose-200/90 leading-relaxed">{error}</p>
            </div>
            <button
              type="button"
              onClick={() => runAnalysis(question.trim() || PRESET_QUESTIONS[0].prompt, activePresetId)}
              className="px-3 py-1 rounded-lg bg-rose-900/60 hover:bg-rose-800/70 text-rose-100 text-xs font-medium border border-rose-500/30 shrink-0 cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading Skeleton */}
        {loading && (
          <div className="space-y-3 animate-pulse" aria-busy="true">
            <div className="h-20 bg-slate-800/60 rounded-xl" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="h-28 bg-slate-800/50 rounded-xl" />
              <div className="h-28 bg-slate-800/50 rounded-xl" />
            </div>
          </div>
        )}

        {/* AI Generated Executive Report */}
        {!loading && analysis && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-5 pt-2 border-t border-slate-800/80"
          >
            {/* 1. Direct Executive Answer */}
            <div className="bg-gradient-to-br from-slate-950/90 to-slate-900/90 border border-emerald-500/25 rounded-xl p-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-emerald-300 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  AI Direct Answer & Sales Summary
                </span>
                <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono">
                  {responseMs !== null && (
                    <span>{(responseMs / 1000).toFixed(1)}s</span>
                  )}
                  {responseMs !== null && <span aria-hidden="true">·</span>}
                  <span>Confidence: {analysis.futurePredictions?.confidenceLevel || 'Medium'}</span>
                </div>
              </div>
              <p className="text-xs sm:text-sm text-slate-100 leading-relaxed whitespace-pre-line">
                {analysis.executiveAnswer}
              </p>
            </div>

            {/* 2. Current Sales Insights Grid */}
            {analysis.currentSalesInsights?.length > 0 && (
              <div className="space-y-2.5">
                <h3 className="text-xs sm:text-sm font-semibold text-slate-200 flex items-center gap-1.5">
                  <Lightbulb className="w-4 h-4 text-amber-400" />
                  Current Sales Diagnostics
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {analysis.currentSalesInsights.map((item, idx) => {
                    const tone =
                      item.sentiment === 'positive'
                        ? 'border-emerald-500/25 bg-emerald-500/5'
                        : item.sentiment === 'warning'
                        ? 'border-amber-500/30 bg-amber-500/5'
                        : 'border-sky-500/25 bg-sky-500/5';
                    const metricColor =
                      item.sentiment === 'positive'
                        ? 'text-emerald-300'
                        : item.sentiment === 'warning'
                        ? 'text-amber-300'
                        : 'text-sky-300';

                    return (
                      <div key={idx} className={`rounded-xl border p-3.5 space-y-1.5 ${tone}`}>
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="text-xs sm:text-sm font-semibold text-white">
                            {item.title}
                          </h4>
                          <span
                            className={`text-xs font-mono font-bold tabular-nums shrink-0 ${metricColor}`}
                          >
                            {item.metricValue}
                          </span>
                        </div>
                        <p className="text-xs text-slate-300 leading-relaxed">{item.detail}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 3. Future Predictions & Drivers */}
            {analysis.futurePredictions && (
              <div className="space-y-3 bg-slate-950/60 border border-slate-800 rounded-xl p-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <h3 className="text-xs sm:text-sm font-semibold text-white flex items-center gap-1.5">
                    <TrendingUp className="w-4 h-4 text-sky-400" />
                    Future Sales Outlook & Monthly Rationale
                  </h3>
                  <span className="text-xs text-slate-400">
                    Projected Trend:{' '}
                    <strong className="text-sky-300 capitalize">
                      {analysis.futurePredictions.trendDirection}
                    </strong>
                  </span>
                </div>

                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                  {analysis.futurePredictions.summary}
                </p>

                {analysis.futurePredictions.monthlyOutlook?.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-1">
                    {analysis.futurePredictions.monthlyOutlook.map((m, i) => (
                      <div
                        key={i}
                        className="rounded-xl bg-slate-900/90 border border-slate-800 p-3 space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-sky-300">{m.monthLabel}</span>
                          <span className="text-xs sm:text-sm font-bold font-mono tabular-nums text-white">
                            {m.predictedFormatted}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 leading-relaxed">{m.rationale}</p>
                      </div>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                  {analysis.futurePredictions.growthDrivers?.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-xs font-semibold text-emerald-300">Growth Drivers</div>
                      <ul className="space-y-1 text-xs text-slate-300">
                        {analysis.futurePredictions.growthDrivers.map((d, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="text-emerald-400 mt-0.5">+</span>
                            <span>{d}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {analysis.futurePredictions.riskFactors?.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-xs font-semibold text-amber-300">Watch-Out Risks</div>
                      <ul className="space-y-1 text-xs text-slate-300">
                        {analysis.futurePredictions.riskFactors.map((r, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="text-amber-400 mt-0.5">!</span>
                            <span>{r}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 4. Clickable Actionable Growth Plan */}
            {analysis.actionableRecommendations?.length > 0 && (
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs sm:text-sm font-semibold text-slate-200 flex items-center gap-1.5">
                    <Target className="w-4 h-4 text-emerald-400" />
                    Actionable Growth Plan
                  </h3>
                  <span className="text-[11px] text-slate-400">
                    Click any plan to view step-by-step execution playbook
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {analysis.actionableRecommendations.map((rec, idx) => {
                    const isHigh = String(rec.priority).toLowerCase() === 'high';
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setSelectedPlan(rec)}
                        className="group text-left w-full rounded-xl bg-slate-950/75 hover:bg-slate-900 border border-slate-800 hover:border-emerald-500/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 p-3.5 sm:p-4 space-y-2 tactile-press cursor-pointer flex flex-col justify-between"
                      >
                        <div className="space-y-1.5 w-full">
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="font-mono text-[11px] text-slate-400 truncate">
                              {rec.targetEntity}
                              {rec.timeframe ? ` · ${rec.timeframe}` : ''}
                            </span>
                            <span
                              className={`font-mono text-[11px] font-semibold shrink-0 ${
                                isHigh ? 'text-rose-300' : 'text-sky-300'
                              }`}
                            >
                              {rec.priority} Priority
                            </span>
                          </div>

                          <div className="text-xs sm:text-sm font-semibold text-white group-hover:text-emerald-200 transition-colors leading-snug">
                            {rec.headline || rec.action}
                          </div>

                          {rec.headline && (
                            <p className="text-xs text-slate-400 leading-relaxed line-clamp-2">
                              {rec.action}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800/80 w-full text-[11px]">
                          <span className="flex items-center gap-1.5 text-emerald-300 font-medium min-w-0 truncate">
                            <ArrowRight className="w-3 h-3 shrink-0" />
                            <span className="truncate">{rec.expectedImpact}</span>
                          </span>
                          <span className="inline-flex items-center gap-1 text-slate-300 group-hover:text-emerald-300 font-semibold shrink-0 whitespace-nowrap">
                            <span>View Execution Plan</span>
                            <ChevronRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </motion.section>

      <AnimatePresence>
        {Boolean(selectedPlan) && (
          <ActionPlanModal
            key="ai-action-plan-modal"
            isOpen={Boolean(selectedPlan)}
            onClose={() => setSelectedPlan(null)}
            recommendation={selectedPlan}
            snapshot={snapshot}
            onDeepDive={handleDeepDiveFromPlan}
          />
        )}
      </AnimatePresence>
    </>
  );
};

