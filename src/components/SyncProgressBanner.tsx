import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CloudDownload, RefreshCw, Sparkles } from 'lucide-react';
import type { SheetSyncStage } from '../utils/googleSheets.ts';

interface SyncProgressBannerProps {
  isSyncing: boolean;
  stage: SheetSyncStage;
  stageLabel: string;
}

const STAGE_PROGRESS: Record<SheetSyncStage, number> = {
  idle: 0,
  connecting: 28,
  downloading: 62,
  parsing: 88,
  finalizing: 98,
};

export const SyncProgressBanner: React.FC<SyncProgressBannerProps> = ({
  isSyncing,
  stage,
  stageLabel,
}) => {
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    if (!isSyncing) {
      setElapsedSec(0);
      return;
    }
    const started = performance.now();
    const timer = window.setInterval(() => {
      setElapsedSec(Number(((performance.now() - started) / 1000).toFixed(1)));
    }, 100);
    return () => window.clearInterval(timer);
  }, [isSyncing]);

  const progressPct = STAGE_PROGRESS[stage] || 40;

  return (
    <AnimatePresence>
      {isSyncing && (
        <motion.div
          key="live-sync-progress-banner"
          role="status"
          aria-live="polite"
          data-testid="sync-progress-banner"
          initial={{ opacity: 0, y: -10, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.985 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="relative overflow-hidden rounded-2xl bg-slate-900/95 border border-emerald-500/40 px-4 py-3 shadow-lg"
        >
          {/* Ambient sliding glow */}
          <motion.div
            aria-hidden="true"
            initial={{ x: '-100%' }}
            animate={{ x: '200%' }}
            transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
            className="pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-emerald-400/10 to-transparent"
          />

          <div className="relative z-10 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="relative w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-emerald-300 shrink-0">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping opacity-75" />
                <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400" />
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs sm:text-sm font-semibold text-white truncate">
                    {stageLabel || 'Syncing live Google Drive workbook...'}
                  </span>
                  <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shrink-0">
                    <CloudDownload className="w-3 h-3" />
                    Fast Sync
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 truncate">
                  Streaming compressed Sales & Finance sheets cleanly in background
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 font-mono text-xs tabular-nums text-emerald-300">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400 hidden sm:inline" />
              <span>{elapsedSec.toFixed(1)}s</span>
            </div>
          </div>

          {/* Animated Progress Track */}
          <div className="relative z-10 mt-2.5 h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-cyan-400 to-emerald-400"
              initial={{ width: '12%' }}
              animate={{ width: `${progressPct}%` }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
