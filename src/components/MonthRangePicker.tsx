import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { X, Calendar, Check } from 'lucide-react';
import type { DateRangeFilter } from '../types/data.ts';
import { formatMonthLabel, getMonthSpan, getPreviousMonthRange } from '../utils/aggregator.ts';

interface MonthRangePickerProps {
  isOpen: boolean;
  onClose: () => void;
  availableMonths: string[];
  currentRange: DateRangeFilter;
  onApplyRange: (newRange: DateRangeFilter) => void;
}

function clampMonth(month: string, minMonth: string, maxMonth: string): string {
  if (month < minMonth) return minMonth;
  if (month > maxMonth) return maxMonth;
  return month;
}

export const MonthRangePicker: React.FC<MonthRangePickerProps> = ({
  isOpen,
  onClose,
  availableMonths,
  currentRange,
  onApplyRange,
}) => {
  const minMonth = availableMonths[0] || '';
  const maxMonth = availableMonths[availableMonths.length - 1] || '';

  const [startMonth, setStartMonth] = useState(currentRange.startMonth || minMonth);
  const [endMonth, setEndMonth] = useState(currentRange.endMonth || maxMonth);
  const [activePreset, setActivePreset] = useState<string | undefined>(currentRange.preset);

  useEffect(() => {
    if (isOpen && minMonth && maxMonth) {
      const s = currentRange.startMonth
        ? clampMonth(currentRange.startMonth, minMonth, maxMonth)
        : minMonth;
      const e = currentRange.endMonth
        ? clampMonth(currentRange.endMonth, minMonth, maxMonth)
        : maxMonth;
      setStartMonth(s <= e ? s : minMonth);
      setEndMonth(s <= e ? e : maxMonth);
      setActivePreset(currentRange.preset);
    }
  }, [isOpen, currentRange, minMonth, maxMonth]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const selectableMonths = useMemo(() => {
    if (!minMonth || !maxMonth) return [];
    return getMonthSpan(minMonth, maxMonth);
  }, [minMonth, maxMonth]);

  if (!isOpen) return null;

  const hasMonths = selectableMonths.length > 0;
  const latestYear = maxMonth ? parseInt(maxMonth.slice(0, 4), 10) : new Date().getUTCFullYear();

  const applyPreset = (presetKey: string) => {
    if (!hasMonths) return;
    setActivePreset(presetKey);
    let s = minMonth;
    let e = maxMonth;

    if (presetKey === 'last-3m') {
      const idx = Math.max(0, selectableMonths.length - 3);
      s = selectableMonths[idx] || minMonth;
      e = maxMonth;
    } else if (presetKey === 'last-6m') {
      const idx = Math.max(0, selectableMonths.length - 6);
      s = selectableMonths[idx] || minMonth;
      e = maxMonth;
    } else if (presetKey === 'apr-sep') {
      s = clampMonth(`${latestYear}-04`, minMonth, maxMonth);
      e = clampMonth(`${latestYear}-09`, minMonth, maxMonth);
    } else if (presetKey === 'apr-aug') {
      s = clampMonth(`${latestYear}-04`, minMonth, maxMonth);
      e = clampMonth(`${latestYear}-08`, minMonth, maxMonth);
    } else if (presetKey === 'latest-year') {
      s = clampMonth(`${latestYear}-01`, minMonth, maxMonth);
      e = clampMonth(`${latestYear}-12`, minMonth, maxMonth);
    } else if (presetKey === 'all') {
      s = minMonth;
      e = maxMonth;
    }

    if (s > e) {
      s = minMonth;
      e = maxMonth;
    }

    setStartMonth(s);
    setEndMonth(e);
  };

  const handleStartChange = (val: string) => {
    setActivePreset(undefined);
    setStartMonth(val);
    if (val > endMonth) {
      setEndMonth(val);
    }
  };

  const handleEndChange = (val: string) => {
    setActivePreset(undefined);
    setEndMonth(val);
    if (val < startMonth) {
      setStartMonth(val);
    }
  };

  const handleConfirm = () => {
    onApplyRange({
      startMonth,
      endMonth,
      preset: activePreset,
    });
    onClose();
  };

  const selectedMonths = hasMonths ? getMonthSpan(startMonth, endMonth) : [];
  const prevPeriod = hasMonths
    ? getPreviousMonthRange(startMonth, endMonth)
    : { startMonth: '', endMonth: '' };

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Custom Month Range Selector"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4"
    >
      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.96, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 10 }}
        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
        className="w-full sm:max-w-md bg-slate-900 border-t sm:border border-slate-800 rounded-t-3xl sm:rounded-2xl p-5 shadow-2xl max-h-[90vh] flex flex-col"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-emerald-400" />
            <h2 className="text-base font-semibold text-white">Custom Month Range</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close month range picker"
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="py-4 overflow-y-auto space-y-5">
          {!hasMonths ? (
            <div className="p-4 rounded-xl bg-slate-800/60 border border-slate-700/60 text-xs text-slate-300 text-center">
              No valid date column detected in this dataset. All records are currently included.
            </div>
          ) : (
            <>
              {/* Presets */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-slate-400">Quick Presets</label>
                  <span className="text-[11px] font-mono text-slate-500">
                    Data: {formatMonthLabel(minMonth)} – {formatMonthLabel(maxMonth)}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { id: 'apr-sep', label: 'Apr – Sep' },
                    { id: 'apr-aug', label: 'Apr – Aug' },
                    { id: 'last-3m', label: 'Last 3 Mos' },
                    { id: 'last-6m', label: 'Last 6 Mos' },
                    { id: 'latest-year', label: `Year ${latestYear}` },
                    { id: 'all', label: 'All Time' },
                  ].map((p) => {
                    const isActive = activePreset === p.id;
                    return (
                      <button
                        type="button"
                        key={p.id}
                        onClick={() => applyPreset(p.id)}
                        className={`px-2.5 py-2 text-xs font-medium rounded-lg border tactile-press cursor-pointer ${
                          isActive
                            ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                            : 'bg-slate-800/80 hover:bg-slate-700/80 border-slate-700/80 text-slate-300'
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Month Pickers */}
              <div>
                <label className="text-xs font-medium text-slate-400 block mb-2">Month Range</label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-[11px] text-slate-400 block mb-1">From Month</span>
                    <select
                      value={startMonth}
                      onChange={(e) => handleStartChange(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg p-2.5 text-xs focus:outline-none focus:border-emerald-500"
                    >
                      {selectableMonths.map((m) => (
                        <option key={`start-${m}`} value={m}>
                          {formatMonthLabel(m)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <span className="text-[11px] text-slate-400 block mb-1">To Month</span>
                    <select
                      value={endMonth}
                      onChange={(e) => handleEndChange(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg p-2.5 text-xs focus:outline-none focus:border-emerald-500"
                    >
                      {selectableMonths.map((m) => (
                        <option key={`end-${m}`} value={m}>
                          {formatMonthLabel(m)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Timeline Visual & Summary */}
              <div className="p-3 bg-slate-800/60 border border-slate-700/60 rounded-xl space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Selected Window:</span>
                  <span className="font-semibold text-emerald-400">
                    {formatMonthLabel(startMonth)} – {formatMonthLabel(endMonth)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>Duration:</span>
                  <span>
                    {selectedMonths.length} {selectedMonths.length === 1 ? 'Month' : 'Months'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-700/40">
                  <span>Comparison Benchmark:</span>
                  <span className="text-slate-300">
                    {formatMonthLabel(prevPeriod.startMonth)} – {formatMonthLabel(prevPeriod.endMonth)}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Action Buttons */}
        <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 text-xs font-medium text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 tactile-press cursor-pointer"
          >
            Cancel
          </button>
          {hasMonths && (
            <button
              type="button"
              onClick={handleConfirm}
              className="flex items-center gap-1.5 px-5 py-2.5 text-xs font-semibold bg-emerald-400 hover:bg-emerald-300 text-slate-950 rounded-lg tactile-press shadow-sm cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Apply Range</span>
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};
