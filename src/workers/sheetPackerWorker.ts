import { parentPort, workerData } from 'node:worker_threads';
import zlib from 'node:zlib';
import { parseExcelWorkbook } from '../utils/excelParser.ts';
import { encodeColumnarWorkbook } from '../utils/columnarPacker.ts';
import { normalizeParsedWorkbookDatasets } from '../utils/sheetFallbackParser.ts';
import type { Dataset } from '../types/data.ts';

interface CsvTabPayload {
  name: string;
  buf: Uint8Array;
}

interface WorkerPayload {
  buf: Uint8Array;
  format: 'xlsx' | 'csv' | 'multi-csv';
  csvTabs?: CsvTabPayload[];
  sheetId: string;
  defaultSheetId: string;
}

async function run() {
  const { buf, format, csvTabs, sheetId, defaultSheetId } = workerData as WorkerPayload;
  const displayName =
    sheetId === defaultSheetId
      ? 'Main Operations Sheet'
      : `Google Sheet (${sheetId.slice(0, 8)})`;

  let normalizedDatasets: Dataset[];

  if (format === 'multi-csv' && Array.isArray(csvTabs) && csvTabs.length > 0) {
    const allNames = csvTabs.map((t) => t.name);
    const parsedAll: Dataset[] = [];
    for (const tab of csvTabs) {
      const tabAb = tab.buf.buffer.slice(
        tab.buf.byteOffset,
        tab.buf.byteOffset + tab.buf.byteLength
      ) as ArrayBuffer;
      const parsedTab = await parseExcelWorkbook(tabAb, `${tab.name}.csv`);
      for (const ds of parsedTab) {
        parsedAll.push({
          ...ds,
          activeSheet: tab.name,
          sheetNames: allNames,
        });
      }
    }
    normalizedDatasets = normalizeParsedWorkbookDatasets(
      parsedAll,
      sheetId,
      defaultSheetId,
      'csv'
    );
  } else {
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const ext = format === 'csv' ? 'csv' : 'xlsx';
    const parsedSheets = await parseExcelWorkbook(ab, `${displayName}.${ext}`);
    normalizedDatasets = normalizeParsedWorkbookDatasets(
      parsedSheets,
      sheetId,
      defaultSheetId,
      ext
    );
  }

  const payload = encodeColumnarWorkbook(normalizedDatasets, sheetId);
  const json = JSON.stringify(payload);
  const gzip = zlib.gzipSync(json, { level: 6 });

  parentPort?.postMessage({ ok: true, json, gzip });
}

run().catch((err) => {
  parentPort?.postMessage({
    ok: false,
    error: err instanceof Error ? err.message : String(err),
  });
});
