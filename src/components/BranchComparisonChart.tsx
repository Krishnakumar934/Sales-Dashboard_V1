import React, { useState, useMemo } from 'react';
import { Trophy, TrendingUp, Users, Search, ArrowUpDown, Download, Check } from 'lucide-react';
import type { DataRow } from '../types/data.ts';
import { cleanNumber, formatIndianCurrency } from '../utils/aggregator.ts';
import { exportToExcel } from '../utils/excelParser.ts';

interface BranchComparisonChartProps {
  rows: DataRow[];
  dimensionCol: string;
  metricCol: string;
  selectedCategories: string[];
  onToggleCategory: (category: string) => void;
  datasetName: string;
}

export const BranchComparisonChart: React.FC<BranchComparisonChartProps> = ({
  rows,
  dimensionCol,
  metricCol,
  selectedCategories,
  onToggleCategory,
  datasetName,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'value-desc' | 'value-asc' | 'count-desc' | 'name-asc'>('value-desc');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  // Aggregate by dimension with counts and sums in a single pass
  const aggregatedData = useMemo(() => {
    if (!rows || rows.length === 0 || !dimensionCol) return [];

    const map: Record<string, { value: number; count: number }> = {};
    const len = rows.length;

    for (let i = 0; i < len; i++) {
      const row = rows[i];
      const rawDim = row[dimensionCol];
      const dimName = rawDim !== null && rawDim !== undefined && String(rawDim).trim() !== ''
        ? String(rawDim).trim()
        : 'Unspecified';

      if (!map[dimName]) {
        map[dimName] = { value: 0, count: 0 };
      }
      map[dimName].value += cleanNumber(row[metricCol]);
      map[dimName].count++;
    }

    let totalSum = 0;
    const items = Object.entries(map).map(([name, data]) => {
      totalSum += Math.max(0, data.value);
      return {
        name,
        value: Number(data.value.toFixed(2)),
        count: data.count,
        percentage: 0,
      };
    });

    for (const item of items) {
      item.percentage = totalSum > 0 ? Number(((item.value / totalSum) * 100).toFixed(1)) : 0;
    }

    return items;
  }, [rows, dimensionCol, metricCol]);

  // Search filter
  const filteredItems = useMemo(() => {
    if (!searchTerm.trim()) return aggregatedData;
    const q = searchTerm.toLowerCase().trim();
    return aggregatedData.filter((item) => item.name.toLowerCase().includes(q));
  }, [aggregatedData, searchTerm]);

  // Sort
  const sortedItems = useMemo(() => {
    const list = [...filteredItems];
    switch (sortBy) {
      case 'value-desc':
        return list.sort((a, b) => b.value - a.value);
      case 'value-asc':
        return list.sort((a, b) => a.value - b.value);
      case 'count-desc':
        return list.sort((a, b) => b.count - a.count);
      case 'name-asc':
        return list.sort((a, b) => a.name.localeCompare(b.name));
      default:
        return list;
    }
  }, [filteredItems, sortBy]);

  // Summary stats
  const totalSum = aggregatedData.reduce((acc, d) => acc + d.value, 0);
  const totalCount = rows.length;
  const topPerformer = sortedItems.length > 0 ? sortedItems[0] : null;
  const avgPerEntity = aggregatedData.length > 0 ? totalSum / aggregatedData.length : 0;
  const maxValue = sortedItems.length > 0 ? Math.max(...sortedItems.map((d) => d.value), 1) : 1;

  // Pagination
  const totalPages = Math.ceil(sortedItems.length / pageSize) || 1;
  const currentPage = Math.min(page, totalPages);
  const pagedItems = sortedItems.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const handleExport = () => {
    const exportSample = rows.length > 50000 ? rows.slice(0, 50000) : rows;
    exportToExcel(exportSample, `${datasetName.toLowerCase().replace(/\s+/g, '_')}_filtered.xlsx`);
  };

  if (!dimensionCol) return null;

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 sm:p-5 space-y-4">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div>
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <span>{dimensionCol} Performance & Distribution Chart</span>
            <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full">
              {totalCount.toLocaleString('en-IN')} Records
            </span>
          </h2>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Ranked visual comparison of {metricCol} and record counts across all {dimensionCol}s
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          {/* Search box */}
          <div className="relative flex-1 sm:w-48">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
              placeholder={`Search ${dimensionCol}...`}
              className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg pl-8 pr-2.5 py-1.5 text-xs focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Sort selector */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="bg-slate-800 border border-slate-700 text-slate-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-emerald-500"
          >
            <option value="value-desc">Highest {metricCol}</option>
            <option value="value-asc">Lowest {metricCol}</option>
            <option value="count-desc">Highest Record Count</option>
            <option value="name-asc">Name (A-Z)</option>
          </select>

          {/* Export button */}
          <button
            onClick={handleExport}
            title="Download Excel Spreadsheet"
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg transition-colors shrink-0"
          >
            <Download className="w-4 h-4 text-emerald-400" />
          </button>
        </div>
      </div>

      {/* Highlights Strip */}
      <div className="grid grid-cols-3 gap-2.5">
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
            <Trophy className="w-4 h-4" />
          </div>
          <div className="truncate">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Top {dimensionCol}</span>
            <div className="text-xs font-bold text-white truncate">{topPerformer ? topPerformer.name : '—'}</div>
            <span className="text-[11px] text-emerald-400 font-mono font-semibold">
              {topPerformer ? formatIndianCurrency(topPerformer.value) : '—'}
            </span>
          </div>
        </div>

        <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
            <TrendingUp className="w-4 h-4" />
          </div>
          <div className="truncate">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Average Per {dimensionCol}</span>
            <div className="text-xs font-bold text-white font-mono">{formatIndianCurrency(avgPerEntity)}</div>
            <span className="text-[10px] text-slate-400">across {aggregatedData.length} entities</span>
          </div>
        </div>

        <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
            <Users className="w-4 h-4" />
          </div>
          <div className="truncate">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Total {dimensionCol}s</span>
            <div className="text-xs font-bold text-white font-mono">{aggregatedData.length}</div>
            <span className="text-[10px] text-slate-400">{totalCount.toLocaleString('en-IN')} rows</span>
          </div>
        </div>
      </div>

      {/* Visual Chart Bars (Clean interactive visual chart cards) */}
      <div className="space-y-2.5">
        {pagedItems.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs">
            No matching {dimensionCol} found for "{searchTerm}".
          </div>
        ) : (
          pagedItems.map((item, index) => {
            const rank = (currentPage - 1) * pageSize + index + 1;
            const isSelected = selectedCategories.includes(item.name);
            const barWidth = Math.max(4, (item.value / maxValue) * 100);

            return (
              <div
                key={item.name}
                onClick={() => onToggleCategory(item.name)}
                className={`p-3 rounded-xl border transition-all cursor-pointer group ${
                  isSelected
                    ? 'bg-emerald-950/40 border-emerald-500/50 shadow-sm'
                    : 'bg-slate-800/40 hover:bg-slate-800/80 border-slate-800 hover:border-slate-700'
                }`}
              >
                {/* Header Row: Rank, Name, Metric, Counts */}
                <div className="flex items-center justify-between text-xs mb-2">
                  <div className="flex items-center gap-2.5 truncate pr-2">
                    <span
                      className={`w-6 h-6 rounded-lg text-[10px] font-mono font-bold flex items-center justify-center shrink-0 ${
                        rank === 1
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          : rank === 2
                          ? 'bg-slate-400/20 text-slate-200 border border-slate-400/30'
                          : rank === 3
                          ? 'bg-amber-700/20 text-amber-400 border border-amber-700/40'
                          : 'bg-slate-800 text-slate-400 border border-slate-700'
                      }`}
                    >
                      #{rank}
                    </span>
                    <span className="font-semibold text-slate-200 truncate group-hover:text-emerald-300">
                      {item.name}
                    </span>
                    {isSelected && (
                      <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded font-mono">
                        Filtered
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <span className="font-bold text-white font-mono tabular-nums block text-xs">
                        {formatIndianCurrency(item.value)}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {item.count.toLocaleString('en-IN')} counts · {item.percentage}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* Progress Bar Chart */}
                <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden flex">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      isSelected
                        ? 'bg-emerald-400'
                        : rank === 1
                        ? 'bg-gradient-to-r from-emerald-500 to-emerald-400'
                        : 'bg-emerald-500/80 group-hover:bg-emerald-400'
                    }`}
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-800">
          <span>
            Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, sortedItems.length)} of{' '}
            {sortedItems.length} {dimensionCol}s
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 rounded border border-slate-700 text-xs"
            >
              Previous
            </button>
            <span className="font-mono text-slate-300">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 rounded border border-slate-700 text-xs"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
