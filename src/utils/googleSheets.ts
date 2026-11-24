import type { Dataset, DataRow } from '../types/data.ts';
import { getPrimaryAmountMetric, inferColumnTypes, isFinanceDataset } from './aggregator.ts';
import { parseExcelWorkbookAsync } from './excelParser.ts';
import { decodeColumnarWorkbook, type ColumnarWorkbookPayload } from './columnarPacker.ts';
import { normalizeParsedWorkbookDatasets } from './sheetFallbackParser.ts';

export type SheetSyncStage = 'idle' | 'connecting' | 'downloading' | 'parsing' | 'finalizing';

export const DEFAULT_GOOGLE_SHEET_ID = '1C4h8D0EtwYpWir5o128d_L1tMNMZeDuH';
export const DEFAULT_GOOGLE_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1C4h8D0EtwYpWir5o128d_L1tMNMZeDuH/edit?usp=drive_link&ouid=106213966809826927357&rtpof=true&sd=true';
export const DEFAULT_SHEET_DATASET_ID = `gsheet-${DEFAULT_GOOGLE_SHEET_ID}`;
const DEFAULT_SHEET_CACHE_KEY = 'pulsegrid_permanent_default_sheet_v3';
const LEGACY_SHEET_CACHE_KEYS = ['pulsegrid_permanent_default_sheet_v1', 'pulsegrid_permanent_default_sheet_v2'];
const MAIN_SHEET_URL_STORAGE_KEY = 'pulsegrid_main_sheet_url_v1';

const COMMON_DIMENSIONS = [
  'branch',
  'store',
  'gm',
  'asm',
  'region',
  'manager',
  'department',
  'category',
  'segment',
  'product',
  'executive',
  'zone',
  'city',
  'state',
];

/**
 * Extracts a Google Sheets / Drive file ID from a full URL or raw ID string.
 * Falls back to the permanent default sheet ID if input is blank.
 */
export function extractGoogleSheetId(input: string): string {
  const trimmed = (input || '').trim();
  if (!trimmed) return DEFAULT_GOOGLE_SHEET_ID;

  const pathMatch = trimmed.match(/\/(?:spreadsheets\/d|file\/d)\/([a-zA-Z0-9-_]+)/);
  if (pathMatch) return pathMatch[1];

  const queryMatch = trimmed.match(/[?&]id=([a-zA-Z0-9-_]{10,})/);
  if (queryMatch) return queryMatch[1];

  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed;
  return DEFAULT_GOOGLE_SHEET_ID;
}

/**
 * Checks if a user-entered string is a plausible Google Sheets / Drive URL or raw sheet ID.
 */
export function isValidGoogleSheetLinkOrId(input: string): boolean {
  const trimmed = (input || '').trim();
  if (!trimmed) return false;
  if (/\/(?:spreadsheets\/d|file\/d)\/[a-zA-Z0-9-_]{10,}/.test(trimmed)) return true;
  if (/docs\.google\.com\/spreadsheets\/d\/e\/[a-zA-Z0-9-_]+/.test(trimmed)) return true;
  if (/[?&]id=[a-zA-Z0-9-_]{10,}/.test(trimmed)) return true;
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return true;
  return false;
}

/**
 * Converts 2D cell arrays into a structured PulseGrid Dataset,
 * choosing the tab with the highest record count.
 */
export function convertSheetsValuesToDataset(
  spreadsheetTitle: string,
  tabs: { title: string; values: any[][] }[],
  sheetId = DEFAULT_GOOGLE_SHEET_ID
): Dataset {
  const nonEmptyTabs = tabs.filter((t) => Array.isArray(t.values) && t.values.length > 1);
  if (nonEmptyTabs.length === 0) {
    throw new Error('The Google Sheet does not contain any populated data rows.');
  }

  let bestTab = nonEmptyTabs[0];
  for (const tab of nonEmptyTabs) {
    if (tab.values.length > bestTab.values.length) {
      bestTab = tab;
    }
  }

  const rows2D = bestTab.values;
  let headerIdx = 0;
  for (let r = 0; r < Math.min(rows2D.length, 15); r++) {
    const row = rows2D[r] || [];
    const nonEmptyCount = row.filter((c) => c !== null && c !== undefined && String(c).trim() !== '').length;
    if (nonEmptyCount >= 2) {
      headerIdx = r;
      break;
    }
  }

  const rawHeaders = rows2D[headerIdx] || [];
  const seen = new Set<string>();
  const headers = rawHeaders.map((cell, idx) => {
    let base = cell !== null && cell !== undefined ? String(cell).trim() : '';
    if (!base) base = `Column_${idx + 1}`;
    let finalKey = base;
    let suffix = 2;
    while (seen.has(finalKey.toLowerCase())) {
      finalKey = `${base}_${suffix}`;
      suffix++;
    }
    seen.add(finalKey.toLowerCase());
    return finalKey;
  });

  const dataRows: DataRow[] = [];
  for (let r = headerIdx + 1; r < rows2D.length; r++) {
    const rowArr = rows2D[r] || [];
    const obj: DataRow = {};
    let hasValue = false;
    for (let c = 0; c < headers.length; c++) {
      const val = rowArr[c];
      if (val !== null && val !== undefined && String(val).trim() !== '') {
        hasValue = true;
        obj[headers[c]] = typeof val === 'string' ? val.trim() : val;
      } else {
        obj[headers[c]] = '';
      }
    }
    if (hasValue) dataRows.push(obj);
  }

  if (dataRows.length === 0) {
    throw new Error(`Worksheet "${bestTab.title}" contains headers but no data rows.`);
  }

  const columns = inferColumnTypes(dataRows);
  const dateCol = columns.find((c) => c.type === 'date')?.name || '';
  const metricCol = getPrimaryAmountMetric(columns);
  const dimCol =
    columns.find((c) =>
      COMMON_DIMENSIONS.some(
        (dim) => c.name.toLowerCase() === dim || c.name.toLowerCase().includes(dim)
      )
    )?.name ||
    columns.find((c) => c.type === 'category')?.name ||
    columns.find((c) => c.type === 'text' && c.name !== dateCol)?.name ||
    columns[0]?.name ||
    '';

  const cleanTitle = (spreadsheetTitle || 'Main Google Sheet').replace(/\.[^/.]+$/, '');

  return {
    id: sheetId === DEFAULT_GOOGLE_SHEET_ID ? DEFAULT_SHEET_DATASET_ID : `gsheet-${sheetId}`,
    name: cleanTitle,
    fileName: `${cleanTitle} (Google Sheet)`,
    description: `Main Sheet Link (${bestTab.title}) · ${dataRows.length.toLocaleString('en-IN')} rows`,
    sheetNames: tabs.map((t) => t.title),
    activeSheet: bestTab.title,
    rows: dataRows,
    columns,
    defaultDateCol: dateCol,
    defaultMetricCol: metricCol,
    defaultDimCol: dimCol,
  };
}

export type FetchSheetResult =
  | { status: 'ok'; dataset: Dataset; datasets: Dataset[]; sheetId: string }
  | { status: 'restricted'; sheetId: string; message: string };

/**
 * Fetches a Google Sheet or Google Drive spreadsheet link via the server proxy
 * without requiring Google Sign-In, extracting all worksheets (e.g. Sales Report & Finance Data).
 */
export async function fetchSheetFromLink(
  sheetUrlOrId = DEFAULT_GOOGLE_SHEET_URL,
  options?: {
    forceRefresh?: boolean;
    onStageChange?: (stage: SheetSyncStage, label: string) => void;
  }
): Promise<FetchSheetResult> {
  const target = (sheetUrlOrId || '').trim() || DEFAULT_GOOGLE_SHEET_URL;
  options?.onStageChange?.('connecting', 'Connecting to Google Drive workbook...');

  let res: Response | null = null;
  let lastFetchErr: any = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await fetch('/api/sheets/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sheetUrl: target,
          forceRefresh: Boolean(options?.forceRefresh),
          format: 'columnar',
        }),
      });
      if (res.ok || (res.status >= 400 && res.status < 500)) {
        break;
      }
      lastFetchErr = new Error(`Unable to fetch sheet link (HTTP ${res.status}).`);
    } catch (err) {
      lastFetchErr = err;
    }
    if (attempt === 0) {
      options?.onStageChange?.('connecting', 'Waking server & retrying Google Drive workbook...');
      await new Promise((r) => setTimeout(r, 1200));
    }
  }

  if (!res) {
    throw lastFetchErr || new Error('Network error while connecting to Google Drive workbook.');
  }

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson?.error || `Unable to fetch sheet link (HTTP ${res.status}).`);
  }

  const sheetEncoding = res.headers.get('x-sheet-encoding') || '';
  const contentType = res.headers.get('content-type') || '';

  if (sheetEncoding === 'columnar-v1') {
    options?.onStageChange?.('downloading', 'Downloading compressed Sales & Finance sheets...');
    const payload = (await res.json()) as ColumnarWorkbookPayload;
    options?.onStageChange?.('parsing', 'Unpacking Sales Report & Finance Data...');
    const decoded = decodeColumnarWorkbook(payload);
    if (decoded.length === 0) {
      throw new Error('The Google Sheet returned no valid worksheets.');
    }
    const resolvedSheetId = payload.sheetId || res.headers.get('x-sheet-id') || extractGoogleSheetId(target);
    const hasFinance = decoded.some((d) => d.reportType === 'finance' || isFinanceDataset(d.columns));
    if (resolvedSheetId === DEFAULT_GOOGLE_SHEET_ID && !hasFinance && !options?.forceRefresh) {
      options?.onStageChange?.('connecting', 'Refreshing full Sales & Finance workbook...');
      return fetchSheetFromLink(target, { ...options, forceRefresh: true });
    }
    options?.onStageChange?.('finalizing', 'Finalizing live dashboard totals...');
    const primary = decoded.find((d) => d.reportType !== 'finance') || decoded[0];
    return {
      status: 'ok',
      sheetId: resolvedSheetId,
      dataset: primary,
      datasets: decoded,
    };
  }

  if (contentType.includes('application/json')) {
    const json = (await res.json().catch(() => ({}))) as {
      accessible?: boolean;
      sheetId?: string;
      message?: string;
    };
    return {
      status: 'restricted',
      sheetId: json?.sheetId || extractGoogleSheetId(target),
      message:
        json?.message ||
        'This Google Sheet link is currently set to Restricted. In Google Drive/Sheets, open Share → General access → change to "Anyone with the link" (Viewer), then click Sync Sheet.',
    };
  }

  options?.onStageChange?.('downloading', 'Downloading Google Drive workbook...');
  const sheetId = res.headers.get('x-sheet-id') || extractGoogleSheetId(target);
  const sheetFormat = res.headers.get('x-sheet-format') || 'xlsx';
  const ext = sheetFormat === 'csv' ? 'csv' : 'xlsx';
  const displayName =
    sheetId === DEFAULT_GOOGLE_SHEET_ID ? 'Main Operations Sheet' : `Google Sheet (${sheetId.slice(0, 8)})`;

  const buffer = await res.arrayBuffer();
  options?.onStageChange?.('parsing', 'Parsing Sales Report & Finance Data...');
  const parsedSheets = await parseExcelWorkbookAsync(buffer, `${displayName}.${ext}`);
  const normalizedDatasets = normalizeParsedWorkbookDatasets(
    parsedSheets,
    sheetId,
    DEFAULT_GOOGLE_SHEET_ID,
    ext
  );

  const hasFinance = normalizedDatasets.some(
    (d) => d.reportType === 'finance' || isFinanceDataset(d.columns)
  );
  if (sheetId === DEFAULT_GOOGLE_SHEET_ID && !hasFinance && !options?.forceRefresh) {
    options?.onStageChange?.('connecting', 'Refreshing full Sales & Finance workbook...');
    return fetchSheetFromLink(target, { ...options, forceRefresh: true });
  }

  options?.onStageChange?.('finalizing', 'Finalizing live dashboard totals...');
  const primary =
    normalizedDatasets.find((d) => d.reportType !== 'finance') || normalizedDatasets[0];

  return {
    status: 'ok',
    sheetId,
    dataset: primary,
    datasets: normalizedDatasets,
  };
}

export async function fetchPublicDefaultSheet(): Promise<FetchSheetResult> {
  return fetchSheetFromLink(DEFAULT_GOOGLE_SHEET_URL);
}

export function loadSavedMainSheetUrl(): string {
  try {
    if (typeof window === 'undefined') return DEFAULT_GOOGLE_SHEET_URL;
    const saved = window.localStorage.getItem(MAIN_SHEET_URL_STORAGE_KEY);
    return saved && saved.trim() ? saved.trim() : DEFAULT_GOOGLE_SHEET_URL;
  } catch {
    return DEFAULT_GOOGLE_SHEET_URL;
  }
}

export function saveMainSheetUrl(url: string): string {
  const clean = (url || '').trim() || DEFAULT_GOOGLE_SHEET_URL;
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(MAIN_SHEET_URL_STORAGE_KEY, clean);
    }
  } catch {
    // Ignore storage quota errors
  }
  return clean;
}

export function loadCachedDefaultSheetDatasets(): { datasets: Dataset[]; syncedAt: string } | null {
  try {
    if (typeof window === 'undefined') return null;
    for (const legacyKey of LEGACY_SHEET_CACHE_KEYS) {
      window.localStorage.removeItem(legacyKey);
    }
    const raw = window.localStorage.getItem(DEFAULT_SHEET_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.datasets) && parsed.datasets.length > 0) {
      return {
        datasets: parsed.datasets as Dataset[],
        syncedAt: String(parsed.syncedAt || ''),
      };
    }
    if (parsed?.dataset?.rows?.length > 0 && parsed?.dataset?.columns?.length > 0) {
      return {
        datasets: [parsed.dataset as Dataset],
        syncedAt: String(parsed.syncedAt || ''),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveCachedDefaultSheetDatasets(datasets: Dataset[]): string {
  const syncedAt = new Date().toISOString();
  const totalRows = datasets.reduce((sum, ds) => sum + (ds.rows?.length || 0), 0);
  try {
    if (typeof window !== 'undefined') {
      if (totalRows > 15000) {
        // Large workbooks (e.g. 300k+ rows) exceed browser localStorage ~5MB quota;
        // skip blocking JSON.stringify serialization on the UI main thread.
        window.localStorage.removeItem(DEFAULT_SHEET_CACHE_KEY);
      } else {
        window.localStorage.setItem(
          DEFAULT_SHEET_CACHE_KEY,
          JSON.stringify({ datasets, syncedAt })
        );
      }
    }
  } catch {
    // Ignore storage quota errors cleanly for very large spreadsheets
  }
  return syncedAt;
}

export function loadCachedDefaultSheetDataset(): { dataset: Dataset; syncedAt: string } | null {
  const multi = loadCachedDefaultSheetDatasets();
  if (!multi || multi.datasets.length === 0) return null;
  return { dataset: multi.datasets[0], syncedAt: multi.syncedAt };
}

export function saveCachedDefaultSheetDataset(dataset: Dataset): string {
  return saveCachedDefaultSheetDatasets([dataset]);
}
