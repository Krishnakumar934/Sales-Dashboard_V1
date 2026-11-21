import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Search, Check, X, Filter } from 'lucide-react';
import type { ColumnMeta, DataRow } from '../types/data.ts';

interface QuickDimensionFilterProps {
  columns: ColumnMeta[];
  rows: DataRow[];
  activeFilters: Record<string, string[]>;
  onFilterChange: (colName: string, selectedValues: string[]) => void;
  onClearAll: () => void;
}

function getPluralName(name: string): string {
  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();
  if (lower.endsWith('branch')) return `${trimmed}es`;
  if (lower.endsWith('category')) return `${trimmed.slice(0, -1)}ies`;
  if (lower.endsWith('status')) return `${trimmed}es`;
  if (lower.endsWith('s')) return trimmed;
  return `${trimmed}s`;
}

export const QuickDimensionFilter: React.FC<QuickDimensionFilterProps> = ({
  columns,
  rows,
  activeFilters,
  onFilterChange,
  onClearAll,
}) => {
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [searchTerms, setSearchTerms] = useState<Record<string, string>>({});
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpenDropdown(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Find categorical/text dimension columns, strictly prioritizing "GM" -> "ASM" -> "Branch" -> "Zone" -> "Region" -> "Brand" -> "Product" -> "Category"
  const dimensionCols = useMemo(() => {
    const priorityChecks = [
      (n: string) => n === 'gm' || n.startsWith('gm ') || n.endsWith(' gm') || n.includes('general manager'),
      (n: string) => n === 'asm' || n.startsWith('asm ') || n.endsWith(' asm') || n.includes('area sales manager'),
      (n: string) => n === 'branch' || n.includes('branch'),
      (n: string) => n === 'zone' || n.includes('zone'),
      (n: string) => n === 'region' || n.includes('region'),
      (n: string) => n === 'brand' || n.includes('brand'),
      (n: string) => n === 'product' || n.includes('product'),
      (n: string) => n === 'category' || n.includes('category'),
      (n: string) => n === 'department' || n.includes('department'),
      (n: string) => n === 'segment' || n.includes('segment'),
    ];

    const candidates = columns.filter((c) => c.type === 'category' || c.type === 'text');

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

  // Compute distinct options dynamically per column by cascading active filters:
  // Selecting GM limits ASMs and Branches to that GM.
  // Selecting ASM narrows Branches to that specific ASM.
  const optionsMap = useMemo(() => {
    const map: Record<string, { value: string; count: number }[]> = {};
    if (!rows || rows.length === 0) return map;

    const activeFilterEntries = Object.entries(activeFilters).filter(
      ([, vals]) => vals && vals.length > 0
    );

    for (const col of dimensionCols.slice(0, 8)) {
      const colName = col.name;

      // Filter rows by all active filters EXCEPT this column
      const otherFilters = activeFilterEntries.filter(([k]) => k !== colName);

      const matchingRows = otherFilters.length === 0
        ? rows
        : rows.filter((r) => {
            for (let f = 0; f < otherFilters.length; f++) {
              const [filterCol, selectedVals] = otherFilters[f];
              const cellVal = String(r[filterCol] ?? '').trim().toLowerCase();
              const hasMatch = selectedVals.some(
                (v) => String(v).trim().toLowerCase() === cellVal
              );
              if (!hasMatch) return false;
            }
            return true;
          });

      const counts: Record<string, { displayVal: string; count: number }> = {};
      const rowCount = matchingRows.length;
      for (let i = 0; i < rowCount; i++) {
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
  }, [dimensionCols, rows, activeFilters]);

  const activeFilterCount = Object.values(activeFilters).reduce(
    (acc, arr) => acc + (arr ? arr.length : 0),
    0
  );

  if (dimensionCols.length === 0) return null;

  return (
    <div ref={dropdownRef} className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 mb-2.5 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="text-xs font-semibold text-slate-200">
            Interactive Dimension Filters (Select Options)
          </span>
          {activeFilterCount > 0 && (
            <span className="text-[10px] bg-emerald-500/20 text-emerald-400 font-mono px-2 py-0.5 rounded-full shrink-0">
              {activeFilterCount} active
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              dimensionCols.slice(0, 8).forEach((col) => {
                const opts = optionsMap[col.name] || [];
                if (opts.length > 0) {
                  onFilterChange(col.name, opts.map((o) => o.value));
                }
              });
            }}
            className="text-[11px] text-emerald-400 hover:text-emerald-300 font-medium transition-colors"
          >
            Select All
          </button>
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={onClearAll}
              className="text-[11px] text-slate-400 hover:text-rose-400 transition-colors"
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* Grid of Dimension Selectors: 2 columns on mobile, 3 on md, 4 on lg */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-2.5">
        {dimensionCols.slice(0, 8).map((col) => {
          const colOptions = optionsMap[col.name] || [];
          const selected = activeFilters[col.name] || [];
          const isOpen = openDropdown === col.name;
          const search = (searchTerms[col.name] || '').toLowerCase().trim();

          const filteredOptions = search
            ? colOptions.filter((opt) => opt.value.toLowerCase().includes(search))
            : colOptions;

          const toggleVal = (val: string) => {
            const valLower = val.toLowerCase().trim();
            const exists = selected.some((s) => s.toLowerCase().trim() === valLower);
            const next = exists
              ? selected.filter((s) => s.toLowerCase().trim() !== valLower)
              : [...selected, val];
            onFilterChange(col.name, next);
          };

          const pluralLabel = getPluralName(col.name);

          return (
            <div key={col.name} className="relative">
              <label className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 block mb-1 truncate">
                Filter by {col.name}
              </label>

              {/* Selector Trigger Button */}
              <button
                type="button"
                onClick={() => setOpenDropdown(isOpen ? null : col.name)}
                className={`w-full flex items-center justify-between p-2 rounded-lg border text-xs text-left transition-colors ${
                  selected.length > 0
                    ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-200'
                    : 'bg-slate-800/80 hover:bg-slate-800 border-slate-700 text-slate-200'
                }`}
              >
                <div className="truncate pr-1.5">
                  {selected.length === 0 ? (
                    <span className="text-slate-400">All {pluralLabel}</span>
                  ) : selected.length === 1 ? (
                    <span className="font-medium text-white">{selected[0]}</span>
                  ) : (
                    <span className="font-medium text-emerald-300 font-mono">
                      {selected.length} {pluralLabel}
                    </span>
                  )}
                </div>
                <ChevronDown
                  className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${
                    isOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {/* Popover Dropdown with Search & Select All */}
              {isOpen && (
                <div className="absolute top-full left-0 sm:left-auto right-0 sm:right-auto mt-1.5 z-40 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-2 min-w-[220px] max-w-[280px] max-h-64 flex flex-col animate-in fade-in zoom-in-95 duration-150">
                  {/* Search box for this column */}
                  <div className="relative mb-2">
                    <Search className="w-3 h-3 text-slate-500 absolute left-2.5 top-2.5" />
                    <input
                      type="text"
                      value={searchTerms[col.name] || ''}
                      onChange={(e) =>
                        setSearchTerms({ ...searchTerms, [col.name]: e.target.value })
                      }
                      placeholder={`Search ${col.name}...`}
                      className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg pl-7 pr-2 py-1.5 text-xs focus:outline-none focus:border-emerald-500"
                      autoFocus
                    />
                  </div>

                  {/* Actions: Select All / Clear */}
                  <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-slate-800 text-[10px] text-slate-400">
                    <span>
                      {selected.length} of {colOptions.length} chosen
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onFilterChange(col.name, colOptions.map((o) => o.value))}
                        className="text-emerald-400 hover:text-emerald-300 font-medium transition-colors"
                      >
                        Select All
                      </button>
                      {selected.length > 0 && (
                        <button
                          type="button"
                          onClick={() => onFilterChange(col.name, [])}
                          className="text-rose-400 hover:text-rose-300 transition-colors"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>

                  {/* List of options */}
                  <div className="overflow-y-auto space-y-1 flex-1 pr-1">
                    {/* Select All Toggle Checkbox */}
                    {filteredOptions.length > 0 && !search && (
                      <div
                        onClick={() => {
                          const allSelected = colOptions.every((opt) => selected.includes(opt.value));
                          onFilterChange(col.name, allSelected ? [] : colOptions.map((o) => o.value));
                        }}
                        className="flex items-center justify-between px-2 py-1.5 rounded-lg text-xs cursor-pointer transition-colors bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 mb-1 font-medium text-emerald-300"
                      >
                        <div className="flex items-center gap-2 truncate pr-2">
                          <div
                            className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                              colOptions.length > 0 && colOptions.every((opt) => selected.includes(opt.value))
                                ? 'bg-emerald-500 border-emerald-400 text-slate-950'
                                : 'border-slate-500'
                            }`}
                          >
                            {colOptions.length > 0 && colOptions.every((opt) => selected.includes(opt.value)) && (
                              <Check className="w-2.5 h-2.5 stroke-[3]" />
                            )}
                          </div>
                          <span>Select All</span>
                        </div>
                        <span className="text-[10px] text-slate-400 font-mono shrink-0">
                          ({colOptions.length})
                        </span>
                      </div>
                    )}

                    {filteredOptions.length === 0 ? (
                      <div className="p-3 text-center text-slate-500 text-xs">
                        No matches found
                      </div>
                    ) : (
                      filteredOptions.map((opt) => {
                        const isChecked = selected.includes(opt.value);
                        return (
                          <div
                            key={opt.value}
                            onClick={() => toggleVal(opt.value)}
                            className={`flex items-center justify-between px-2 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
                              isChecked
                                ? 'bg-emerald-500/20 text-emerald-200'
                                : 'hover:bg-slate-800 text-slate-300'
                            }`}
                          >
                            <div className="flex items-center gap-2 truncate pr-2">
                              <div
                                className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                                  isChecked
                                    ? 'bg-emerald-500 border-emerald-400 text-slate-950'
                                    : 'border-slate-600'
                                }`}
                              >
                                {isChecked && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                              </div>
                              <span className="truncate">{opt.value}</span>
                            </div>
                            <span className="text-[10px] text-slate-500 font-mono shrink-0">
                              {opt.count}
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
