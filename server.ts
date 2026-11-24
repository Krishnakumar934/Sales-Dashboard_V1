import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'path';
import zlib from 'node:zlib';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import { buildCompactSnapshotForAI } from './src/utils/forecasting.ts';
import { parseExcelWorkbook } from './src/utils/excelParser.ts';
import { encodeColumnarWorkbook } from './src/utils/columnarPacker.ts';
import {
  getSheetCacheTtlMs,
  normalizeParsedWorkbookDatasets,
  parseGoogleSheetsHtmlViewTabs,
} from './src/utils/sheetFallbackParser.ts';
import type { Dataset } from './src/types/data.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const portFlagIdx = process.argv.indexOf('--port');
const cliPort = portFlagIdx !== -1 ? Number(process.argv[portFlagIdx + 1]) : NaN;
const PORT = Number.isFinite(cliPort) && cliPort > 0 ? cliPort : Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === 'production';

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function createServer() {
  const app = express();
  const httpServer = http.createServer(app);
  app.use(express.json({ limit: '6mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  const DEFAULT_SHEET_ID = '1C4h8D0EtwYpWir5o128d_L1tMNMZeDuH';

  function extractServerSheetId(raw: string): string {
    const trimmed = (raw || '').trim();
    if (!trimmed) return DEFAULT_SHEET_ID;
    const pathMatch = trimmed.match(/\/(?:spreadsheets\/d|file\/d)\/([a-zA-Z0-9-_]+)/);
    if (pathMatch) return pathMatch[1];
    const queryMatch = trimmed.match(/[?&]id=([a-zA-Z0-9-_]{10,})/);
    if (queryMatch) return queryMatch[1];
    if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed;
    return DEFAULT_SHEET_ID;
  }

  function isBinarySpreadsheetBuffer(buf: Buffer): boolean {
    if (buf.length < 4) return false;
    // PK\x03\x04 (.xlsx ZIP) or D0 CF 11 E0 (.xls OLE2)
    const isZip = buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
    const isOle = buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0;
    return isZip || isOle;
  }

  function looksLikeHtmlPage(buf: Buffer, contentType: string): boolean {
    if (contentType.includes('text/html')) return true;
    const head = buf.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
    return head.startsWith('<!doctype html') || head.startsWith('<html');
  }

  async function tryDownloadCandidate(
    url: string,
    expectedFormat: 'xlsx' | 'csv',
    timeoutMs = 75000
  ): Promise<{ ok: true; buf: Buffer; format: 'xlsx' | 'csv' } | { ok: false; restricted: boolean }> {
    let currentUrl = url;
    const cookieJar = new Map<string, string>();

    const collectCookies = (headers: Headers) => {
      const getSetCookie = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
      const rawList = typeof getSetCookie === 'function' ? getSetCookie.call(headers) : [];
      if (rawList.length === 0) {
        const single = headers.get('set-cookie');
        if (single) rawList.push(single);
      }
      for (const raw of rawList) {
        const pair = raw.split(';', 1)[0]?.trim();
        const eqIdx = pair ? pair.indexOf('=') : -1;
        if (pair && eqIdx > 0) {
          cookieJar.set(pair.slice(0, eqIdx), pair.slice(eqIdx + 1));
        }
      }
    };

    const formatCookieHeader = () => {
      if (cookieJar.size === 0) return '';
      return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    };

    for (let hops = 0; hops < 6; hops++) {
      const reqHeaders: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      };
      const cookieHeader = formatCookieHeader();
      if (cookieHeader) {
        reqHeaders.Cookie = cookieHeader;
      }

      const upstream = await fetch(currentUrl, {
        redirect: 'manual',
        headers: reqHeaders,
        signal: AbortSignal.timeout(timeoutMs),
      });
      collectCookies(upstream.headers);

      if (upstream.status >= 300 && upstream.status < 400) {
        const loc = upstream.headers.get('location') || '';
        if (!loc || loc.includes('ServiceLogin') || loc.includes('accounts.google.com')) {
          return { ok: false, restricted: true };
        }
        currentUrl = new URL(loc, currentUrl).toString();
        continue;
      }

      if (!upstream.ok) {
        return { ok: false, restricted: upstream.status === 401 || upstream.status === 403 };
      }

      const contentType = (upstream.headers.get('content-type') || '').toLowerCase();
      const buf = Buffer.from(await upstream.arrayBuffer());

      // Check Drive virus-scan confirmation page for larger .xlsx files
      if (looksLikeHtmlPage(buf, contentType)) {
        const html = buf.toString('utf8');
        if (html.includes('ServiceLogin') || html.includes('accounts.google.com')) {
          return { ok: false, restricted: true };
        }
        const actionMatch = html.match(/<form[^>]+action="([^"]+)"/i);
        const hiddenInputs = [...html.matchAll(/<input[^>]+type="hidden"[^>]*>/gi)];
        if ((actionMatch || html.includes('confirm=')) && hops < 5) {
          const targetBase = actionMatch
            ? new URL(actionMatch[1].replace(/&amp;/g, '&'), currentUrl)
            : new URL('https://drive.usercontent.google.com/download');
          for (const inputMatch of hiddenInputs) {
            const tag = inputMatch[0];
            const n = tag.match(/name="([^"]+)"/i)?.[1];
            const v = tag.match(/value="([^"]*)"/i)?.[1] ?? '';
            if (n) targetBase.searchParams.set(n, v);
          }
          if (!targetBase.searchParams.has('confirm')) {
            const confirmMatch = html.match(/confirm=([0-9A-Za-z_-]+)/);
            if (confirmMatch) targetBase.searchParams.set('confirm', confirmMatch[1]);
          }
          if (!targetBase.searchParams.has('id')) {
            const idParam = currentUrl.match(/[?&]id=([^&]+)/)?.[1] || '';
            if (idParam) targetBase.searchParams.set('id', decodeURIComponent(idParam));
          }
          currentUrl = targetBase.toString();
          continue;
        }
        return { ok: false, restricted: false };
      }

      if (expectedFormat === 'xlsx') {
        if (isBinarySpreadsheetBuffer(buf)) {
          return { ok: true, buf, format: 'xlsx' };
        }
        if (contentType.includes('text/csv') || contentType.includes('text/plain')) {
          return { ok: true, buf, format: 'csv' };
        }
        return { ok: false, restricted: false };
      }

      if (buf.length > 0) {
        return { ok: true, buf, format: 'csv' };
      }
      return { ok: false, restricted: false };
    }
    return { ok: false, restricted: true };
  }

  const SHEET_CACHE_TTL_MS = 10 * 60 * 1000;
  interface CsvTabBuffer {
    name: string;
    gid: string;
    buf: Buffer;
  }
  interface CachedSheetBuffer {
    ok: true;
    buf: Buffer;
    format: 'xlsx' | 'csv' | 'multi-csv';
    csvTabs?: CsvTabBuffer[];
    sheetId: string;
    cachedAt: number;
    expiresAt: number;
    columnarJson?: string;
    columnarGzip?: Buffer;
    columnarPromise?: Promise<{ json: string; gzip: Buffer } | null>;
  }
  type SheetFetchResult = CachedSheetBuffer | { ok: false; restricted: boolean; sheetId: string };
  const sheetBufferCache = new Map<string, CachedSheetBuffer>();
  const inflightSheetFetches = new Map<string, Promise<SheetFetchResult>>();

  async function fetchMultiTabCsvFallback(sheetId: string): Promise<{
    tabs: CsvTabBuffer[];
    restricted: boolean;
  }> {
    let sawRestricted = false;
    let discoveredTabs: Array<{ name: string; gid: string }> = [];

    try {
      const htmlRes = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/htmlview`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(20000),
      });
      if (htmlRes.status === 401 || htmlRes.status === 403 || htmlRes.url.includes('ServiceLogin')) {
        sawRestricted = true;
      } else if (htmlRes.ok) {
        const html = await htmlRes.text();
        discoveredTabs = parseGoogleSheetsHtmlViewTabs(html);
      }
    } catch {
      // Ignore htmlview discovery error and fall back below
    }

    if (discoveredTabs.length > 0) {
      const fetchedTabs = await Promise.all(
        discoveredTabs.map(async (tab) => {
          const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${encodeURIComponent(tab.gid)}`;
          const res = await tryDownloadCandidate(url, 'csv', 60000).catch(() => ({
            ok: false as const,
            restricted: false,
          }));
          if (!res.ok) {
            if (res.restricted) sawRestricted = true;
            return null;
          }
          return { name: tab.name, gid: tab.gid, buf: res.buf };
        })
      );
      const valid = fetchedTabs.filter((t): t is CsvTabBuffer => Boolean(t));
      if (valid.length >= 2 || (valid.length === 1 && discoveredTabs.length === 1)) {
        return { tabs: valid, restricted: sawRestricted };
      }
    }

    // Explicit multi-tab safety net for the permanent default Sales Report + Finance Data workbook
    if (sheetId === DEFAULT_SHEET_ID) {
      const knownSheets = ['Sales Report', 'Finance Data'];
      const fetchedKnown = await Promise.all(
        knownSheets.map(async (sheetName, idx) => {
          const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
          const res = await tryDownloadCandidate(url, 'csv', 60000).catch(() => ({
            ok: false as const,
            restricted: false,
          }));
          if (!res.ok) {
            if (res.restricted) sawRestricted = true;
            return null;
          }
          return { name: sheetName, gid: String(idx), buf: res.buf };
        })
      );
      const validKnown = fetchedKnown.filter((t): t is CsvTabBuffer => Boolean(t));
      if (validKnown.length >= 2) {
        return { tabs: validKnown, restricted: sawRestricted };
      }
    }

    return { tabs: [], restricted: sawRestricted };
  }

  async function fetchSpreadsheetByLinkUncached(rawInput: string) {
    const trimmed = (rawInput || '').trim();

    // Support "Published to web" Google Sheet links (/d/e/2PACX-...)
    const pubMatch = trimmed.match(/docs\.google\.com\/spreadsheets\/d\/e\/([a-zA-Z0-9-_]+)/);
    if (pubMatch) {
      const pubId = pubMatch[1];
      const pubXlsx = await tryDownloadCandidate(
        `https://docs.google.com/spreadsheets/d/e/${pubId}/pub?output=xlsx`,
        'xlsx'
      );
      if (pubXlsx.ok) return { ...pubXlsx, sheetId: pubId };
      const pubCsv = await tryDownloadCandidate(
        `https://docs.google.com/spreadsheets/d/e/${pubId}/pub?output=csv`,
        'csv'
      );
      if (pubCsv.ok) return { ...pubCsv, sheetId: pubId };
    }

    const sheetId = extractServerSheetId(trimmed);
    const primaryCandidates: Array<{ url: string; format: 'xlsx' | 'csv' }> = [
      { url: `https://drive.usercontent.google.com/download?id=${sheetId}&export=download&confirm=t`, format: 'xlsx' },
      { url: `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`, format: 'xlsx' },
      { url: `https://drive.google.com/uc?export=download&confirm=t&id=${sheetId}`, format: 'xlsx' },
    ];

    let sawRestricted = false;
    try {
      // Race Drive file download vs Sheets export concurrently so whichever responds first wins
      const winner = await Promise.any(
        primaryCandidates.map(async (candidate) => {
          const result = await tryDownloadCandidate(candidate.url, candidate.format, 75000);
          if (result.ok) {
            return { ...result, sheetId };
          }
          if (result.restricted) sawRestricted = true;
          throw new Error('Candidate did not return spreadsheet binary');
        })
      );
      return winner;
    } catch {
      // Fall through to multi-tab GViz CSV export if XLSX download failed or timed out
    }

    const multiCsv = await fetchMultiTabCsvFallback(sheetId);
    if (multiCsv.tabs.length > 0) {
      return {
        ok: true as const,
        format: multiCsv.tabs.length > 1 ? ('multi-csv' as const) : ('csv' as const),
        buf: multiCsv.tabs[0].buf,
        csvTabs: multiCsv.tabs,
        sheetId,
      };
    }
    if (multiCsv.restricted) sawRestricted = true;

    try {
      const csvResult = await tryDownloadCandidate(
        `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv`,
        'csv',
        60000
      );
      if (csvResult.ok) {
        return { ...csvResult, sheetId };
      }
      if (csvResult.restricted) sawRestricted = true;
    } catch {
      // Ignore fallback error
    }

    return { ok: false as const, restricted: sawRestricted, sheetId };
  }

  async function fetchSpreadsheetByLink(rawInput: string, forceRefresh = false): Promise<SheetFetchResult> {
    const trimmed = (rawInput || '').trim() || DEFAULT_SHEET_ID;
    const cacheKey = extractServerSheetId(trimmed);

    if (!forceRefresh) {
      const cached = sheetBufferCache.get(cacheKey);
      if (cached && Date.now() < cached.expiresAt) {
        return cached;
      }
    }

    let inflight = !forceRefresh ? inflightSheetFetches.get(cacheKey) : undefined;
    if (!inflight) {
      const nextInflight: Promise<SheetFetchResult> = fetchSpreadsheetByLinkUncached(trimmed)
        .then((res): SheetFetchResult => {
          if (res.ok) {
            const tabCount =
              res.format === 'multi-csv'
                ? res.csvTabs?.length || 0
                : res.format === 'xlsx'
                ? 2
                : 1;
            const ttlMs = getSheetCacheTtlMs(
              res.format,
              tabCount,
              res.sheetId,
              DEFAULT_SHEET_ID,
              SHEET_CACHE_TTL_MS
            );
            const now = Date.now();
            const entry: CachedSheetBuffer = {
              ok: true,
              buf: res.buf,
              format: res.format,
              csvTabs: 'csvTabs' in res ? res.csvTabs : undefined,
              sheetId: res.sheetId,
              cachedAt: now,
              expiresAt: now + ttlMs,
            };
            if (ttlMs > 0) {
              sheetBufferCache.set(cacheKey, entry);
            } else {
              sheetBufferCache.delete(cacheKey);
            }
            return entry;
          }
          return res;
        })
        .finally(() => {
          inflightSheetFetches.delete(cacheKey);
        });
      inflight = nextInflight;
      inflightSheetFetches.set(cacheKey, nextInflight);
    }

    return inflight;
  }

  async function packColumnarInWorker(
    entry: CachedSheetBuffer
  ): Promise<{ json: string; gzip: Buffer }> {
    return new Promise((resolve, reject) => {
      const workerUrl = new URL('./src/workers/sheetPackerWorker.ts', import.meta.url);
      const transferList: ArrayBuffer[] = [];

      const copyUint8 = new Uint8Array(entry.buf.byteLength);
      copyUint8.set(entry.buf);
      transferList.push(copyUint8.buffer);

      const csvTabsPayload =
        entry.format === 'multi-csv' && entry.csvTabs && entry.csvTabs.length > 0
          ? entry.csvTabs.map((t) => {
              const tabCopy = new Uint8Array(t.buf.byteLength);
              tabCopy.set(t.buf);
              transferList.push(tabCopy.buffer);
              return { name: t.name, buf: tabCopy };
            })
          : undefined;

      const worker = new Worker(workerUrl, {
        workerData: {
          buf: copyUint8,
          format: entry.format,
          csvTabs: csvTabsPayload,
          sheetId: entry.sheetId,
          defaultSheetId: DEFAULT_SHEET_ID,
        },
        transferList,
      });

      let settled = false;
      worker.once('message', (msg: any) => {
        if (settled) return;
        settled = true;
        if (msg?.ok && typeof msg.json === 'string' && msg.gzip) {
          resolve({
            json: msg.json,
            gzip: Buffer.isBuffer(msg.gzip) ? msg.gzip : Buffer.from(msg.gzip),
          });
        } else {
          reject(new Error(msg?.error || 'Sheet packer worker failed'));
        }
      });

      worker.once('error', (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      });

      worker.once('exit', (code) => {
        if (!settled && code !== 0) {
          settled = true;
          reject(new Error(`Sheet packer worker exited with code ${code}`));
        }
      });
    });
  }

  async function packColumnarDirect(entry: CachedSheetBuffer): Promise<{ json: string; gzip: Buffer }> {
    const displayName =
      entry.sheetId === DEFAULT_SHEET_ID
        ? 'Main Operations Sheet'
        : `Google Sheet (${entry.sheetId.slice(0, 8)})`;

    let normalizedDatasets: Dataset[];

    if (entry.format === 'multi-csv' && entry.csvTabs && entry.csvTabs.length > 0) {
      const allNames = entry.csvTabs.map((t) => t.name);
      const parsedAll: Dataset[] = [];
      for (const tab of entry.csvTabs) {
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
        entry.sheetId,
        DEFAULT_SHEET_ID,
        'csv'
      );
    } else {
      const ab = entry.buf.buffer.slice(
        entry.buf.byteOffset,
        entry.buf.byteOffset + entry.buf.byteLength
      ) as ArrayBuffer;
      const ext = entry.format === 'csv' ? 'csv' : 'xlsx';
      const parsedSheets = await parseExcelWorkbook(ab, `${displayName}.${ext}`);
      normalizedDatasets = normalizeParsedWorkbookDatasets(
        parsedSheets,
        entry.sheetId,
        DEFAULT_SHEET_ID,
        ext
      );
    }

    const payload = encodeColumnarWorkbook(normalizedDatasets, entry.sheetId);
    const json = JSON.stringify(payload);
    const gzip = zlib.gzipSync(json, { level: 6 });
    return { json, gzip };
  }

  async function ensureColumnarPayload(entry: CachedSheetBuffer): Promise<{ json: string; gzip: Buffer } | null> {
    if (entry.columnarJson && entry.columnarGzip) {
      return { json: entry.columnarJson, gzip: entry.columnarGzip };
    }
    if (entry.columnarPromise) {
      return entry.columnarPromise;
    }

    entry.columnarPromise = (async () => {
      try {
        let packed: { json: string; gzip: Buffer };
        try {
          packed = await packColumnarInWorker(entry);
        } catch (workerErr) {
          console.warn('[Worker Fallback Warning]:', workerErr);
          packed = await packColumnarDirect(entry);
        }
        entry.columnarJson = packed.json;
        entry.columnarGzip = packed.gzip;
        return packed;
      } catch (err) {
        console.warn('[Columnar Pack Warning]:', err);
        return null;
      } finally {
        entry.columnarPromise = undefined;
      }
    })();

    return entry.columnarPromise;
  }

  function sendColumnarOrBinary(
    req: express.Request,
    res: express.Response,
    result: CachedSheetBuffer,
    preferColumnar: boolean,
    prepacked?: { json: string; gzip: Buffer } | null
  ) {
    res.setHeader('X-Sheet-Id', result.sheetId);
    res.setHeader('X-Sheet-Format', result.format);

    if (preferColumnar && prepacked) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('X-Sheet-Encoding', 'columnar-v1');
      const acceptEncoding = String(req.headers['accept-encoding'] || '').toLowerCase();
      if (acceptEncoding.includes('gzip')) {
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Vary', 'Accept-Encoding');
        res.send(prepacked.gzip);
      } else {
        res.send(prepacked.json);
      }
      return;
    }

    res.setHeader(
      'Content-Type',
      result.format === 'csv' || result.format === 'multi-csv'
        ? 'text/csv; charset=utf-8'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.send(result.buf);
  }

  app.get('/api/sheets/public-default', async (req, res) => {
    const force = req.query?.force === '1' || req.query?.force === 'true';
    const preferColumnar = req.query?.format === 'columnar';
    const result = await fetchSpreadsheetByLink(DEFAULT_SHEET_ID, force);
    if (result.ok) {
      const entry = result as CachedSheetBuffer;
      const packed = preferColumnar ? await ensureColumnarPayload(entry) : null;
      sendColumnarOrBinary(req, res, entry, preferColumnar, packed);
      return;
    }

    res.json({
      accessible: false,
      reason: 'LINK_RESTRICTED',
      sheetId: result.sheetId,
      message:
        'This Google Sheet link is currently set to Restricted. In Google Drive/Sheets, open Share → General access → change to "Anyone with the link" (Viewer), then click Sync Sheet.',
    });
  });

  app.post('/api/sheets/fetch', async (req, res) => {
    const sheetUrl = typeof req.body?.sheetUrl === 'string' ? req.body.sheetUrl : DEFAULT_SHEET_ID;
    const forceRefresh = Boolean(req.body?.forceRefresh);
    const preferColumnar = req.body?.format === 'columnar';
    const result = await fetchSpreadsheetByLink(sheetUrl, forceRefresh);
    if (result.ok) {
      const entry = result as CachedSheetBuffer;
      const packed = preferColumnar ? await ensureColumnarPayload(entry) : null;
      sendColumnarOrBinary(req, res, entry, preferColumnar, packed);
      return;
    }

    res.json({
      accessible: false,
      reason: 'LINK_RESTRICTED',
      sheetId: result.sheetId,
      message:
        'This Google Sheet link is currently set to Restricted. In Google Drive/Sheets, open Share → General access → change to "Anyone with the link" (Viewer), then click Sync Sheet.',
    });
  });

  app.post('/api/ai/analyze', async (req, res) => {
    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error:
          'Gemini API key is not configured. Please add your GEMINI_API_KEY in the Settings > Secrets panel to enable AI analysis and predictions.',
        code: 'MISSING_API_KEY',
      });
      return;
    }

    const { snapshot, question } = req.body || {};
    if (!snapshot || typeof snapshot !== 'object') {
      res.status(400).json({ error: 'Missing analytics snapshot payload.' });
      return;
    }

    const userQuestion =
      typeof question === 'string' && question.trim().length > 0
        ? question.trim()
        : 'Analyze current sales performance, identify the highest-leverage conversion opportunities, and predict the next 3 months with a step-by-step execution plan.';

    const compactSnapshot = buildCompactSnapshotForAI(snapshot, userQuestion);

    const systemInstruction = [
      'You are a Principal Retail Revenue & Sales Conversion Strategist for Indian enterprise operations (using ₹ Crores "Cr", Lakhs "L", Thousands "K").',
      'Cite ONLY real entity names, manager names (GM/ASM), categories, brands, financiers, and exact numbers from the supplied JSON snapshot.',
      'CRITICAL ENTITY MATCHING RULE: Store/branch names often use short branch codes with hyphens and locations (for example, "VPM" refers to "Vpm-01 (Nehruji Road, Vilupuram)"). ALWAYS inspect `promptMatchedEntities` first, and search `allBranchesDirectory`, `topEntities`, `laggingEntities`, `gmShares`, `asmShares`, `categoryShares`, `brandShares`, and `financierShares` using case-insensitive abbreviation/code/substring matching before ever stating an entity is missing.',
      'If `promptMatchedEntities` is non-empty, make those exact matched stores/entities the centerpiece of your `executiveAnswer`, diagnostics, and recommendations with their exact numbers, rank, GM/ASM hierarchy, ticket size, and discount rate.',
      'Focus relentlessly on FUTURE SALES CONVERSION: how to lift average ticket size, convert underperforming branch/category volume, stop discount margin leakage, and hit or beat the 3-month statistical trajectory.',
      'Keep executive text sharp, specific, and scannable. Every recommendation MUST include a concrete conversion strategy, 3-5 step-by-step execution steps, owner role, timeframe, KPI target, and risk mitigation.',
    ].join(' ');

    const promptPayload = `QUESTION:${userQuestion}\nSNAPSHOT:${JSON.stringify(compactSnapshot)}`;

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        executiveAnswer: {
          type: Type.STRING,
          description:
            'Direct 2-4 sentence executive answer to the question citing exact ₹ figures, growth %, discount rate, matched entities from promptMatchedEntities/allBranchesDirectory, and next-quarter outlook.',
        },
        currentSalesInsights: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              detail: { type: Type.STRING },
              sentiment: {
                type: Type.STRING,
                description: 'Must be one of: positive, warning, neutral',
              },
              metricValue: { type: Type.STRING },
            },
            required: ['title', 'detail', 'sentiment', 'metricValue'],
          },
        },
        futurePredictions: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            trendDirection: {
              type: Type.STRING,
              description: 'Must be one of: up, down, stable',
            },
            confidenceLevel: {
              type: Type.STRING,
              description: 'Must be one of: High, Medium, Low',
            },
            growthDrivers: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            riskFactors: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            monthlyOutlook: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  monthLabel: { type: Type.STRING },
                  predictedFormatted: { type: Type.STRING },
                  rationale: { type: Type.STRING },
                },
                required: ['monthLabel', 'predictedFormatted', 'rationale'],
              },
            },
          },
          required: [
            'summary',
            'trendDirection',
            'confidenceLevel',
            'growthDrivers',
            'riskFactors',
            'monthlyOutlook',
          ],
        },
        actionableRecommendations: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              priority: {
                type: Type.STRING,
                description: 'Must be High or Medium',
              },
              targetEntity: { type: Type.STRING },
              headline: { type: Type.STRING },
              action: { type: Type.STRING },
              expectedImpact: { type: Type.STRING },
              conversionStrategy: { type: Type.STRING },
              executionSteps: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              kpiTarget: { type: Type.STRING },
              ownerRole: { type: Type.STRING },
              timeframe: { type: Type.STRING },
              riskMitigation: { type: Type.STRING },
            },
            required: [
              'priority',
              'targetEntity',
              'headline',
              'action',
              'expectedImpact',
              'conversionStrategy',
              'executionSteps',
              'kpiTarget',
              'ownerRole',
              'timeframe',
              'riskMitigation',
            ],
          },
        },
      },
      required: [
        'executiveAnswer',
        'currentSalesInsights',
        'futurePredictions',
        'actionableRecommendations',
      ],
    };

    const parseJsonSafe = (raw: string) => {
      let cleaned = (raw || '').trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      }
      try {
        return JSON.parse(cleaned);
      } catch {
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
        }
        throw new Error('Malformed JSON returned by AI model');
      }
    };

    const callModel = async (model: string, thinkingLevel: ThinkingLevel) => {
      return ai.models.generateContent({
        model,
        contents: promptPayload,
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel },
          responseMimeType: 'application/json',
          responseSchema,
        },
      });
    };

    try {
      let usedModel = 'gemini-4-hydrogen';
      let parsed: any = null;
      const attempts: Array<{ model: string; level: ThinkingLevel }> = [
        { model: 'gemini-4-hydrogen', level: ThinkingLevel.LOW },
        { model: 'gemini-3.1-flash-lite', level: ThinkingLevel.MINIMAL },
      ];

      let lastErr: any = null;
      for (let idx = 0; idx < attempts.length; idx++) {
        const attempt = attempts[idx];
        try {
          usedModel = attempt.model;
          const response = await callModel(attempt.model, attempt.level);
          const rawText = (response.text ?? '').trim();
          if (!rawText) {
            throw new Error('Empty response text from Gemini');
          }
          parsed = parseJsonSafe(rawText);
          break;
        } catch (attemptErr: any) {
          lastErr = attemptErr;
          const aStatus = attemptErr?.status || attemptErr?.code;
          const aMsg = String(attemptErr?.message || '');
          // Never fall back to another model if API key itself is invalid/forbidden
          if (
            aStatus === 403 ||
            aMsg.includes('API_KEY_INVALID') ||
            aMsg.includes('PERMISSION_DENIED')
          ) {
            throw attemptErr;
          }
          if (idx === attempts.length - 1) {
            throw attemptErr;
          }
        }
      }

      if (!parsed) {
        throw lastErr || new Error('Gemini returned an empty response. Please try again.');
      }

      res.json({
        analysis: parsed,
        generatedAt: new Date().toISOString(),
        model: usedModel,
      });
    } catch (err: any) {
      const status = err?.status || err?.code || 500;
      let msg = String(err?.message || 'Failed to analyze data with Gemini AI.');
      if (msg.trim().startsWith('{')) {
        try {
          const parsedErr = JSON.parse(msg);
          if (parsedErr?.error?.message) {
            msg = String(parsedErr.error.message);
          }
        } catch {
          // Keep original message if not valid JSON
        }
      }

      console.error('[AI Analyze Error]:', status, msg);

      if (
        status === 400 ||
        status === 403 ||
        msg.includes('API_KEY_INVALID') ||
        msg.includes('PERMISSION_DENIED')
      ) {
        res.status(403).json({
          error:
            'Your Gemini API key appears invalid or lacks permission. Please verify GEMINI_API_KEY in the Settings > Secrets panel.',
          code: 'INVALID_API_KEY',
        });
        return;
      }

      if (status === 429 || msg.includes('RESOURCE_EXHAUSTED')) {
        res.status(429).json({
          error:
            'Gemini API rate limit or quota exceeded. Please wait a moment and try again, or check your billing quota in Settings > Secrets.',
          code: 'QUOTA_EXCEEDED',
        });
        return;
      }

      if (status === 503 || msg.includes('UNAVAILABLE') || msg.toLowerCase().includes('high demand')) {
        res.status(503).json({
          error:
            'The AI service is temporarily experiencing high demand. Please click Retry in a few seconds.',
          code: 'SERVICE_UNAVAILABLE',
        });
        return;
      }

      res.status(typeof status === 'number' && status >= 400 && status < 600 ? status : 500).json({
        error: msg,
        code: 'AI_ANALYSIS_FAILED',
      });
    }
  });

  app.post('/api/ai/compare', async (req, res) => {
    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error:
          'GEMINI_API_KEY is not configured or still set to a placeholder. Add a valid key in Settings > Secrets to enable AI comparison coaching.',
        code: 'MISSING_API_KEY',
      });
      return;
    }

    const { dimension, dimLabel, entityA, entityB, diagnosis, dateRangeLabel, activeReportTab } =
      req.body || {};

    if (!entityA?.name || !entityB?.name) {
      res.status(400).json({ error: 'Two distinct entities (entityA and entityB) are required for comparison.' });
      return;
    }

    const isFinanceMode =
      entityA?.mode === 'finance' ||
      diagnosis?.mode === 'finance' ||
      String(activeReportTab || '').toLowerCase().includes('finance');

    const mapEntitySummary = (ent: any) => ({
      name: ent.name,
      mode: isFinanceMode ? 'finance' : 'sales',
      rankByActiveMetric: `${ent.rankByPrimary ?? ent.rankBySales ?? '?'} of ${ent.totalEntities ?? '?'}`,
      // Primary Finance Data metrics
      financeLoanAmount: ent.financeLoanAmount,
      financeLoginCount: ent.financeLoginCount,
      avgLoanSize: ent.avgLoanSize,
      topFinanciers: (ent.topFinanciers || []).slice(0, 5),
      // Sales Report metrics (reference on Finance tab, primary on Sales tab)
      salesAmount: ent.salesAmount,
      salesQty: ent.salesQty,
      avgTicket: ent.avgTicket,
      discountRatePct: ent.discountRatePct,
      financePenetrationPct: ent.financePenetrationPct,
      branchCount: ent.branchCount,
      topCategories: (ent.topCategories || []).slice(0, 5),
      topBrands: (ent.topBrands || []).slice(0, 5),
      topBranches: (ent.topBranches || []).slice(0, 4),
      bestMonth: ent.bestMonth,
      weakestMonth: ent.weakestMonth,
    });

    const compactComparePayload = {
      comparisonParameter: dimLabel || dimension || 'GM',
      comparisonMode: isFinanceMode ? 'FINANCE_DATA' : 'SALES_REPORT',
      activeTab: activeReportTab || (isFinanceMode ? 'Finance Report' : 'Sales Report'),
      period: dateRangeLabel || 'All Time',
      entityA: mapEntitySummary(entityA),
      entityB: mapEntitySummary(entityB),
      computedGap: diagnosis || null,
    };

    const systemInstruction = isFinanceMode
      ? `You are a Principal Consumer Finance & Retail Lending Strategist analyzing a 1-vs-1 head-to-head comparison STRICTLY based on Finance Data (Loan Amount & SUM(Count)) for a consumer electronics & mobile retail chain in India (currency in ₹ using Indian Crores/Lakhs/Thousands).
CRITICAL RULE: The user is on the FINANCE REPORT tab. Evaluate leadership and performance STRICTLY by Finance Data (financeLoanAmount = SUM(Loan Amount), financeLoginCount = SUM(Count), avgLoanSize, topFinanciers, and financed categories/brands/months). Do NOT confuse Sales Report gross revenue as the primary comparison winner; mention Sales Report only as optional financed-share context if relevant.
Analyze the exact JSON metrics for Entity A vs Entity B strictly without inventing any numbers.
Your job is to explain:
1. Who has higher Finance Loan Amount & Login Counts and who has less (with exact ₹ loan gap, % difference, and Count difference).
2. Why the finance difference exists (financier mix like Bajaj/IDFC/HDB, loan approval counts, average loan size, financed category/brand mix, branch coverage, or monthly consistency).
3. Concrete, actionable Finance growth steps for BOTH sides:
   - Specific lending & ticket-expansion plays for the Leading side (${diagnosis?.leaderName || entityA.name}) to compound loan volume.
   - Specific turnaround & approval-velocity plays for the Trailing side (${diagnosis?.trailingName || entityB.name}) to close the loan amount and count gap.`
      : `You are a Principal Retail Sales & Consumer Finance Strategist analyzing a 1-vs-1 head-to-head comparison for a consumer electronics & mobile retail chain in India (currency in ₹ using Indian Crores/Lakhs/Thousands).
Analyze the exact JSON metrics for Entity A vs Entity B strictly without inventing any numbers.
Your job is to explain:
1. Who has more sales and who has less (with exact ₹ gap and % difference).
2. Why the difference exists (category mix, brand mix, average ticket size, branch count, discount efficiency, monthly consistency, or EMI finance penetration).
3. Concrete, actionable growth steps for BOTH sides:
   - Specific growth plays for the Leading side (${diagnosis?.leaderName || entityA.name}) to defend and compound its lead.
   - Specific turnaround & growth plays for the Trailing side (${diagnosis?.trailingName || entityB.name}) to close the gap.`;

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        whoLeadsHeadline: {
          type: Type.STRING,
          description: isFinanceMode
            ? 'One crisp executive sentence stating who leads and trails in Finance Loan Amount & Counts, with exact ₹ loan gap and % difference.'
            : 'One crisp executive sentence stating who has more sales, who has less, and the exact ₹ and % gap.',
        },
        whyDifference: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              factor: { type: Type.STRING },
              detail: { type: Type.STRING },
              evidence: { type: Type.STRING },
            },
            required: ['factor', 'detail', 'evidence'],
          },
        },
        leaderGrowthActions: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              action: { type: Type.STRING },
              targetMetric: { type: Type.STRING },
            },
            required: ['title', 'action', 'targetMetric'],
          },
        },
        trailingGrowthActions: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              action: { type: Type.STRING },
              targetMetric: { type: Type.STRING },
            },
            required: ['title', 'action', 'targetMetric'],
          },
        },
        combinedOutlook: {
          type: Type.STRING,
          description: 'Short takeaway on projected upside when both entities execute these steps.',
        },
      },
      required: [
        'whoLeadsHeadline',
        'whyDifference',
        'leaderGrowthActions',
        'trailingGrowthActions',
        'combinedOutlook',
      ],
    };

    const parseJsonSafe = (raw: string) => {
      let cleaned = (raw || '').trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      }
      try {
        return JSON.parse(cleaned);
      } catch {
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
        }
        throw new Error('Malformed JSON returned by AI model');
      }
    };

    try {
      const promptPayload = `HEAD-TO-HEAD COMPARISON DATA:\n${JSON.stringify(compactComparePayload, null, 2)}`;
      const attempts: Array<{ model: string; level: ThinkingLevel }> = [
        { model: 'gemini-4-hydrogen', level: ThinkingLevel.LOW },
        { model: 'gemini-3.1-flash-lite', level: ThinkingLevel.MINIMAL },
      ];

      let parsed: any = null;
      let usedModel = 'gemini-4-hydrogen';
      let lastErr: any = null;

      for (let i = 0; i < attempts.length; i++) {
        const attempt = attempts[i];
        try {
          usedModel = attempt.model;
          const response = await ai.models.generateContent({
            model: attempt.model,
            contents: promptPayload,
            config: {
              systemInstruction,
              thinkingConfig: { thinkingLevel: attempt.level },
              responseMimeType: 'application/json',
              responseSchema,
            },
          });
          const rawText = (response.text ?? '').trim();
          if (!rawText) throw new Error('Empty AI comparison response');
          parsed = parseJsonSafe(rawText);
          break;
        } catch (attemptErr: any) {
          lastErr = attemptErr;
          const aStatus = attemptErr?.status || attemptErr?.code;
          const aMsg = String(attemptErr?.message || '');
          if (aStatus === 403 || aMsg.includes('API_KEY_INVALID') || aMsg.includes('PERMISSION_DENIED')) {
            throw attemptErr;
          }
          if (i === attempts.length - 1) throw attemptErr;
        }
      }

      if (!parsed) throw lastErr || new Error('Empty comparison response from Gemini');

      res.json({
        comparisonAI: parsed,
        model: usedModel,
        generatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      const status = err?.status || err?.code || 500;
      const msg = String(err?.message || 'Failed to generate comparison insights.');
      console.error('[AI Compare Error]:', status, msg);
      res.status(typeof status === 'number' && status >= 400 && status < 600 ? status : 500).json({
        error: msg,
        code: 'AI_COMPARE_FAILED',
      });
    }
  });

  if (!isProd) {
    // Cleanly self-unregister any previously installed dev service worker so ais-dev never serves stale cached modules
    app.get(['/dev-sw.js', '/sw.js'], (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.type('application/javascript').send(`
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
    } catch {}
  })());
});
`);
    });

    const disableHmr = process.env.DISABLE_HMR === 'true';
    if (disableHmr) {
      app.get('/@vite/client', (_req, res) => {
        res.type('application/javascript').send(`
const sheetsMap = new Map();
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    document.head.appendChild(style);
    sheetsMap.set(id, style);
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    style.remove();
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  const noop = () => {};
  return {
    accept: noop,
    acceptExports: noop,
    dispose: noop,
    prune: noop,
    invalidate: noop,
    on: noop,
    off: noop,
    send: noop,
    data: {},
  };
}
export function injectQuery(url) { return url; }
export class ErrorOverlay {}
`);
      });
    }
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: disableHmr
        ? { middlewareMode: true, hmr: false, ws: false }
        : {
            middlewareMode: true,
            hmr: { server: httpServer },
            ws: { server: httpServer },
          },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(
      express.static(distPath, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html') || filePath.endsWith('sw.js')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`PulseGrid Server running on http://0.0.0.0:${PORT}`);
    // Pre-warm live default Google Drive workbook + columnar gzip cache right after boot
    setTimeout(() => {
      void fetchSpreadsheetByLink(DEFAULT_SHEET_ID, false)
        .then((res) => (res.ok ? ensureColumnarPayload(res as CachedSheetBuffer) : null))
        .catch(() => null);
    }, 100);
  });
}

createServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
