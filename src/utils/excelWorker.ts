import { parseExcelWorkbook } from './excelParser.ts';

self.onmessage = async (event: MessageEvent<{ id: number; buffer: ArrayBuffer; fileName: string }>) => {
  const { id, buffer, fileName } = event.data;
  try {
    const datasets = await parseExcelWorkbook(buffer, fileName);
    self.postMessage({ id, ok: true, datasets });
  } catch (err: any) {
    self.postMessage({ id, ok: false, error: err?.message || 'Failed to parse spreadsheet.' });
  }
};
