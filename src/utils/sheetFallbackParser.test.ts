import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGoogleSheetsHtmlViewTabs,
  normalizeParsedWorkbookDatasets,
  getSheetCacheTtlMs,
} from './sheetFallbackParser';
import type { Dataset } from '../types/data';

test('parseGoogleSheetsHtmlViewTabs extracts all tabs and gids accurately', () => {
  const sampleHtml = `
    <script>
      var items = [];
      items.push({name: "Sales Report", pageUrl: "https://docs.google.com/...", gid: "2101717202",initialSheet:true});
      items.push({name: "Finance Data", pageUrl: "https://docs.google.com/...", gid: "768592835",initialSheet:false});
      items.push({name: "Finance Data", pageUrl: "https://docs.google.com/...", gid: "768592835",initialSheet:false});
    </script>
  `;
  const tabs = parseGoogleSheetsHtmlViewTabs(sampleHtml);
  assert.deepEqual(tabs, [
    { name: 'Sales Report', gid: '2101717202' },
    { name: 'Finance Data', gid: '768592835' },
  ]);
});

test('normalizeParsedWorkbookDatasets preserves both Sales and Finance sheets with distinct IDs', () => {
  const defaultId = '1C4h8D0EtwYpWir5o128d_L1tMNMZeDuH';
  const input: Dataset[] = [
    {
      id: 'tmp-1',
      name: 'Sales Report',
      description: '',
      sheetNames: ['Sales Report', 'Finance Data'],
      activeSheet: 'Sales Report',
      rows: [{ Branch: 'A', Amount: 1000 }],
      columns: [
        { name: 'Branch', type: 'category', distinctCount: 1 },
        { name: 'Amount', type: 'number', distinctCount: 1 },
      ],
      defaultDateCol: '',
      defaultMetricCol: 'Amount',
      defaultDimCol: 'Branch',
    },
    {
      id: 'tmp-2',
      name: 'Finance Data',
      description: '',
      sheetNames: ['Sales Report', 'Finance Data'],
      activeSheet: 'Finance Data',
      rows: [{ Branch: 'A', Financier: 'Bajaj', 'Loan Amount': 500, Count: 1 }],
      columns: [
        { name: 'Branch', type: 'category', distinctCount: 1 },
        { name: 'Financier', type: 'category', distinctCount: 1 },
        { name: 'Loan Amount', type: 'number', distinctCount: 1 },
        { name: 'Count', type: 'number', distinctCount: 1 },
      ],
      defaultDateCol: '',
      defaultMetricCol: 'Loan Amount',
      defaultDimCol: 'Financier',
    },
  ];

  const normalized = normalizeParsedWorkbookDatasets(input, defaultId, defaultId, 'csv');
  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].reportType, 'sales');
  assert.equal(normalized[0].id, `gsheet-${defaultId}--sales-report`);
  assert.equal(normalized[1].reportType, 'finance');
  assert.equal(normalized[1].id, `gsheet-${defaultId}--finance-data`);
});

test('getSheetCacheTtlMs refuses to long-cache 1-sheet CSV fallback', () => {
  const defaultId = '1C4h8D0EtwYpWir5o128d_L1tMNMZeDuH';
  assert.equal(getSheetCacheTtlMs('csv', 1, defaultId, defaultId), 0);
  assert.equal(getSheetCacheTtlMs('csv', 1, 'other-sheet-id', defaultId), 0);
  assert.equal(getSheetCacheTtlMs('multi-csv', 2, defaultId, defaultId), 10 * 60 * 1000);
  assert.equal(getSheetCacheTtlMs('xlsx', 2, defaultId, defaultId), 10 * 60 * 1000);
});
