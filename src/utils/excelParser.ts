import * as XLSX from 'xlsx';
import type { Dataset, ColumnMeta, DataRow } from '../types/data.ts';
import {
  inferColumnTypes,
  getPrimaryAmountMetric,
  findExplicitCountCol,
  findQuantityCol,
  findFinancierCol,
  findBranchCol,
  isFinanceDataset,
} from './aggregator.ts';

/**
 * Normalizes a Google Sheets share link into an exportable XLSX URL
 */
export function normalizeGoogleSheetUrl(inputUrl: string): string {
  const trimmed = inputUrl.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) {
    const docId = match[1];
    return `https://docs.google.com/spreadsheets/d/${docId}/export?format=xlsx`;
  }
  return trimmed;
}

const COMMON_DIMENSIONS = [
  'branch', 'store', 'gm', 'asm', 'financier', 'brand', 'region', 'manager', 'department',
  'category', 'segment', 'product', 'executive', 'zone', 'city', 'state'
];

const KNOWN_HEADER_KEYWORDS = [
  'branch', 'store', 'amount', 'loan amount', 'amt', 'gm', 'asm', 'date', 'month',
  'qty', 'quantity', 'discount', 'disc', 'category', 'brand', 'financier', 'invoice', 'zone', 'region',
  'sales', 'revenue', 'target', 'disbursement', 'collection', 'count'
];

/**
 * Finds the genuine header row index by scanning the first 20 rows of a 2D sheet array
 */
function findHeaderRowIndex(rows2D: any[][]): number {
  if (!rows2D || rows2D.length === 0) return 0;

  const maxScan = Math.min(rows2D.length, 20);
  let bestRowIdx = 0;
  let highestScore = -1;

  for (let r = 0; r < maxScan; r++) {
    const row = rows2D[r];
    if (!Array.isArray(row) || row.length === 0) continue;

    let matchCount = 0;
    let validStringCount = 0;
    let numericCount = 0;

    for (const cell of row) {
      if (cell !== null && cell !== undefined && cell !== '') {
        if (typeof cell === 'number') {
          // Numbers in a header row are rare (unless it's year like 2026 or sl no 1)
          if (cell > 100 && cell !== 2024 && cell !== 2025 && cell !== 2026) {
            numericCount++;
          }
        } else {
          const s = String(cell).toLowerCase().trim();
          if (s.length > 0) {
            validStringCount++;
            if (KNOWN_HEADER_KEYWORDS.some((kw) => s.includes(kw))) {
              matchCount++;
            }
          }
        }
      }
    }

    // A data row typically has many large numbers; a header row has almost exclusively strings!
    if (numericCount > 2) {
      continue; // Skip obvious data rows
    }

    // Score combines keyword matches with number of valid string column labels
    const score = matchCount * 8 + validStringCount;
    if (score > highestScore && validStringCount >= 2) {
      highestScore = score;
      bestRowIdx = r;
    }
  }

  return bestRowIdx;
}

/**
 * Normalizes and cleans raw sheet records to ensure all keys are trimmed,
 * duplicate columns are de-duplicated, and numeric fields are clean numbers.
 */
function normalizeSheetRecords(records: Record<string, any>[]): DataRow[] {
  if (!records || records.length === 0) return [];

  const rawKeys = Object.keys(records[0] || {});
  const cleanKeys: string[] = [];
  const seenKeys = new Set<string>();

  for (let i = 0; i < rawKeys.length; i++) {
    let key = String(rawKeys[i] || '').trim();
    if (!key || key.startsWith('__EMPTY')) {
      key = `Column_${i + 1}`;
    }
    // De-duplicate if needed
    let finalKey = key;
    let counter = 2;
    while (seenKeys.has(finalKey.toLowerCase())) {
      finalKey = `${key}_${counter}`;
      counter++;
    }
    seenKeys.add(finalKey.toLowerCase());
    cleanKeys.push(finalKey);
  }

  const result: DataRow[] = [];
  const len = records.length;

  for (let i = 0; i < len; i++) {
    const rawRow = records[i];
    const rowObj: DataRow = {};
    let hasSomeValue = false;

    for (let k = 0; k < rawKeys.length; k++) {
      const origKey = rawKeys[k];
      const targetKey = cleanKeys[k];
      const val = rawRow[origKey];

      if (val !== null && val !== undefined && val !== '') {
        hasSomeValue = true;
        // If string number (e.g. "1,50,000" or "₹ 500"), keep clean representation
        if (typeof val === 'number') {
          rowObj[targetKey] = val;
        } else if (typeof val === 'string') {
          const trimmed = val.trim();
          // Keep dates and categories as strings, but allow numeric strings to be cleaned
          rowObj[targetKey] = trimmed;
        } else if (val instanceof Date) {
          // SheetJS parses date cells as UTC midnight (e.g. 2026-04-01T00:00:00.000Z).
          // Guard against floating-point 23:59:59 rounding and always use UTC accessors.
          const safeDate =
            val.getUTCHours() === 23 && val.getUTCMinutes() >= 55
              ? new Date(val.getTime() + 5 * 60 * 1000)
              : val;
          const yr = safeDate.getUTCFullYear();
          const mo = String(safeDate.getUTCMonth() + 1).padStart(2, '0');
          const day = String(safeDate.getUTCDate()).padStart(2, '0');
          rowObj[targetKey] = `${yr}-${mo}-${day}`;
        } else {
          rowObj[targetKey] = val;
        }
      } else {
        rowObj[targetKey] = '';
      }
    }

    if (hasSomeValue) {
      result.push(rowObj);
    }
  }

  return result;
}

/**
 * Parses a CSV string with automatic delimiter detection and fallback
 */
function parseCsvString(csvText: string, datasetName: string): Dataset {
  let cleaned = csvText.trim();
  if (cleaned.charCodeAt(0) === 0xFEFF) {
    // Strip UTF-8 BOM
    cleaned = cleaned.slice(1);
  }

  // First try reading CSV directly via SheetJS (very robust with quotes and newlines)
  try {
    const wb = XLSX.read(cleaned, { type: 'string', raw: false });
    if (wb && wb.SheetNames && wb.SheetNames.length > 0) {
      const ws = wb.Sheets[wb.SheetNames[0]];
      const directRows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' });
      if (directRows && directRows.length > 0) {
        const firstKeys = Object.keys(directRows[0] || {});
        const hasValidKeys = firstKeys.some((k) => !k.startsWith('__EMPTY') && k.trim().length > 0);
        if (hasValidKeys) {
          const cleanData = normalizeSheetRecords(directRows);
          const columns = inferColumnTypes(cleanData);
          const dateCol = columns.find((c) => c.type === 'date')?.name || '';
          const metricCol = getPrimaryAmountMetric(columns);
          const dimCol =
            columns.find((c) =>
              COMMON_DIMENSIONS.some((dim) => c.name.toLowerCase() === dim || c.name.toLowerCase().includes(dim))
            )?.name ||
            columns.find((c) => c.type === 'category')?.name ||
            columns.find((c) => c.type === 'text' && c.name !== dateCol)?.name ||
            columns[0]?.name ||
            '';

          return {
            id: `upload-${Date.now()}`,
            name: datasetName.replace(/\.[^/.]+$/, ''),
            fileName: datasetName,
            description: `Imported CSV file with ${cleanData.length.toLocaleString()} rows and ${columns.length} columns.`,
            sheetNames: ['CSV Data'],
            activeSheet: 'CSV Data',
            rows: cleanData,
            columns,
            defaultDateCol: dateCol,
            defaultMetricCol: metricCol,
            defaultDimCol: dimCol,
          };
        }
      }
    }
  } catch {
    // Fall back to line tokenizer below
  }

  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    throw new Error('CSV file is empty.');
  }

  // Detect delimiter using the first few lines
  const sampleLines = lines.slice(0, Math.min(lines.length, 10));
  const delimiters = [',', ';', '\t', '|'];
  let bestDelim = ',';
  let maxCols = 0;

  for (const d of delimiters) {
    const counts = sampleLines.map((l) => l.split(d).length);
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
    if (avg > maxCols && avg >= 2) {
      maxCols = avg;
      bestDelim = d;
    }
  }

  // Tokenize lines
  const splitLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === bestDelim && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const rows2D = lines.slice(0, Math.min(lines.length, 25)).map(splitLine);
  const headerIdx = findHeaderRowIndex(rows2D);

  const rawHeaders = splitLine(lines[headerIdx]);
  const headers = rawHeaders.map((h, i) => {
    const trimmed = h.replace(/^["']|["']$/g, '').trim();
    return trimmed || `Column_${i + 1}`;
  });

  const dataRows: DataRow[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const values = splitLine(lines[i]);
    if (values.length === 1 && values[0] === '') continue;

    const row: DataRow = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      const rawVal = values[c] !== undefined ? values[c].replace(/^["']|["']$/g, '').trim() : '';
      row[key] = rawVal;
    }
    dataRows.push(row);
  }

  if (dataRows.length === 0) {
    throw new Error('No valid data records could be parsed from the CSV file.');
  }

  const columns = inferColumnTypes(dataRows);
  const dateCol = columns.find((c) => c.type === 'date')?.name || '';
  const metricCol = getPrimaryAmountMetric(columns);
  const dimCol =
    columns.find((c) =>
      COMMON_DIMENSIONS.some((dim) => c.name.toLowerCase() === dim || c.name.toLowerCase().includes(dim))
    )?.name ||
    columns.find((c) => c.type === 'category')?.name ||
    columns.find((c) => c.type === 'text' && c.name !== dateCol)?.name ||
    columns[0]?.name ||
    '';

  return {
    id: `upload-${Date.now()}`,
    name: datasetName.replace(/\.[^/.]+$/, ''),
    fileName: datasetName,
    description: `Imported CSV file with ${dataRows.length.toLocaleString()} rows and ${columns.length} columns.`,
    sheetNames: ['CSV Data'],
    activeSheet: 'CSV Data',
    rows: dataRows,
    columns,
    defaultDateCol: dateCol,
    defaultMetricCol: metricCol,
    defaultDimCol: dimCol,
  };
}

function fallbackIsDateFormat(fmtStr: string): boolean {
  const cleaned = fmtStr.replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, '');
  return /(?:yyyy|yy|mmm|mm|dd|d\/m|m\/d|m-y|y-m)/i.test(cleaned);
}

function excelSerialToIsoDate(serial: number, date1904: boolean): string | null {
  const ssf = XLSX.SSF ?? (XLSX as unknown as { default?: { SSF?: typeof XLSX.SSF } }).default?.SSF;
  if (ssf && typeof ssf.parse_date_code === 'function') {
    const parsed = ssf.parse_date_code(serial, { date1904 });
    if (
      parsed &&
      parsed.y >= 1900 &&
      parsed.y <= 2100 &&
      parsed.m >= 1 &&
      parsed.m <= 12 &&
      parsed.d >= 1 &&
      parsed.d <= 31
    ) {
      return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    }
  }
  const adjusted = date1904 ? serial + 1462 : serial;
  const utcDays = adjusted > 60 ? adjusted - 25569 : adjusted - 25568;
  const dt = new Date(Math.round(utcDays * 86400 * 1000) + 43200000);
  if (isNaN(dt.getTime())) return null;
  const y = dt.getUTCFullYear();
  if (y < 1900 || y > 2100) return null;
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function fastIsDateFormat(
  fmt: XLSX.NumberFormat | undefined,
  ssf: typeof XLSX.SSF | undefined,
  cache: Map<string, boolean>
): boolean {
  if (fmt === undefined || fmt === null) return false;
  const fmtStr = String(fmt).trim();
  if (!fmtStr || fmtStr === 'General' || fmtStr === '0' || fmtStr === '@') return false;
  const cached = cache.get(fmtStr);
  if (cached !== undefined) return cached;
  const result =
    ssf && typeof ssf.is_date === 'function'
      ? ssf.is_date(fmtStr)
      : fallbackIsDateFormat(fmtStr);
  cache.set(fmtStr, result);
  return result;
}

function fastTrim(str: string): string {
  const len = str.length;
  if (len === 0) return '';
  if (str.charCodeAt(0) > 32 && str.charCodeAt(len - 1) > 32) return str;
  return str.trim();
}

function resolveCellValue(
  cell: XLSX.CellObject | undefined,
  date1904: boolean,
  ssf: typeof XLSX.SSF | undefined,
  dateFormatCache: Map<string, boolean>
): any {
  if (!cell) return '';
  if (cell.t === 'n' && typeof cell.v === 'number') {
    if (cell.v <= 25000 || cell.v >= 70000) {
      return cell.v;
    }
    const hasDateNf = fastIsDateFormat(cell.z, ssf, dateFormatCache);
    const hasFormattedDateText =
      !cell.z &&
      typeof cell.w === 'string' &&
      /[a-zA-Z]{3}[-/\s]\d{2,4}|\d{1,4}[-/]\d{1,2}[-/]\d{1,4}/.test(cell.w.trim());
    if (hasDateNf || hasFormattedDateText) {
      const iso = excelSerialToIsoDate(cell.v, date1904);
      if (iso) return iso;
    }
    return cell.v;
  }
  if (cell.t === 's') {
    return typeof cell.v === 'string' ? fastTrim(cell.v) : cell.v ?? '';
  }
  if (cell.t === 'd' && cell.v instanceof Date && !isNaN(cell.v.getTime())) {
    const safeDate =
      cell.v.getUTCHours() === 23 && cell.v.getUTCMinutes() >= 55
        ? new Date(cell.v.getTime() + 5 * 60 * 1000)
        : cell.v;
    const yr = safeDate.getUTCFullYear();
    const mo = String(safeDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(safeDate.getUTCDate()).padStart(2, '0');
    return `${yr}-${mo}-${day}`;
  }
  if (cell.v === null || cell.v === undefined) return '';
  return typeof cell.v === 'string' ? fastTrim(cell.v) : cell.v;
}

function deduplicateHeaders(rawHeaders: any[]): string[] {
  const cleanKeys: string[] = [];
  const seenKeys = new Set<string>();
  for (let i = 0; i < rawHeaders.length; i++) {
    const raw = rawHeaders[i];
    let key = raw !== null && raw !== undefined ? String(raw).trim() : '';
    if (!key || key.startsWith('__EMPTY')) {
      key = `Column_${i + 1}`;
    }
    let finalKey = key;
    let counter = 2;
    while (seenKeys.has(finalKey.toLowerCase())) {
      finalKey = `${key}_${counter}`;
      counter++;
    }
    seenKeys.add(finalKey.toLowerCase());
    cleanKeys.push(finalKey);
  }
  return cleanKeys;
}

/**
 * Single-pass extraction for SheetJS dense worksheets (`ws['!data']`), avoiding millions of
 * intermediate object allocations on 150k+ row spreadsheets.
 */
function extractRowsFromDenseWorksheet(ws: XLSX.WorkSheet, date1904: boolean): DataRow[] | null {
  const dataGrid = Array.isArray((ws as any)['!data'])
    ? ((ws as any)['!data'] as (XLSX.CellObject | undefined)[][])
    : Array.isArray(ws)
    ? (ws as unknown as (XLSX.CellObject | undefined)[][])
    : undefined;
  if (!Array.isArray(dataGrid) || dataGrid.length <= 1) return null;

  const ssf = XLSX.SSF ?? (XLSX as unknown as { default?: { SSF?: typeof XLSX.SSF } }).default?.SSF;
  const dateFormatCache = new Map<string, boolean>();

  // Scan top 20 rows into plain values for header detection
  const topScanLimit = Math.min(dataGrid.length, 20);
  const top2D: any[][] = [];
  for (let r = 0; r < topScanLimit; r++) {
    const rowCells = dataGrid[r];
    if (!Array.isArray(rowCells)) {
      top2D.push([]);
      continue;
    }
    const vals: any[] = new Array(rowCells.length);
    for (let c = 0; c < rowCells.length; c++) {
      vals[c] = resolveCellValue(rowCells[c], date1904, ssf, dateFormatCache);
    }
    top2D.push(vals);
  }

  const headerIdx = findHeaderRowIndex(top2D);
  const headerCells = dataGrid[headerIdx] || [];
  let maxCols = headerCells.length;
  for (let r = headerIdx + 1; r < Math.min(dataGrid.length, headerIdx + 10); r++) {
    if (Array.isArray(dataGrid[r]) && dataGrid[r].length > maxCols) {
      maxCols = dataGrid[r].length;
    }
  }
  if (maxCols === 0) return [];

  const rawHeaders: any[] = new Array(maxCols);
  for (let c = 0; c < maxCols; c++) {
    rawHeaders[c] = resolveCellValue(headerCells[c], date1904, ssf, dateFormatCache);
  }
  const cleanKeys = deduplicateHeaders(rawHeaders);

  const extracted: DataRow[] = [];
  const totalRows = dataGrid.length;
  for (let r = headerIdx + 1; r < totalRows; r++) {
    const rowCells = dataGrid[r];
    if (!Array.isArray(rowCells) || rowCells.length === 0) continue;

    const rowObj: DataRow = {};
    let hasValue = false;
    for (let c = 0; c < cleanKeys.length; c++) {
      const val = resolveCellValue(rowCells[c], date1904, ssf, dateFormatCache);
      if (val !== '') {
        hasValue = true;
      }
      rowObj[cleanKeys[c]] = val;
    }
    if (hasValue) {
      extracted.push(rowObj);
    }
  }

  return extracted;
}

/**
 * Converts Excel serial date cells in a sparse worksheet directly into timezone-free 'YYYY-MM-DD' strings.
 */
function convertWorksheetDateCells(ws: XLSX.WorkSheet, date1904: boolean): void {
  const ssf = XLSX.SSF ?? (XLSX as unknown as { default?: { SSF?: typeof XLSX.SSF } }).default?.SSF;
  const dateFormatCache = new Map<string, boolean>();

  for (const addr in ws) {
    if (addr.charCodeAt(0) === 33) continue; // skip '!' metadata keys
    const cell = ws[addr] as XLSX.CellObject | undefined;
    if (!cell) continue;

    if (cell.t === 'n' && typeof cell.v === 'number') {
      if (cell.v > 25000 && cell.v < 70000) {
        const hasDateNf = fastIsDateFormat(cell.z, ssf, dateFormatCache);
        const hasFormattedDateText =
          !cell.z &&
          typeof cell.w === 'string' &&
          /[a-zA-Z]{3}[-/\s]\d{2,4}|\d{1,4}[-/]\d{1,2}[-/]\d{1,4}/.test(cell.w.trim());

        if (hasDateNf || hasFormattedDateText) {
          const iso = excelSerialToIsoDate(cell.v, date1904);
          if (iso) {
            cell.t = 's';
            cell.v = iso;
            cell.w = iso;
          }
        }
      }
    } else if (cell.t === 'd' && cell.v instanceof Date && !isNaN(cell.v.getTime())) {
      const safeDate =
        cell.v.getUTCHours() === 23 && cell.v.getUTCMinutes() >= 55
          ? new Date(cell.v.getTime() + 5 * 60 * 1000)
          : cell.v;
      const yr = safeDate.getUTCFullYear();
      const mo = String(safeDate.getUTCMonth() + 1).padStart(2, '0');
      const day = String(safeDate.getUTCDate()).padStart(2, '0');
      const iso = `${yr}-${mo}-${day}`;
      cell.t = 's';
      cell.v = iso;
      cell.w = iso;
    }
  }
}

function extractRowsFromWorksheet(ws: XLSX.WorkSheet): DataRow[] {
  const directRecords = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' });

  if (directRecords.length > 0) {
    const firstRowKeys = Object.keys(directRecords[0] || {});
    const emptyKeyCount = firstRowKeys.filter((k) => k.startsWith('__EMPTY')).length;

    if (emptyKeyCount <= firstRowKeys.length * 0.5) {
      return normalizeSheetRecords(directRecords);
    }
  }

  const rows2D = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' });
  if (!rows2D || rows2D.length <= 1) {
    return [];
  }

  const headerIdx = findHeaderRowIndex(rows2D);
  const rawHeaders = rows2D[headerIdx] || [];
  const headers = rawHeaders.map((c: any, i: number) => {
    const s = c !== null && c !== undefined ? String(c).trim() : '';
    return s || `Column_${i + 1}`;
  });

  const extracted: DataRow[] = [];
  for (let r = headerIdx + 1; r < rows2D.length; r++) {
    const rowArr = rows2D[r];
    if (!rowArr || rowArr.length === 0) continue;
    const rowObj: DataRow = {};
    let hasVal = false;
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      const v = rowArr[c];
      if (v !== null && v !== undefined && v !== '') {
        hasVal = true;
        rowObj[key] = v;
      } else {
        rowObj[key] = '';
      }
    }
    if (hasVal) extracted.push(rowObj);
  }

  return normalizeSheetRecords(extracted);
}

function buildDatasetFromRows(
  rows: DataRow[],
  resolvedName: string,
  sheetName: string,
  sheetNames: string[],
  idSuffix = ''
): Dataset {
  const columns = inferColumnTypes(rows);
  const finance = isFinanceDataset(columns) || /finance/i.test(sheetName);
  const dateCol = columns.find((c) => c.type === 'date')?.name || '';
  const metricCol = getPrimaryAmountMetric(columns);
  const countCol = findExplicitCountCol(columns) || findQuantityCol(columns) || '';

  let dimCol = '';
  if (finance) {
    dimCol = findFinancierCol(columns) || findBranchCol(columns) || '';
  }
  if (!dimCol) {
    dimCol =
      columns.find((c) =>
        COMMON_DIMENSIONS.some((dim) => c.name.toLowerCase() === dim || c.name.toLowerCase().includes(dim))
      )?.name ||
      columns.find((c) => c.type === 'category')?.name ||
      columns.find((c) => c.type === 'text' && c.name !== dateCol)?.name ||
      columns[0]?.name ||
      '';
  }

  const cleanFile = resolvedName.replace(/\.[^/.]+$/, '');
  const slug = sheetName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sheet';

  return {
    id: `upload-${Date.now()}${idSuffix ? `-${idSuffix}` : ''}-${slug}`,
    name: sheetNames.length > 1 ? sheetName : cleanFile,
    fileName: resolvedName,
    description: `Imported spreadsheet (${sheetName}) with ${rows.length.toLocaleString()} rows and ${columns.length} columns.`,
    sheetNames,
    activeSheet: sheetName,
    reportType: finance ? 'finance' : 'sales',
    rows,
    columns,
    defaultDateCol: dateCol,
    defaultMetricCol: metricCol,
    defaultDimCol: dimCol,
    defaultCountCol: countCol,
  };
}

/**
 * Parses all valid data worksheets from an Excel or CSV file (File or ArrayBuffer) into Datasets.
 */
export async function parseExcelWorkbook(
  fileOrBuffer: File | ArrayBuffer,
  fileName = 'Spreadsheet.xlsx'
): Promise<Dataset[]> {
  let arrayBuffer: ArrayBuffer;
  let resolvedName = fileName;

  if (fileOrBuffer instanceof File) {
    arrayBuffer = await fileOrBuffer.arrayBuffer();
    resolvedName = fileOrBuffer.name || 'Spreadsheet.xlsx';
  } else {
    arrayBuffer = fileOrBuffer;
  }

  const isCsv =
    resolvedName.toLowerCase().endsWith('.csv') ||
    resolvedName.toLowerCase().endsWith('.tsv') ||
    resolvedName.toLowerCase().endsWith('.txt');

  if (isCsv) {
    try {
      const textDecoder = new TextDecoder('utf-8');
      const text = textDecoder.decode(arrayBuffer);
      if (text && text.trim().length > 0) {
        return [parseCsvString(text, resolvedName)];
      }
    } catch {
      // Fall through to SheetJS
    }
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(arrayBuffer, {
      type: 'array',
      dense: true,
      cellDates: false,
      cellNF: true,
    });
  } catch (err: any) {
    try {
      const decoder = new TextDecoder('utf-8');
      const text = decoder.decode(arrayBuffer);
      return [parseCsvString(text, resolvedName)];
    } catch {
      throw new Error(`Failed to open spreadsheet file: ${err?.message || 'Unsupported format'}.`);
    }
  }

  const sheetNames = workbook.SheetNames;
  if (!sheetNames || sheetNames.length === 0) {
    throw new Error('The spreadsheet contains no worksheets.');
  }

  const date1904 = Boolean(workbook.Workbook?.WBProps?.date1904);
  const parsedDatasets: Dataset[] = [];
  const multiStamp = Date.now();

  for (let idx = 0; idx < sheetNames.length; idx++) {
    const sName = sheetNames[idx];
    const ws = workbook.Sheets[sName];
    if (!ws) continue;

    let rows = extractRowsFromDenseWorksheet(ws, date1904);
    if (!rows) {
      convertWorksheetDateCells(ws, date1904);
      rows = extractRowsFromWorksheet(ws);
    }
    if (rows.length === 0) continue;

    const colCount = Object.keys(rows[0] || {}).length;
    if (colCount < 2 && sheetNames.length > 1) {
      // Skip single-column cover/note tabs when multi-sheet workbook has data sheets
      continue;
    }

    const ds = buildDatasetFromRows(rows, resolvedName, sName, sheetNames, `${multiStamp}-${idx}`);
    parsedDatasets.push(ds);
  }

  if (parsedDatasets.length === 0) {
    throw new Error('The spreadsheet contains no data rows.');
  }

  return parsedDatasets;
}

/**
 * Parses a workbook off the main UI thread using a Web Worker when running in the browser,
 * preventing UI freezes on 150k+ row spreadsheets while falling back cleanly in Node/SSR.
 */
export async function parseExcelWorkbookAsync(
  fileOrBuffer: File | ArrayBuffer,
  fileName = 'Spreadsheet.xlsx'
): Promise<Dataset[]> {
  if (typeof Worker === 'undefined') {
    return parseExcelWorkbook(fileOrBuffer, fileName);
  }

  let arrayBuffer: ArrayBuffer;
  let resolvedName = fileName;
  if (fileOrBuffer instanceof File) {
    arrayBuffer = await fileOrBuffer.arrayBuffer();
    resolvedName = fileOrBuffer.name || 'Spreadsheet.xlsx';
  } else {
    arrayBuffer = fileOrBuffer;
  }

  try {
    return await new Promise<Dataset[]>((resolve, reject) => {
      let worker: Worker | null = null;
      let settled = false;
      const requestId = Date.now() + Math.random();

      const cleanup = () => {
        if (worker) {
          worker.onmessage = null;
          worker.onerror = null;
          worker.terminate();
          worker = null;
        }
      };

      try {
        worker = new Worker(new URL('./excelWorker.ts', import.meta.url), { type: 'module' });
      } catch (err) {
        cleanup();
        reject(err);
        return;
      }

      worker.onmessage = (
        event: MessageEvent<{ id: number; ok: boolean; datasets?: Dataset[]; error?: string }>
      ) => {
        if (settled || event.data?.id !== requestId) return;
        settled = true;
        cleanup();
        if (event.data.ok && event.data.datasets) {
          resolve(event.data.datasets);
        } else {
          reject(new Error(event.data?.error || 'Failed to parse spreadsheet.'));
        }
      };

      worker.onerror = (event) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(event?.message || 'Spreadsheet worker error'));
      };

      // Intentionally structured-clone without transferring ownership so the caller's
      // ArrayBuffer stays intact if a fallback parse on main thread is ever needed.
      worker.postMessage({ id: requestId, buffer: arrayBuffer, fileName: resolvedName });
    });
  } catch {
    return parseExcelWorkbook(arrayBuffer, resolvedName);
  }
}

/**
 * Parses an Excel or CSV file (File or ArrayBuffer) into the primary Dataset (largest worksheet)
 */
export async function parseExcelFile(
  fileOrBuffer: File | ArrayBuffer,
  fileName = 'Spreadsheet.xlsx'
): Promise<Dataset> {
  const datasets = await parseExcelWorkbook(fileOrBuffer, fileName);
  if (datasets.length === 1) return datasets[0];

  let best = datasets[0];
  for (const ds of datasets) {
    if (ds.rows.length > best.rows.length) {
      best = ds;
    }
  }
  return best;
}

/**
 * Fetches and parses a remote Excel or Google Sheet export URL
 */
export async function fetchAndParseUrl(url: string, title = 'Online Sheet'): Promise<Dataset> {
  const exportUrl = normalizeGoogleSheetUrl(url);

  const res = await fetch(exportUrl);
  if (!res.ok) {
    throw new Error(
      `Failed to download spreadsheet: HTTP ${res.status}. If using Google Sheets, make sure the sheet is shared as "Anyone with link can view".`
    );
  }

  const buffer = await res.arrayBuffer();
  return parseExcelFile(buffer, `${title}.xlsx`);
}

/**
 * Parses pasted text (TSV copied from Excel, CSV, or multiline table) directly into a Dataset
 */
export function parsePastedData(text: string, datasetName = 'Pasted Data'): Dataset {
  let cleaned = text.trim();
  if (!cleaned) {
    throw new Error('Pasted text is empty. Please copy table cells from Excel or Google Sheets.');
  }

  if (cleaned.includes('\\n') && !cleaned.includes('\n')) {
    cleaned = cleaned.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  }

  return parseCsvString(cleaned, datasetName);
}

/**
 * Exports data rows to an Excel (.xlsx) file download
 */
export function exportToExcel(rows: DataRow[], fileName = 'exported_data.xlsx') {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Filtered Data');
  XLSX.writeFile(workbook, fileName);
}
