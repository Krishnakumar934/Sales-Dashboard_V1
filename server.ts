import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import { buildCompactSnapshotForAI } from './src/utils/forecasting.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
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
  app.use(express.json({ limit: '2mb' }));

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
    expectedFormat: 'xlsx' | 'csv'
  ): Promise<{ ok: true; buf: Buffer; format: 'xlsx' | 'csv' } | { ok: false; restricted: boolean }> {
    let currentUrl = url;
    for (let hops = 0; hops < 5; hops++) {
      const upstream = await fetch(currentUrl, { redirect: 'manual' });
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
        const confirmMatch = html.match(/confirm=([0-9A-Za-z_-]+)/);
        const uuidMatch = html.match(/name="uuid"\s+value="([^"]+)"/);
        if (confirmMatch && hops < 4) {
          const idParam = currentUrl.match(/[?&]id=([^&]+)/)?.[1] || '';
          currentUrl = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(
            idParam
          )}&export=download&confirm=${encodeURIComponent(confirmMatch[1])}${
            uuidMatch ? `&uuid=${encodeURIComponent(uuidMatch[1])}` : ''
          }`;
          continue;
        }
        return { ok: false, restricted: false };
      }

      if (expectedFormat === 'xlsx') {
        if (isBinarySpreadsheetBuffer(buf)) {
          return { ok: true, buf, format: 'xlsx' };
        }
        // Sometimes Drive serves CSV cleanly via export=download
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

  const SHEET_CACHE_TTL_MS = 5 * 60 * 1000;
  interface CachedSheetBuffer {
    ok: true;
    buf: Buffer;
    format: 'xlsx' | 'csv';
    sheetId: string;
    cachedAt: number;
  }
  const sheetBufferCache = new Map<string, CachedSheetBuffer>();
  const inflightSheetFetches = new Map<string, Promise<Awaited<ReturnType<typeof fetchSpreadsheetByLinkUncached>>>>();

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
    const candidates: Array<{ url: string; format: 'xlsx' | 'csv' }> = [
      { url: `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`, format: 'xlsx' },
      { url: `https://drive.google.com/uc?export=download&id=${sheetId}`, format: 'xlsx' },
      { url: `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv`, format: 'csv' },
    ];

    let sawRestricted = false;
    for (const candidate of candidates) {
      try {
        const result = await tryDownloadCandidate(candidate.url, candidate.format);
        if (result.ok) {
          return { ...result, sheetId };
        }
        if (result.restricted) sawRestricted = true;
      } catch {
        // Try next public download endpoint
      }
    }

    return { ok: false as const, restricted: sawRestricted, sheetId };
  }

  async function fetchSpreadsheetByLink(rawInput: string, forceRefresh = false) {
    const trimmed = (rawInput || '').trim() || DEFAULT_SHEET_ID;
    const cacheKey = extractServerSheetId(trimmed);

    if (!forceRefresh) {
      const cached = sheetBufferCache.get(cacheKey);
      if (cached && Date.now() - cached.cachedAt < SHEET_CACHE_TTL_MS) {
        return cached;
      }
    }

    let inflight = !forceRefresh ? inflightSheetFetches.get(cacheKey) : undefined;
    if (!inflight) {
      inflight = fetchSpreadsheetByLinkUncached(trimmed).then((res) => {
        if (res.ok) {
          sheetBufferCache.set(cacheKey, {
            ok: true,
            buf: res.buf,
            format: res.format,
            sheetId: res.sheetId,
            cachedAt: Date.now(),
          });
        }
        return res;
      }).finally(() => {
        inflightSheetFetches.delete(cacheKey);
      });
      inflightSheetFetches.set(cacheKey, inflight);
    }

    return inflight;
  }

  app.get('/api/sheets/public-default', async (req, res) => {
    const force = req.query?.force === '1' || req.query?.force === 'true';
    const result = await fetchSpreadsheetByLink(DEFAULT_SHEET_ID, force);
    if (result.ok) {
      res.setHeader(
        'Content-Type',
        result.format === 'csv'
          ? 'text/csv; charset=utf-8'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('X-Sheet-Id', result.sheetId);
      res.setHeader('X-Sheet-Format', result.format);
      res.send(result.buf);
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
    const result = await fetchSpreadsheetByLink(sheetUrl, forceRefresh);
    if (result.ok) {
      res.setHeader(
        'Content-Type',
        result.format === 'csv'
          ? 'text/csv; charset=utf-8'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('X-Sheet-Id', result.sheetId);
      res.setHeader('X-Sheet-Format', result.format);
      res.send(result.buf);
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

    const compactSnapshot = buildCompactSnapshotForAI(snapshot);

    const systemInstruction = [
      'You are a Principal Retail Revenue & Sales Conversion Strategist for Indian enterprise operations (using ₹ Crores "Cr", Lakhs "L", Thousands "K").',
      'Cite ONLY real entity names, manager names (GM/ASM), categories, and exact numbers from the supplied JSON snapshot.',
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
            'Direct 2-4 sentence executive answer to the question citing exact ₹ figures, growth %, discount rate, and next-quarter outlook.',
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
      let usedModel = 'gemini-3.1-flash-lite';
      let response;
      try {
        response = await callModel('gemini-3.1-flash-lite', ThinkingLevel.MINIMAL);
      } catch (primaryErr: any) {
        const pStatus = primaryErr?.status || primaryErr?.code;
        const pMsg = String(primaryErr?.message || '');
        if (
          pStatus === 503 ||
          pStatus === 404 ||
          pMsg.includes('503') ||
          pMsg.includes('UNAVAILABLE') ||
          pMsg.includes('NOT_FOUND')
        ) {
          usedModel = 'gemini-4-hydrogen';
          response = await callModel('gemini-4-hydrogen', ThinkingLevel.LOW);
        } else {
          throw primaryErr;
        }
      }

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        res.status(502).json({ error: 'Gemini returned an empty response. Please try again.' });
        return;
      }

      const parsed = JSON.parse(rawText);
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

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PulseGrid Server running on http://0.0.0.0:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
