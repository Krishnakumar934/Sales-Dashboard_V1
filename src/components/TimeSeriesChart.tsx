import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { TimeSeriesPoint } from '../types/data.ts';
import { formatIndianCurrency, isCurrencyMetric } from '../utils/aggregator.ts';

interface TimeSeriesChartProps {
  data: TimeSeriesPoint[];
  metricName: string;
  aggregationType: string;
  hasDateCol?: boolean;
  isFinance?: boolean;
}

/**
 * Computes a smooth cubic Bezier curve through data points (Catmull-Rom spline conversion)
 */
function getSmoothCurvePath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  if (pts.length === 2) {
    return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} L ${pts[1].x.toFixed(1)} ${pts[1].y.toFixed(1)}`;
  }

  let path = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];

    // Catmull-Rom to Cubic Bezier control points (tension = 0.5)
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    path += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return path;
}

export const TimeSeriesChart: React.FC<TimeSeriesChartProps> = ({
  data,
  metricName,
  aggregationType,
  hasDateCol = true,
  isFinance = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'amount' | 'count'>('amount');
  const isCurrency = isCurrencyMetric(metricName);

  if (!hasDateCol || !data || data.length === 0) {
    return (
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 text-center">
        <h3 className="text-sm font-semibold text-white">Monthly Trend Chart</h3>
        <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
          No time-series date column found in this dataset. Switch to{' '}
          <strong className="text-slate-300">Breakdowns</strong> or{' '}
          <strong className="text-slate-300">Chart Form</strong> to explore distributions and counts.
        </p>
      </div>
    );
  }

  const isAmount = viewMode === 'amount';
  const values = data.map((d) => {
    if (isAmount) {
      return typeof d.value === 'number' && !isNaN(d.value) ? d.value : 0;
    }
    return typeof d.count === 'number' && !isNaN(d.count) ? d.count : 0;
  });

  const minVal = values.length > 0 ? Math.min(0, ...values) : 0;
  const maxVal = values.length > 0 ? Math.max(1, ...values) : 1;
  const valRange = maxVal - minVal || 1;

  // SVG coordinate dimensions
  const svgWidth = 640;
  const svgHeight = 230;
  const padding = { top: 25, right: 25, bottom: 40, left: 78 };
  const chartW = svgWidth - padding.left - padding.right;
  const chartH = svgHeight - padding.top - padding.bottom;
  const baselineY = padding.top + chartH;

  const getX = (index: number) => {
    if (data.length <= 1) return padding.left + chartW / 2;
    return padding.left + (index / (data.length - 1)) * chartW;
  };

  const getY = (val: number) => {
    const safeVal = typeof val === 'number' && !isNaN(val) ? val : 0;
    return padding.top + chartH - ((safeVal - minVal) / valRange) * chartH;
  };

  // Generate coordinates for points
  const pts = data.map((d, i) => {
    const val = isAmount ? d.value : d.count;
    return { x: getX(i), y: getY(val) };
  });

  // Smooth spline curve & area path
  const curvePath = getSmoothCurvePath(pts);
  const areaPath =
    pts.length > 0
      ? `${curvePath} L ${pts[pts.length - 1].x.toFixed(1)} ${baselineY} L ${pts[0].x.toFixed(1)} ${baselineY} Z`
      : '';

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    if (!containerRef.current || data.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;

    const clientX = e.clientX - rect.left;
    const svgX = (clientX / rect.width) * svgWidth;

    let closestIdx = 0;
    let minDistance = Infinity;
    for (let i = 0; i < data.length; i++) {
      const px = getX(i);
      const dist = Math.abs(px - svgX);
      if (dist < minDistance) {
        minDistance = dist;
        closestIdx = i;
      }
    }
    setHoverIndex(closestIdx);
  };

  const handlePointerLeave = () => {
    setHoverIndex(null);
  };

  const isHovered = hoverIndex !== null && hoverIndex >= 0 && hoverIndex < data.length;
  const activePoint = isHovered ? data[hoverIndex] : null;
  const activePt = isHovered && pts[hoverIndex] ? pts[hoverIndex] : { x: padding.left, y: baselineY };

  const yTicks = [
    maxVal,
    minVal + valRange * 0.66,
    minVal + valRange * 0.33,
    minVal,
  ];

  const gradientStart = isAmount ? '#10b981' : '#38bdf8';
  const gradientEnd = isAmount ? '#06b6d4' : '#818cf8';
  const pointHaloColor = isAmount ? 'rgba(16, 185, 129, 0.25)' : 'rgba(56, 189, 248, 0.25)';
  const pointStrokeColor = isAmount ? '#10b981' : '#38bdf8';

  const tooltipW = 150;
  const tooltipH = 50;
  const tooltipY = activePt.y > padding.top + tooltipH + 12 ? activePt.y - tooltipH - 12 : activePt.y + 14;
  const rawTooltipX = activePt.x - tooltipW / 2;
  const tooltipX = Math.max(padding.left - 10, Math.min(svgWidth - padding.right - tooltipW + 10, rawTooltipX));

  const curveRenderKey = `${viewMode}-${isFinance ? 'fin' : 'sales'}-${data.length}-${Math.round(maxVal)}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
      className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3.5 sm:p-5 overflow-hidden"
    >
      {/* Chart Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3 border-b border-slate-800/80">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-semibold text-white tracking-tight">
              Monthly {isAmount ? metricName : isFinance ? 'Finance Count' : 'Transaction Count'} Trend
            </h2>
            <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-lg">
              {isCurrency && isAmount ? 'Indian System (₹)' : isFinance ? 'SUM(Count)' : 'Record Volume'}
            </span>
          </div>
          <span className="text-[11px] text-slate-400">
            {isAmount
              ? `Aggregation: ${aggregationType ? aggregationType.toUpperCase() : 'SUM'} across ${data.length} months`
              : isFinance
              ? `Monthly finance Count (SUM of Count) across ${data.length} months`
              : `Monthly record count volume across ${data.length} months`}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap self-start sm:self-auto">
          {/* Amount vs Count View Mode Toggle with sliding layoutId */}
          <div className="flex items-center bg-slate-950/80 p-0.5 rounded-xl border border-slate-800 text-xs relative">
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => setViewMode('amount')}
              className={`relative px-3 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer z-10 ${
                isAmount ? 'text-emerald-300 font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {isAmount && (
                <motion.span
                  layoutId="timeseries-mode-pill"
                  transition={{ type: 'spring', stiffness: 480, damping: 36 }}
                  className="absolute inset-0 rounded-lg bg-emerald-500/20 border border-emerald-500/30 shadow-xs -z-10"
                />
              )}
              <span className="relative z-10">{isFinance ? 'Loan Amount (₹)' : 'Amount (₹)'}</span>
            </motion.button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => setViewMode('count')}
              className={`relative px-3 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer z-10 ${
                !isAmount ? 'text-sky-300 font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {!isAmount && (
                <motion.span
                  layoutId="timeseries-mode-pill"
                  transition={{ type: 'spring', stiffness: 480, damping: 36 }}
                  className="absolute inset-0 rounded-lg bg-sky-500/20 border border-sky-500/30 shadow-xs -z-10"
                />
              )}
              <span className="relative z-10">{isFinance ? 'Finance Count' : 'Record Count'}</span>
            </motion.button>
          </div>

          {/* Active Period / Hover Inspector Pill */}
          <div className="flex items-center gap-2 bg-slate-950/80 border border-slate-800 rounded-xl px-3 py-1 transition-colors min-w-[205px]">
            <AnimatePresence mode="wait" initial={false}>
              {isHovered && activePoint ? (
                <motion.div
                  key={`insp-${activePoint.label}-${viewMode}`}
                  initial={{ opacity: 0, y: 2 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -2 }}
                  transition={{ duration: 0.12 }}
                  className="flex items-center gap-2"
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: gradientStart }}
                  />
                  <span className="text-[11px] text-slate-300 font-medium">
                    {activePoint.label}:
                  </span>
                  {isAmount ? (
                    <>
                      <span className="text-xs sm:text-sm font-bold text-white font-mono tabular-nums">
                        {isCurrency ? formatIndianCurrency(activePoint.value) : `${activePoint.value.toLocaleString('en-IN')}`}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        ({activePoint.count.toLocaleString('en-IN')} counts)
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-xs sm:text-sm font-bold text-white font-mono tabular-nums">
                        {activePoint.count.toLocaleString('en-IN')} counts
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        ({isCurrency ? formatIndianCurrency(activePoint.value) : `${activePoint.value.toLocaleString('en-IN')}`})
                      </span>
                    </>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="insp-idle"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12 }}
                  className="flex items-center gap-2"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-500 shrink-0" />
                  <span className="text-[11px] text-slate-400 font-medium">
                    Hover or tap a point to inspect
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* SVG Canvas with Interactive Precision Tracking */}
      <div
        ref={containerRef}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onClick={() => setHoverIndex(null)}
        style={{ touchAction: 'pan-y' }}
        className="relative mt-3 select-none"
      >
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-52 sm:h-60 overflow-visible"
        >
          <defs>
            <linearGradient id={`trendStroke-${viewMode}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={gradientStart} />
              <stop offset="100%" stopColor={gradientEnd} />
            </linearGradient>

            <linearGradient id={`areaGradient-${viewMode}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={gradientStart} stopOpacity="0.22" />
              <stop offset="60%" stopColor={gradientEnd} stopOpacity="0.06" />
              <stop offset="100%" stopColor={gradientEnd} stopOpacity="0.0" />
            </linearGradient>

            <filter id={`lineGlow-${viewMode}`} x="-10%" y="-20%" width="120%" height="150%">
              <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor={gradientStart} floodOpacity="0.35" />
            </filter>

            <filter id="tooltipShadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#000000" floodOpacity="0.6" />
            </filter>
          </defs>

          {/* Background Grid Lines & Y-Axis Labels */}
          {yTicks.map((tick, i) => {
            const y = getY(tick);
            return (
              <g key={`grid-${i}`}>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={svgWidth - padding.right}
                  y2={y}
                  stroke="#1e293b"
                  strokeWidth="1"
                  strokeDasharray="4 4"
                />
                <text
                  x={padding.left - 10}
                  y={y + 3.5}
                  textAnchor="end"
                  className="text-[10px] fill-slate-400 font-mono select-none"
                >
                  {isAmount && isCurrency ? formatIndianCurrency(tick) : Math.round(tick).toLocaleString('en-IN')}
                </text>
              </g>
            );
          })}

          {/* Smooth Area Gradient Fill */}
          <motion.path
            key={`area-${curveRenderKey}`}
            d={areaPath}
            fill={`url(#areaGradient-${viewMode})`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          />

          {/* Animated Smooth Spline Trend Line */}
          <motion.path
            key={`line-${curveRenderKey}`}
            d={curvePath}
            fill="none"
            stroke={`url(#trendStroke-${viewMode})`}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter={`url(#lineGlow-${viewMode})`}
            initial={{ pathLength: 0, opacity: 0.4 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          />

          {/* Vertical Scrubber Line for active point */}
          {isHovered && activePt && (
            <motion.line
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, x1: activePt.x, x2: activePt.x }}
              transition={{ duration: 0.12 }}
              y1={padding.top}
              y2={baselineY}
              stroke="#475569"
              strokeWidth="1.2"
              strokeDasharray="3 3"
            />
          )}

          {/* Data Points */}
          {pts.map((pt, i) => {
            const isPointActive = isHovered && hoverIndex === i;
            return (
              <g key={`pt-${i}`}>
                {isPointActive && (
                  <motion.circle
                    cx={pt.x}
                    cy={pt.y}
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 450, damping: 24 }}
                    r={10}
                    fill={pointHaloColor}
                  />
                )}

                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={isPointActive ? 5.5 : 3.5}
                  fill={isPointActive ? '#ffffff' : '#090d16'}
                  stroke={pointStrokeColor}
                  strokeWidth={isPointActive ? 2.5 : 1.8}
                  className="transition-all duration-150"
                />

                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={18}
                  fill="transparent"
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    setHoverIndex((prev) => (prev === i ? null : i));
                  }}
                  onTouchStart={(e) => {
                    e.stopPropagation();
                    setHoverIndex(i);
                  }}
                />
              </g>
            );
          })}

          {/* Floating In-Chart Tooltip Bubble */}
          <AnimatePresence>
            {isHovered && activePoint && (
              <motion.g
                initial={{ opacity: 0, scale: 0.94, x: tooltipX, y: tooltipY }}
                animate={{ opacity: 1, scale: 1, x: tooltipX, y: tooltipY }}
                exit={{ opacity: 0, scale: 0.94 }}
                transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                filter="url(#tooltipShadow)"
                className="pointer-events-none"
              >
                <rect
                  width={tooltipW}
                  height={tooltipH}
                  rx="10"
                  ry="10"
                  fill="#090d16"
                  stroke="#334155"
                  strokeWidth="1"
                  fillOpacity="0.95"
                />
                <text
                  x={12}
                  y={18}
                  className="text-[10px] font-semibold fill-slate-300 font-sans"
                >
                  {activePoint.label}
                </text>
                <text
                  x={12}
                  y={36}
                  className="text-xs font-bold font-mono fill-white tabular-nums"
                >
                  {isAmount
                    ? (isCurrency ? formatIndianCurrency(activePoint.value) : activePoint.value.toLocaleString('en-IN'))
                    : `${activePoint.count.toLocaleString('en-IN')} counts`}
                </text>
                <text
                  x={tooltipW - 12}
                  y={36}
                  textAnchor="end"
                  className="text-[10px] font-mono fill-slate-400"
                >
                  {isAmount ? `${activePoint.count.toLocaleString('en-IN')} counts` : ''}
                </text>
              </motion.g>
            )}
          </AnimatePresence>

          {/* Invisible interactive vertical hit slices */}
          {data.map((_, i) => {
            const x = getX(i);
            const prevX = i > 0 ? (getX(i - 1) + x) / 2 : padding.left - 15;
            const nextX = i < data.length - 1 ? (x + getX(i + 1)) / 2 : svgWidth - padding.right + 15;
            const sliceW = Math.max(16, nextX - prevX);

            return (
              <rect
                key={`hit-${i}`}
                x={prevX}
                y={padding.top}
                width={sliceW}
                height={chartH + 30}
                fill="transparent"
                className="cursor-pointer"
                onPointerEnter={(e) => {
                  if (e.pointerType !== 'touch') {
                    setHoverIndex(i);
                  }
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setHoverIndex((prev) => (prev === i ? null : i));
                }}
                onTouchStart={(e) => {
                  e.stopPropagation();
                  setHoverIndex(i);
                }}
              />
            );
          })}

          {/* X-Axis Month Labels */}
          {data.map((d, i) => {
            const x = getX(i);
            const isPointActive = isHovered && hoverIndex === i;
            const step = data.length > 14 ? 3 : data.length > 8 ? 2 : 1;
            if (i % step !== 0 && i !== data.length - 1 && !isPointActive) return null;

            return (
              <g key={`x-${i}`}>
                {isPointActive && (
                  <rect
                    x={x - 20}
                    y={svgHeight - 19}
                    width={40}
                    height={16}
                    rx={8}
                    ry={8}
                    fill="#1e293b"
                    stroke="#475569"
                    strokeWidth={0.8}
                  />
                )}
                <text
                  x={x}
                  y={svgHeight - 8}
                  textAnchor="middle"
                  className={`text-[10px] font-mono select-none transition-colors ${
                    isPointActive ? 'fill-white font-bold' : 'fill-slate-400 font-medium'
                  }`}
                >
                  {d.label ? d.label.split(' ')[0] : ''}
                </text>
              </g>
            );
          })}
        </svg>

        <div className="mt-1 text-center text-[11px] text-slate-400 sm:hidden">
          Tap any point or month to view values (tap outside to reset)
        </div>
      </div>
    </motion.div>
  );
};
