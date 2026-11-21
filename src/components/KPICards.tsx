import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowUpRight, ArrowDownRight, Minus, IndianRupee, Layers, Tag } from 'lucide-react';
import type { KPIMetric } from '../types/data.ts';

interface KPICardsProps {
  metrics: KPIMetric[];
  isMobileFrame?: boolean;
}

const AnimatedFormattedValue: React.FC<{ formattedValue: string }> = ({ formattedValue }) => {
  const [display, setDisplay] = useState(formattedValue);
  const prevNumericRef = useRef<number | null>(null);

  useEffect(() => {
    // Respect OS reduced-motion preference
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setDisplay(formattedValue);
      return;
    }

    // Extract prefix, numeric token, and suffix so Indian formatting (Cr/L/K/commas) preserves exact geometry
    const match = formattedValue.match(/^([^0-9-]*)(-?[\d,]+(?:\.\d+)?)(.*)$/);
    if (!match) {
      setDisplay(formattedValue);
      return;
    }

    const [, prefix, numRaw, suffix] = match;
    const targetNum = parseFloat(numRaw.replace(/,/g, ''));
    if (!Number.isFinite(targetNum)) {
      setDisplay(formattedValue);
      return;
    }

    const decimals = numRaw.includes('.') ? numRaw.split('.')[1].length : 0;
    const startNum = prevNumericRef.current !== null ? prevNumericRef.current : targetNum * 0.65;
    prevNumericRef.current = targetNum;

    if (Math.abs(targetNum - startNum) < 0.0001) {
      setDisplay(formattedValue);
      return;
    }

    let rafId = 0;
    const duration = 360;
    const startedAt = performance.now();

    const step = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      // Expo-out curve for crisp telemetry deceleration
      const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      const current = startNum + (targetNum - startNum) * eased;

      if (progress >= 1) {
        setDisplay(formattedValue);
        return;
      }

      const formattedNum =
        decimals > 0
          ? current.toLocaleString('en-IN', {
              minimumFractionDigits: decimals,
              maximumFractionDigits: decimals,
            })
          : Math.round(current).toLocaleString('en-IN');

      setDisplay(`${prefix}${formattedNum}${suffix}`);
      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [formattedValue]);

  return <>{display}</>;
};

export const KPICards: React.FC<KPICardsProps> = ({ metrics, isMobileFrame = false }) => {
  return (
    <div
      className={`grid gap-2.5 sm:gap-4 ${
        isMobileFrame ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3'
      }`}
    >
      {metrics.map((kpi, idx) => {
        const hasDelta = kpi.deltaPercent !== undefined;
        const isUp = (kpi.deltaPercent ?? 0) > 0;
        const isZero = kpi.deltaPercent === 0;

        // Metric identity
        const isAmount = kpi.id === 'kpi-amount' || idx === 0;
        const isQty = kpi.id === 'kpi-quantity' || idx === 1;

        return (
          <motion.div
            key={kpi.id}
            initial={{ opacity: 0, y: 10, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            whileHover={{ y: -2 }}
            transition={{
              duration: 0.28,
              delay: idx * 0.05,
              ease: [0.16, 1, 0.3, 1],
              y: { duration: 0.16, ease: [0.16, 1, 0.3, 1] },
            }}
            className={`bg-slate-900/80 border border-slate-800 hover:border-slate-700/90 rounded-2xl transition-colors shadow-xs flex flex-col justify-between ${
              isAmount
                ? 'col-span-2 sm:col-span-1 p-3.5 sm:p-5'
                : 'col-span-1 p-3.5 sm:p-5'
            }`}
          >
            <div>
              {/* Header Label and Icon */}
              <div className="flex items-center justify-between gap-1.5 mb-2">
                <span className="font-medium tracking-wide uppercase text-[11px] sm:text-xs text-slate-400 truncate">
                  {kpi.label}
                </span>
                <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-slate-950/70 border border-slate-800 text-slate-300 flex items-center justify-center shrink-0">
                  {isAmount ? (
                    <IndianRupee className="w-4 h-4 text-slate-300" />
                  ) : isQty ? (
                    <Layers className="w-3.5 h-3.5 text-slate-300" />
                  ) : (
                    <Tag className="w-3.5 h-3.5 text-slate-300" />
                  )}
                </div>
              </div>

              {/* Main Metric Value */}
              <div
                className={`font-bold tracking-tight text-white font-mono tabular-nums truncate ${
                  isAmount ? 'text-2xl sm:text-3xl' : 'text-xl sm:text-2xl'
                }`}
                title={kpi.formattedValue}
              >
                <AnimatedFormattedValue formattedValue={kpi.formattedValue} />
              </div>

              {/* Subtitle / aggregate detail */}
              {kpi.subValue && (
                <div
                  className="text-[11px] text-slate-400 font-mono truncate mt-1"
                  title={kpi.subValue}
                >
                  {kpi.subValue}
                </div>
              )}
            </div>

            {/* Delta vs Previous Period */}
            {hasDelta && (
              <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
                <div
                  className={`flex items-center gap-1 font-medium ${
                    isZero
                      ? 'text-slate-400'
                      : isUp
                      ? 'text-emerald-400'
                      : 'text-rose-400'
                  }`}
                >
                  {isZero ? (
                    <Minus className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  ) : isUp ? (
                    <ArrowUpRight className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  ) : (
                    <ArrowDownRight className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  )}
                  <span className="font-mono tabular-nums">
                    {isUp ? '+' : ''}
                    {kpi.deltaPercent}%
                  </span>
                </div>
                {kpi.formattedPreviousValue && (
                  <span className="text-slate-400 truncate text-[10px]">
                    vs {kpi.formattedPreviousValue}
                  </span>
                )}
              </div>
            )}
          </motion.div>
        );
      })}
    </div>
  );
};
