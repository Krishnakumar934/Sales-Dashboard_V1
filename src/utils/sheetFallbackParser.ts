import type { Dataset } from '../types/data.ts';
import { isFinanceDataset } from './aggregator.ts';

export interface HtmlViewSheetTab {
  name: string;
  gid: string;
}

/**
 * Extracts worksheet names and numeric GIDs from Google Sheets `/htmlview` or `/edit` HTML.
 */
export function parseGoogleSheetsHtmlViewTabs(html: string): HtmlViewSheetTab[] {
  if (!html || typeof html !== 'string') return [];

  const tabs: HtmlViewSheetTab[] = [];
  const seenGids = new Set<string>();

  const pushTab = (rawName: string, rawGid: string) => {
    const cleanGid = String(rawGid || '').trim();
    if (!cleanGid || !/^\d+$/.test(cleanGid) || seenGids.has(cleanGid)) return;
    let cleanName = String(rawName || '')
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, '\\')
      .trim();
    if (!cleanName) cleanName = `Sheet_${cleanGid}`;
    seenGids.add(cleanGid);
    tabs.push({ name: cleanName, gid: cleanGid });
  };

  // Match items.push({name: "...", pageUrl: "...", gid: "...", ...}) blocks in htmlview
  const itemBlockRe = /items\.push\(\{([^}]+)\}\)/g;
  for (const match of html.matchAll(itemBlockRe)) {
    const block = match[1];
    const nameMatch = block.match(/name\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/);
    const gidMatch = block.match(/gid\s*:\s*["'](\d+)["']/);
    if (nameMatch && gidMatch) {
      const unquotedName = nameMatch[1].slice(1, -1);
      pushTab(unquotedName, gidMatch[1]);
    }
  }

  // Fallback regex for direct switchToSheet/bootstrap payloads if items.push syntax changes
  if (tabs.length === 0) {
    const altRe = /["']name["']\s*:\s*["']([^"']+)["'][^}]{0,220}["'](?:gid|sheetId)["']\s*:\s*["']?(\d+)["']?/g;
    for (const match of html.matchAll(altRe)) {
      pushTab(match[1], match[2]);
    }
  }

  return tabs;
}

/**
 * Normalizes parsed sheet datasets cleanly with deterministic IDs and Sales vs Finance classification.
 */
export function normalizeParsedWorkbookDatasets(
  parsedSheets: Dataset[],
  sheetId: string,
  defaultSheetId: string,
  ext: string
): Dataset[] {
  const cleanExt = ext.replace(/^\./, '') || 'xlsx';
  const displayName =
    sheetId === defaultSheetId
      ? 'Main Operations Sheet'
      : `Google Sheet (${sheetId.slice(0, 8)})`;
  const baseId =
    sheetId === defaultSheetId ? `gsheet-${defaultSheetId}` : `gsheet-${sheetId}`;

  return parsedSheets.map((ds, idx) => {
    const slug =
      ds.activeSheet
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || `sheet-${idx + 1}`;
    const isFinance =
      ds.reportType === 'finance' ||
      isFinanceDataset(ds.columns) ||
      /finance/i.test(ds.activeSheet);

    return {
      ...ds,
      id: parsedSheets.length === 1 && idx === 0 ? baseId : `${baseId}--${slug}`,
      name: parsedSheets.length > 1 ? ds.activeSheet : displayName,
      fileName: `${displayName}.${cleanExt}`,
      reportType: isFinance ? 'finance' : 'sales',
      description: `Main Sheet Link (${ds.activeSheet}) · ${ds.rows.length.toLocaleString('en-IN')} rows`,
    };
  });
}

/**
 * Prevents incomplete 1-sheet CSV fallbacks from poisoning the long-lived server cache
 * when a multi-sheet Google Workbook temporarily fails binary XLSX download.
 */
export function getSheetCacheTtlMs(
  format: 'xlsx' | 'multi-csv' | 'csv',
  tabCount: number,
  sheetId: string,
  defaultSheetId: string,
  defaultTtlMs = 10 * 60 * 1000
): number {
  if (format === 'xlsx') return defaultTtlMs;
  if (format === 'multi-csv' && tabCount >= 2) return defaultTtlMs;
  // Default operations workbook is known to have Sales Report + Finance Data.
  // Never long-cache a 1-tab CSV fallback for multi-sheet workbooks!
  if (sheetId === defaultSheetId || tabCount <= 1) {
    return 0;
  }
  return defaultTtlMs;
}
