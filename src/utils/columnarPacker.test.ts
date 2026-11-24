import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeColumnarWorkbook, decodeColumnarWorkbook } from './columnarPacker.ts';
import type { Dataset } from '../types/data.ts';

test('encodeColumnarWorkbook and decodeColumnarWorkbook round-trip multi-sheet datasets identically', () => {
  const datasets: Dataset[] = [
    {
      id: 'gsheet-test--sales',
      name: 'Sales Report',
      fileName: 'Main.xlsx',
      description: 'Sales sheet',
      sheetNames: ['Sales Report', 'Finance Data'],
      activeSheet: 'Sales Report',
      reportType: 'sales',
      columns: [
        { name: 'Date', type: 'date' },
        { name: 'Branch', type: 'category' },
        { name: 'Amount', type: 'number' },
        { name: 'Qty', type: 'number' },
      ],
      defaultDateCol: 'Date',
      defaultMetricCol: 'Amount',
      defaultDimCol: 'Branch',
      rows: [
        { Date: '2026-04-01', Branch: 'Vpm-01 (Nehruji Road, Vilupuram)', Amount: 125000, Qty: 4 },
        { Date: '2026-05-02', Branch: 'Porur', Amount: '', Qty: 0 },
        { Date: '2026-06-03', Branch: 'Vpm-01 (Nehruji Road, Vilupuram)', Amount: 89500.5, Qty: 3 },
      ],
    },
    {
      id: 'gsheet-test--finance',
      name: 'Finance Data',
      fileName: 'Main.xlsx',
      description: 'Finance sheet',
      sheetNames: ['Sales Report', 'Finance Data'],
      activeSheet: 'Finance Data',
      reportType: 'finance',
      columns: [
        { name: 'Month', type: 'date' },
        { name: 'Financier', type: 'category' },
        { name: 'Loan Amount', type: 'number' },
        { name: 'Count', type: 'number' },
      ],
      defaultDateCol: 'Month',
      defaultMetricCol: 'Loan Amount',
      defaultDimCol: 'Financier',
      defaultCountCol: 'Count',
      rows: [
        { Month: '2026-04-01', Financier: 'BAJAJ FINANCE', 'Loan Amount': 42000, Count: 1 },
        { Month: '2026-05-01', Financier: 'IDFC FINANCE', 'Loan Amount': 31500, Count: 1 },
      ],
    },
  ];

  const encoded = encodeColumnarWorkbook(datasets, 'sheet-123');
  assert.equal(encoded.version, 1);
  assert.equal(encoded.datasets[0].colIsDict[1], true); // Branch string column
  assert.equal(encoded.datasets[0].colDicts[1].length, 2); // Deduplicated 2 unique branches

  const decoded = decodeColumnarWorkbook(encoded);
  assert.equal(decoded.length, 2);
  assert.deepEqual(decoded, datasets);
});
