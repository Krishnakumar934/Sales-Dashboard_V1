import React, { useState, useMemo } from 'react';
import { ArrowUpDown, Download, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import type { ColumnMeta, DataRow } from '../types/data.ts';
import { exportToExcel } from '../utils/excelParser.ts';

interface DataTableProps {
  rows: DataRow[];
  columns: ColumnMeta[];
  datasetName: string;
}

export const DataTable: React.FC<DataTableProps> = ({
  rows,
  columns,
  datasetName,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortCol, setSortCol] = useState<string>(columns[0]?.name || '');
  const [sortAsc, setSortAsc] = useState<boolean>(true);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(15);

  // Fast single-pass search filter with memoization
  const filtered = useMemo(() => {
    if (!rows || rows.length === 0) return [];
    if (!searchTerm.trim()) return rows;

    const q = searchTerm.toLowerCase().trim();
    const result: DataRow[] = [];
    const maxSearchHits = 5000; // Keep table responsive

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const values = Object.values(r);
      for (let j = 0; j < values.length; j++) {
        const v = values[j];
        if (v !== null && v !== undefined && String(v).toLowerCase().includes(q)) {
          result.push(r);
          break;
        }
      }
      if (result.length >= maxSearchHits) break;
    }

    return result;
  }, [rows, searchTerm]);

  // Fast sorting with memoization
  const sorted = useMemo(() => {
    if (!filtered || filtered.length === 0) return [];
    if (!sortCol) return filtered;

    // For datasets > 25,000 rows, slice first 25,000 for responsive UI sorting
    const toSort = filtered.length > 25000 ? filtered.slice(0, 25000) : [...filtered];

    return toSort.sort((a, b) => {
      const aVal = a[sortCol];
      const bVal = b[sortCol];

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortAsc ? aVal - bVal : bVal - aVal;
      }
      const aStr = String(aVal ?? '');
      const bStr = String(bVal ?? '');
      return sortAsc ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
    });
  }, [filtered, sortCol, sortAsc]);

  const totalRecords = rows ? rows.length : 0;
  const filteredCount = filtered ? filtered.length : 0;
  const totalPages = Math.ceil(filteredCount / pageSize) || 1;
  const currentPage = Math.min(page, totalPages);
  const startIdx = (currentPage - 1) * pageSize;
  const paginatedRows = sorted.slice(startIdx, startIdx + pageSize);

  const handleSort = (colName: string) => {
    if (sortCol === colName) {
      setSortAsc(!sortAsc);
    } else {
      setSortCol(colName);
      setSortAsc(true);
    }
  };

  const handleExport = () => {
    // Export up to 50,000 rows to Excel file
    const exportSample = rows.length > 50000 ? rows.slice(0, 50000) : rows;
    exportToExcel(exportSample, `${datasetName.toLowerCase().replace(/\s+/g, '_')}_data.xlsx`);
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 sm:p-5 flex flex-col space-y-3">
      {/* Table Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-3" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
              placeholder="Search table rows..."
              className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:border-emerald-500"
            />
          </div>
          <span className="text-xs text-slate-400 font-mono whitespace-nowrap">
            {totalRecords.toLocaleString()} rows
          </span>
        </div>

        <button
          onClick={handleExport}
          className="flex items-center justify-center gap-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg px-3 py-1.5 transition-colors"
        >
          <Download className="w-3.5 h-3.5 text-emerald-400" />
          <span>Export Excel {totalRecords > 50000 ? '(50k rows)' : ''}</span>
        </button>
      </div>

      {/* Responsive Table Container */}
      <div className="overflow-x-auto border border-slate-800 rounded-lg">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-800/80 text-slate-400 font-medium border-b border-slate-800">
            <tr>
              {columns.map((col) => {
                const isSorted = sortCol === col.name;
                return (
                  <th
                    key={col.name}
                    onClick={() => handleSort(col.name)}
                    className="p-2.5 cursor-pointer hover:text-white transition-colors whitespace-nowrap select-none"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>{col.name}</span>
                      <ArrowUpDown
                        className={`w-3 h-3 ${
                          isSorted ? 'text-emerald-400' : 'text-slate-600'
                        }`}
                      />
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-mono">
            {paginatedRows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="p-6 text-center text-slate-400 font-sans"
                >
                  No matching records found.
                </td>
              </tr>
            ) : (
              paginatedRows.map((row, rIdx) => (
                <tr
                  key={rIdx}
                  className="hover:bg-slate-800/40 transition-colors"
                >
                  {columns.map((col) => {
                    const val = row[col.name];
                    const isNum = col.type === 'number';
                    return (
                      <td
                        key={col.name}
                        className={`p-2.5 whitespace-nowrap ${
                          isNum ? 'text-right tabular-nums' : ''
                        }`}
                      >
                        {val !== null && val !== undefined
                          ? isNum && typeof val === 'number'
                            ? val.toLocaleString()
                            : String(val)
                          : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
        <div className="flex items-center gap-2">
          <span>Rows per page:</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            className="bg-slate-800 border border-slate-700 text-slate-200 rounded px-2 py-1 text-xs"
          >
            <option value={10}>10</option>
            <option value={15}>15</option>
            <option value={30}>30</option>
            <option value={50}>50</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <span>
            Page {currentPage} of {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              aria-label="Previous Page"
              className="p-1 rounded bg-slate-800 border border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-700 text-slate-300"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              aria-label="Next Page"
              className="p-1 rounded bg-slate-800 border border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-700 text-slate-300"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
