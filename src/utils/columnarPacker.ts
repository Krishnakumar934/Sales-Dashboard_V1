import type { Dataset, DataRow } from '../types/data.ts';

export interface PackedColumnarDataset {
  meta: Omit<Dataset, 'rows'>;
  headers: string[];
  /** For each column: string lookup dictionary when dict-encoded, or empty array when raw values */
  colDicts: string[][];
  /** True when colsData[c] stores dictionary indices into colDicts[c] */
  colIsDict: boolean[];
  /** Column-oriented cell data: length === headers.length, each inner array length === rowCount */
  colsData: (string | number)[][];
}

export interface ColumnarWorkbookPayload {
  version: 1;
  sheetId: string;
  datasets: PackedColumnarDataset[];
}

/**
 * Encodes parsed Datasets into a compact dictionary-encoded columnar structure
 * that compresses ~8x smaller than raw XLSX and unpacks without SheetJS overhead.
 */
export function encodeColumnarWorkbook(
  datasets: Dataset[],
  sheetId = ''
): ColumnarWorkbookPayload {
  const packed: PackedColumnarDataset[] = datasets.map((ds) => {
    const { rows, ...meta } = ds;
    const headers =
      ds.columns.length > 0
        ? ds.columns.map((c) => c.name)
        : rows.length > 0
        ? Object.keys(rows[0])
        : [];
    const colCount = headers.length;
    const rowCount = rows.length;
    const colDicts: string[][] = new Array(colCount);
    const colIsDict: boolean[] = new Array(colCount);
    const colsData: (string | number)[][] = new Array(colCount);

    for (let c = 0; c < colCount; c++) {
      const h = headers[c];
      const dict: string[] = [];
      const dictMap = new Map<string, number>();
      const colArr = new Array<string | number>(rowCount);
      let pureStringOrEmpty = true;

      for (let r = 0; r < rowCount; r++) {
        const v = rows[r][h];
        if (typeof v === 'number') {
          pureStringOrEmpty = false;
          break;
        }
        const str = v === null || v === undefined ? '' : String(v);
        let idx = dictMap.get(str);
        if (idx === undefined) {
          idx = dict.length;
          dict.push(str);
          dictMap.set(str, idx);
        }
        colArr[r] = idx;
      }

      if (pureStringOrEmpty) {
        colIsDict[c] = true;
        colDicts[c] = dict;
        colsData[c] = colArr;
      } else {
        colIsDict[c] = false;
        colDicts[c] = [];
        for (let r = 0; r < rowCount; r++) {
          const v = rows[r][h];
          colArr[r] = v === null || v === undefined ? '' : v;
        }
        colsData[c] = colArr;
      }
    }

    return {
      meta,
      headers,
      colDicts,
      colIsDict,
      colsData,
    };
  });

  return {
    version: 1,
    sheetId,
    datasets: packed,
  };
}

/**
 * Unpacks a dictionary-encoded columnar workbook back into standard Dataset objects.
 */
export function decodeColumnarWorkbook(payload: ColumnarWorkbookPayload): Dataset[] {
  if (!payload || !Array.isArray(payload.datasets)) {
    return [];
  }

  return payload.datasets.map((packed) => {
    const { meta, headers, colDicts, colIsDict, colsData } = packed;
    const colCount = headers.length;
    const rowCount = colCount > 0 && Array.isArray(colsData[0]) ? colsData[0].length : 0;

    // Resolve each column once into flat value lookup so row materialization is tight & fast
    const resolvedCols: (string | number)[][] = new Array(colCount);
    for (let c = 0; c < colCount; c++) {
      const rawCol = colsData[c] || [];
      if (colIsDict[c]) {
        const dict = colDicts[c] || [];
        const flat = new Array<string>(rowCount);
        for (let r = 0; r < rowCount; r++) {
          flat[r] = dict[rawCol[r] as number] ?? '';
        }
        resolvedCols[c] = flat;
      } else {
        resolvedCols[c] = rawCol;
      }
    }

    const rows: DataRow[] = new Array(rowCount);
    for (let r = 0; r < rowCount; r++) {
      const obj: DataRow = {};
      for (let c = 0; c < colCount; c++) {
        obj[headers[c]] = resolvedCols[c][r];
      }
      rows[r] = obj;
    }

    return {
      ...meta,
      rows,
    };
  });
}
