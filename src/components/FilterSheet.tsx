import React, { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { X, SlidersHorizontal, Check, Trash2, Search } from 'lucide-react';
import type { ColumnMeta, DataRow } from '../types/data.ts';
import { resolveRows, type RowHandle } from '../utils/aggregator.ts';

interface FilterSheetProps {
  isOpen: boolean;
  onClose: () => void;
  columns: ColumnMeta[];
  rows: DataRow[] | RowHandle;
  activeCategoryFilters: Record<string, string[]>;
  searchQuery: string;
  onApplyFilters: (categories: Record<string, string[]>, search: string) => void;
}

export const FilterSheet: React.FC<FilterSheetProps> = ({
  isOpen,
  onClose,
  columns,
  rows,
  activeCategoryFilters,
  searchQuery,
  onApplyFilters,
}) => {
  const resolvedRows = useMemo(() => resolveRows(rows), [rows]);
  const [localCategories, setLocalCategories] = useState(activeCategoryFilters);
  const [localSearch, setLocalSearch] = useState(searchQuery);

  // Synchronize local state whenever FilterSheet is opened
  React.useEffect(() => {
    if (isOpen) {
      setLocalCategories(activeCategoryFilters);
      setLocalSearch(searchQuery);
    }
  }, [isOpen, activeCategoryFilters, searchQuery]);

  // Filterable categorical columns prioritized: Financier -> GM -> ASM -> Category -> Brand -> Branch
  const filterableCols = useMemo(() => {
    const priorityChecks = [
      (n: string) => n === 'financier' || n === 'financer' || n.includes('financier') || n.includes('financer'),
      (n: string) => n === 'gm' || n.startsWith('gm ') || n.endsWith(' gm') || n.includes('general manager'),
      (n: string) => n === 'asm' || n.startsWith('asm ') || n.endsWith(' asm') || n.includes('area sales manager'),
      (n: string) => n === 'category' || n.includes('category'),
      (n: string) => n === 'brand' || n.includes('brand'),
      (n: string) => n === 'branch' || n.includes('branch'),
      (n: string) => n === 'zone' || n.includes('zone'),
      (n: string) => n === 'region' || n.includes('region'),
      (n: string) => n === 'product' || n.includes('product'),
      (n: string) => n === 'department' || n.includes('department'),
      (n: string) => n === 'segment' || n.includes('segment'),
    ];

    const candidates = columns.filter((c) => {
      if (c.type !== 'category' && c.type !== 'text') return false;
      const lower = c.name.toLowerCase().trim();
      return !lower.includes('invoice') && lower !== 'id' && lower !== 'sno' && lower !== 's.no';
    });

    return [...candidates].sort((a, b) => {
      const aLower = a.name.toLowerCase().trim();
      const bLower = b.name.toLowerCase().trim();

      const aRank = priorityChecks.findIndex((fn) => fn(aLower));
      const bRank = priorityChecks.findIndex((fn) => fn(bLower));

      const rankA = aRank === -1 ? 999 : aRank;
      const rankB = bRank === -1 ? 999 : bRank;

      if (rankA !== rankB) return rankA - rankB;
      return a.name.localeCompare(b.name);
    });
  }, [columns]);

  // Compute distinct options dynamically with cascading filters (GM narrows ASM, ASM narrows Branch)
  const colOptionsMap = useMemo(() => {
    if (!isOpen || !resolvedRows || resolvedRows.length === 0) return {};
    const map: Record<string, { value: string; count: number }[]> = {};

    const activeEntries = Object.entries(localCategories).filter(
      ([, vals]) => vals && vals.length > 0
    );

    for (let c = 0; c < filterableCols.length; c++) {
      const colName = filterableCols[c].name;
      const otherFilters = activeEntries.filter(([k]) => k !== colName);

      const matchingRows = otherFilters.length === 0
        ? resolvedRows
        : resolvedRows.filter((r) => {
            for (let f = 0; f < otherFilters.length; f++) {
              const [k, vals] = otherFilters[f];
              const cellVal = String(r[k] ?? '').trim().toLowerCase();
              const hasMatch = vals.some(
                (v) => String(v).trim().toLowerCase() === cellVal
              );
              if (!hasMatch) return false;
            }
            return true;
          });

      const counts: Record<string, { displayVal: string; count: number }> = {};
      const rowLen = matchingRows.length;

      for (let i = 0; i < rowLen; i++) {
        const raw = matchingRows[i][colName];
        if (raw !== null && raw !== undefined) {
          const trimmed = String(raw).trim();
          if (trimmed) {
            const lowerKey = trimmed.toLowerCase();
            if (!counts[lowerKey]) {
              counts[lowerKey] = { displayVal: trimmed, count: 0 };
            }
            counts[lowerKey].count++;
          }
        }
      }

      map[colName] = Object.values(counts)
        .map(({ displayVal, count }) => ({ value: displayVal, count }))
        .sort((a, b) => b.count - a.count);
    }

    return map;
  }, [isOpen, resolvedRows, filterableCols, localCategories]);

  if (!isOpen) return null;

  const toggleOption = (colName: string, val: string) => {
    const current = localCategories[colName] || [];
    const next = current.includes(val)
      ? current.filter((x) => x !== val)
      : [...current, val];

    setLocalCategories({
      ...localCategories,
      [colName]: next,
    });
  };

  const handleClearAll = () => {
    setLocalCategories({});
    setLocalSearch('');
  };

  const handleApply = () => {
    onApplyFilters(localCategories, localSearch);
    onClose();
  };

  const totalActive = Object.values(localCategories).reduce(
    (sum, arr) => sum + (arr ? arr.length : 0),
    0
  ) + (localSearch.trim() ? 1 : 0);

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Filter Data Sheet"
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
        className="w-full sm:max-w-lg bg-slate-900 border-t sm:border border-slate-800 rounded-t-3xl sm:rounded-2xl p-5 shadow-2xl max-h-[88vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-emerald-400" />
            <h2 className="text-base font-semibold text-white">Filter Data</h2>
            {totalActive > 0 && (
              <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full font-mono">
                {totalActive} active
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close filters"
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Filter Body */}
        <div className="py-4 overflow-y-auto space-y-5">
          {/* Global Search */}
          <div>
            <label className="text-xs font-medium text-slate-400 block mb-1.5">
              Search Any Keyword
            </label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-3" />
              <input
                type="text"
                value={localSearch}
                onChange={(e) => setLocalSearch(e.target.value)}
                placeholder="Search across all records..."
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg pl-9 pr-3 py-2 text-xs focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Categorical Facet Groups */}
          {filterableCols.slice(0, 6).map((col) => {
            const options = colOptionsMap[col.name] || [];
            const selected = localCategories[col.name] || [];

            if (options.length === 0) return null;

            return (
              <div key={col.name} className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-300">
                    {col.name}
                  </span>
                  {selected.length > 0 && (
                    <button
                      onClick={() =>
                        setLocalCategories({ ...localCategories, [col.name]: [] })
                      }
                      className="text-[10px] text-slate-400 hover:text-emerald-400"
                    >
                      Reset ({selected.length})
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
                  {options.map((opt) => {
                    const isChecked = selected.includes(opt.value);
                    return (
                      <button
                        type="button"
                        key={opt.value}
                        onClick={() => toggleOption(col.name, opt.value)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border tactile-press cursor-pointer ${
                          isChecked
                            ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                            : 'bg-slate-800/80 hover:bg-slate-700/80 border-slate-700/80 text-slate-300'
                        }`}
                      >
                        <span className="truncate max-w-[130px]">{opt.value}</span>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {opt.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer Actions */}
        <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
          <button
            type="button"
            onClick={handleClearAll}
            className="flex items-center gap-1.5 text-xs text-rose-400 hover:text-rose-300 px-3 py-2 rounded-lg hover:bg-slate-800 tactile-press cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Reset All</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-medium text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 tactile-press cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="flex items-center gap-1.5 px-5 py-2 text-xs font-semibold bg-emerald-400 hover:bg-emerald-300 text-slate-950 rounded-lg tactile-press shadow-sm cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Apply Filters</span>
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};
