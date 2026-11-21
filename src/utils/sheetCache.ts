import type { Dataset, DataRow } from '../types/data.ts';

const IDB_NAME = 'pulsegrid_workbook_cache_v1';
const IDB_STORE = 'workbooks';
const IDB_VERSION = 2;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes fresh window before background refresh
const PACK_CHUNK_SIZE = 25000;

interface PackedDatasetPayload {
  meta: Omit<Dataset, 'rows'>;
  headers: string[];
  /** Chunked JSON strings so packing/parsing never blocks main thread or clones 300k JS objects */
  packedChunks?: string[];
  /** Legacy single-string format backward compat */
  packedRowsJson?: string;
}

export interface CachedWorkbookEntry {
  cacheKey: string;
  sheetUrl: string;
  datasets?: Dataset[];
  packedDatasets?: PackedDatasetPayload[];
  syncedAt: string;
  savedAtMs: number;
}

function hasIndexedDB(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

function openCacheDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = window.indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'cacheKey' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB cache'));
  });
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

export function normalizeSheetCacheKey(sheetUrl: string): string {
  return (sheetUrl || '').trim().toLowerCase() || 'default';
}

async function packDatasetAsync(dataset: Dataset): Promise<PackedDatasetPayload> {
  const { rows, ...meta } = dataset;
  const headers =
    dataset.columns.length > 0
      ? dataset.columns.map((c) => c.name)
      : rows.length > 0
      ? Object.keys(rows[0])
      : [];
  const colCount = headers.length;
  const rowCount = rows.length;
  const packedChunks: string[] = [];

  for (let start = 0; start < rowCount; start += PACK_CHUNK_SIZE) {
    const end = Math.min(rowCount, start + PACK_CHUNK_SIZE);
    const chunkTuples = new Array<any[]>(end - start);
    for (let i = start; i < end; i++) {
      const r = rows[i];
      const tuple = new Array(colCount);
      for (let c = 0; c < colCount; c++) {
        const val = r[headers[c]];
        tuple[c] = val === undefined ? '' : val;
      }
      chunkTuples[i - start] = tuple;
    }
    packedChunks.push(JSON.stringify(chunkTuples));
    if (end < rowCount) {
      await yieldToMain();
    }
  }

  return {
    meta,
    headers,
    packedChunks,
  };
}

function unpackDataset(packed: PackedDatasetPayload): Dataset {
  const { meta, headers, packedChunks, packedRowsJson } = packed;
  const colCount = headers.length;
  const rows: DataRow[] = [];

  const appendTuples = (tuples: any[][]) => {
    for (let i = 0; i < tuples.length; i++) {
      const tuple = tuples[i];
      const rowObj: DataRow = {};
      for (let c = 0; c < colCount; c++) {
        rowObj[headers[c]] = tuple[c];
      }
      rows.push(rowObj);
    }
  };

  if (Array.isArray(packedChunks) && packedChunks.length > 0) {
    for (const chunkJson of packedChunks) {
      appendTuples(JSON.parse(chunkJson));
    }
  } else if (packedRowsJson) {
    appendTuples(JSON.parse(packedRowsJson));
  }

  return {
    ...meta,
    rows,
  };
}

export async function loadWorkbookFromIDB(
  sheetUrl: string
): Promise<{ datasets: Dataset[]; syncedAt: string; isStale: boolean } | null> {
  if (!hasIndexedDB()) return null;
  const cacheKey = normalizeSheetCacheKey(sheetUrl);
  let db: IDBDatabase | null = null;
  try {
    db = await openCacheDb();
    const entry = await new Promise<CachedWorkbookEntry | undefined>((resolve, reject) => {
      const tx = db!.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const getReq = store.get(cacheKey);
      getReq.onsuccess = () => resolve(getReq.result as CachedWorkbookEntry | undefined);
      getReq.onerror = () => reject(getReq.error);
    });

    if (!entry) return null;

    let datasets: Dataset[] = [];
    if (Array.isArray(entry.packedDatasets) && entry.packedDatasets.length > 0) {
      datasets = entry.packedDatasets.map(unpackDataset);
    } else if (Array.isArray(entry.datasets) && entry.datasets.length > 0) {
      datasets = entry.datasets;
    }

    if (datasets.length === 0) return null;

    const isStale = Date.now() - (entry.savedAtMs || 0) > CACHE_TTL_MS;
    return {
      datasets,
      syncedAt: entry.syncedAt || '',
      isStale,
    };
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

export async function saveWorkbookToIDB(
  sheetUrl: string,
  datasets: Dataset[],
  syncedAt: string
): Promise<void> {
  if (!hasIndexedDB() || !datasets || datasets.length === 0) return;
  const cacheKey = normalizeSheetCacheKey(sheetUrl);
  let db: IDBDatabase | null = null;
  try {
    const packedDatasets: PackedDatasetPayload[] = [];
    for (const ds of datasets) {
      packedDatasets.push(await packDatasetAsync(ds));
      await yieldToMain();
    }
    db = await openCacheDb();
    const payload: CachedWorkbookEntry = {
      cacheKey,
      sheetUrl,
      packedDatasets,
      syncedAt,
      savedAtMs: Date.now(),
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.put(payload);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    // Ignore storage quota or private-browsing IndexedDB restrictions
  } finally {
    db?.close();
  }
}
