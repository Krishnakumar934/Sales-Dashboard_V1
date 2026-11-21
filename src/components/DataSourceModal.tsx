import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  X,
  UploadCloud,
  FileSpreadsheet,
  RefreshCw,
  CheckCircle2,
  Link2,
  RotateCcw,
  AlertCircle,
} from 'lucide-react';
import type { Dataset } from '../types/data.ts';
import { parseExcelWorkbookAsync } from '../utils/excelParser.ts';
import {
  DEFAULT_GOOGLE_SHEET_ID,
  DEFAULT_GOOGLE_SHEET_URL,
  extractGoogleSheetId,
  isValidGoogleSheetLinkOrId,
} from '../utils/googleSheets.ts';

interface DataSourceModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentDataset: Dataset;
  onAddNewDataset: (dataset: Dataset) => void;
  onAddNewDatasets?: (datasets: Dataset[]) => void;
  mainSheetUrl: string;
  sheetLoaded: boolean;
  sheetSyncing: boolean;
  sheetNotice: string | null;
  lastSyncedAt: string | null;
  onSyncSheetUrl: (url: string) => Promise<boolean>;
}

export const DataSourceModal: React.FC<DataSourceModalProps> = ({
  isOpen,
  onClose,
  currentDataset,
  onAddNewDataset,
  onAddNewDatasets,
  mainSheetUrl,
  sheetLoaded,
  sheetSyncing,
  sheetNotice,
  lastSyncedAt,
  onSyncSheetUrl,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [urlInput, setUrlInput] = useState(mainSheetUrl || DEFAULT_GOOGLE_SHEET_URL);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  useEffect(() => {
    setUrlInput(mainSheetUrl || DEFAULT_GOOGLE_SHEET_URL);
  }, [mainSheetUrl, isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSyncClick = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = urlInput.trim() || DEFAULT_GOOGLE_SHEET_URL;
    if (!isValidGoogleSheetLinkOrId(trimmed)) {
      setUrlError('Please enter a valid Google Sheet or Google Drive spreadsheet URL.');
      return;
    }
    setUrlError(null);
    const ok = await onSyncSheetUrl(trimmed);
    if (ok) onClose();
  };

  const handleResetToDefault = () => {
    setUrlInput(DEFAULT_GOOGLE_SHEET_URL);
    setUrlError(null);
  };

  const handleFile = async (file: File) => {
    setIsLoadingFile(true);
    setFileError(null);
    try {
      const parsedList = await parseExcelWorkbookAsync(file);
      if (onAddNewDatasets) {
        onAddNewDatasets(parsedList);
      } else {
        onAddNewDataset(parsedList[0]);
      }
      onClose();
    } catch (err: any) {
      setFileError(
        err?.message || 'Failed to parse Excel/CSV file. Please ensure it is a valid spreadsheet.'
      );
    } finally {
      setIsLoadingFile(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const resolvedId = extractGoogleSheetId(urlInput);
  const isDefaultUrl = urlInput.trim() === DEFAULT_GOOGLE_SHEET_URL;
  const isUsingSheetDataset = currentDataset.id.startsWith('gsheet-');

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Main Sheet Link and Optional File Upload"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-xs p-0 sm:p-4"
    >
      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.96, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 10 }}
        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
        className="w-full sm:max-w-lg bg-slate-900 border-t sm:border border-slate-800 rounded-t-3xl sm:rounded-2xl p-5 shadow-2xl max-h-[92vh] flex flex-col"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            <h2 className="text-base font-semibold text-white">Main Sheet Link & Data Source</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close data source dialog"
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="py-4 overflow-y-auto space-y-4 flex-1">
          {/* PRIMARY SECTION: Main Google Sheet Link (No Sign-In Required) */}
          <form
            onSubmit={handleSyncClick}
            className="bg-slate-950/80 border border-emerald-500/30 rounded-xl p-4 space-y-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-0.5 min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
                  <Link2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Main Google Sheet Link</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Primary live spreadsheet source — loads directly from the link without sign-in.
                </p>
              </div>
              {isUsingSheetDataset && sheetLoaded && (
                <span className="inline-flex items-center gap-1 text-[10px] font-mono font-semibold text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-md shrink-0">
                  <CheckCircle2 className="w-3 h-3" />
                  Active
                </span>
              )}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="main-sheet-url-input"
                className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400"
              >
                Spreadsheet Link
              </label>
              <input
                id="main-sheet-url-input"
                type="url"
                value={urlInput}
                onChange={(e) => {
                  setUrlInput(e.target.value);
                  if (urlError) setUrlError(null);
                }}
                placeholder={DEFAULT_GOOGLE_SHEET_URL}
                className="w-full text-xs font-mono bg-slate-900 border border-slate-700 focus:border-emerald-500 rounded-lg px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:outline-none"
              />
            </div>

            <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-2.5 space-y-1">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-0.5 sm:gap-2 text-[10px] text-slate-400 uppercase tracking-wider">
                <span className="whitespace-nowrap">Permanent Default ID</span>
                <span className="font-mono text-slate-300 truncate">{DEFAULT_GOOGLE_SHEET_ID}</span>
              </div>
              {resolvedId !== DEFAULT_GOOGLE_SHEET_ID && (
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-0.5 sm:gap-2 text-[10px] text-slate-400 uppercase tracking-wider">
                  <span className="whitespace-nowrap">Active Link ID</span>
                  <span className="font-mono text-emerald-300 truncate">{resolvedId}</span>
                </div>
              )}
              {lastSyncedAt && (
                <div className="text-[10px] text-emerald-400/90 font-mono">
                  Last synced: {new Date(lastSyncedAt).toLocaleString()}
                </div>
              )}
            </div>

            {(urlError || sheetNotice) && (
              <div
                role="alert"
                className="flex items-start gap-2 text-xs text-amber-200 bg-amber-950/40 border border-amber-500/30 p-2.5 rounded-lg leading-relaxed"
              >
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span>{urlError || sheetNotice}</span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <button
                type="submit"
                disabled={sheetSyncing}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 text-xs font-semibold tactile-press cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${sheetSyncing ? 'animate-spin' : ''}`} />
                <span>{sheetSyncing ? 'Loading Sheet...' : 'Sync Sheet Link'}</span>
              </button>

              {!isDefaultUrl && (
                <button
                  type="button"
                  onClick={handleResetToDefault}
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium tactile-press cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Use Default Link</span>
                </button>
              )}
            </div>
          </form>

          {/* SECONDARY SECTION: Optional Local File Upload */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300">
                Optional: Local File Upload
              </span>
              <span className="text-[11px] text-slate-500">.xlsx, .xls, .csv</span>
            </div>

            {fileError && (
              <div
                role="alert"
                className="text-xs text-rose-300 bg-rose-950/40 border border-rose-800/60 p-3 rounded-xl"
              >
                {fileError}
              </div>
            )}

            <div
              onDrop={handleDrop}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onClick={() => !isLoadingFile && fileInputRef.current?.click()}
              className={`border border-dashed rounded-xl p-4 flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                isDragging
                  ? 'border-emerald-500 bg-emerald-950/20'
                  : 'border-slate-700/80 hover:border-slate-500 bg-slate-800/35'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,text/plain,*/*"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    const f = e.target.files[0];
                    handleFile(f);
                    e.target.value = '';
                  }
                }}
                className="hidden"
              />
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0">
                  <UploadCloud className="w-4 h-4 text-slate-300" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-200 truncate">
                    {isLoadingFile ? 'Reading Spreadsheet...' : 'Upload an Excel or CSV file'}
                  </p>
                  <p className="text-[11px] text-slate-400 truncate">
                    Optional override from your phone or computer
                  </p>
                </div>
              </div>
              <span className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-medium text-xs rounded-lg shrink-0 transition-colors">
                {isLoadingFile ? 'Reading...' : 'Browse'}
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-slate-800 flex items-center justify-between gap-2">
          <span className="text-[11px] text-slate-400 truncate">
            Active: <strong className="text-slate-200">{currentDataset.name}</strong>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg tactile-press cursor-pointer shrink-0"
          >
            Close
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};
