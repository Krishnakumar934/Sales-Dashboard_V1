import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { parseExcelFile, parseExcelWorkbook, parsePastedData } from './excelParser.ts';

test('parseExcelFile handles multi-sheet workbooks and chooses the sheet with the most records', async () => {
  const wb = XLSX.utils.book_new();

  // Cover sheet with 2 rows (like many corporate sheets)
  const coverSheet = XLSX.utils.aoa_to_sheet([
    ['Bank Operations Annual Ledger'],
    ['Generated on 2026-05-01'],
  ]);
  XLSX.utils.book_append_sheet(wb, coverSheet, 'Cover');

  // Real data sheet with 10 rows
  const data = [
    { Date: '2026-04-10', Branch: 'Ch-12 (Porur, Chennai)', GM: 'Vikram Malhotra', ASM: 'Deepak Joshi', Amount: 35000000, Quantity: 120, Discount: 850000 },
    { Date: '2026-04-15', Branch: 'Cm-25 (100Ft Road, Coimbatore)', GM: 'Ananya Deshmukh', ASM: 'Suresh Menon', Amount: 22000000, Quantity: 95, Discount: 620000 },
    { Date: '2026-05-01', Branch: 'Ch-13 (Omr, Chennai)', GM: 'Vikram Malhotra', ASM: 'Deepak Joshi', Amount: 24000000, Quantity: 110, Discount: 710000 },
    { Date: '2026-05-12', Branch: 'Md-02 (Simakkal, Madurai)', GM: 'Ananya Deshmukh', ASM: 'Suresh Menon', Amount: 19000000, Quantity: 80, Discount: 450000 },
    { Date: '2026-06-05', Branch: 'Try-01 (Cantonment, Trichy)', GM: 'Sunita Nair', ASM: 'Swati Sen', Amount: 18000000, Quantity: 75, Discount: 410000 },
  ];
  const dataSheet = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, dataSheet, 'Branch Summary');

  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const dataset = await parseExcelFile(buf, 'BranchReport.xlsx');

  assert.equal(dataset.activeSheet, 'Branch Summary');
  assert.equal(dataset.rows.length, 5);
  assert.equal(dataset.defaultMetricCol, 'Amount');
  assert.equal(dataset.defaultDateCol, 'Date');
});

test('parseExcelFile handles sheets with title banner rows before genuine headers', async () => {
  const wb = XLSX.utils.book_new();

  // Sheet with 2 title banner rows
  const sheetRows = [
    ['CONFIDENTIAL - REGIONAL OPERATIONS DASHBOARD'],
    ['Report Period: Apr 2026 to Oct 2026'],
    ['Date', 'Branch', 'GM', 'ASM', 'Amount', 'Quantity', 'Discount'],
    ['2026-05-01', 'Ch-12 (Porur, Chennai)', 'Vikram Malhotra', 'Deepak Joshi', 34000000, 110, 800000],
    ['2026-05-15', 'Ch-13 (Omr, Chennai)', 'Vikram Malhotra', 'Deepak Joshi', 23000000, 90, 600000],
  ];
  const ws = XLSX.utils.aoa_to_sheet(sheetRows);
  XLSX.utils.book_append_sheet(wb, ws, 'Data');

  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const dataset = await parseExcelFile(buf, 'BannerReport.xlsx');

  assert.equal(dataset.rows.length, 2);
  assert.equal(dataset.rows[0]['Branch'], 'Ch-12 (Porur, Chennai)');
  assert.equal(dataset.defaultMetricCol, 'Amount');
});

test('parsePastedData parses tab-separated or comma-separated table text cleanly', () => {
  const tsv = `Date\tBranch\tGM\tASM\tAmount\tQuantity\tDiscount
2026-05-01\tMumbai Central\tRajesh Sharma\tRohit Verma\t4500000\t15\t120000
2026-05-02\tPune Shivaji Nagar\tRajesh Sharma\tRohit Verma\t3800000\t12\t95000`;

  const dataset = parsePastedData(tsv, 'Pasted TSV');
  assert.equal(dataset.rows.length, 2);
  assert.equal(dataset.rows[0]['Branch'], 'Mumbai Central');
  assert.equal(dataset.defaultMetricCol, 'Amount');
});

test('parseExcelFile decodes Excel date serials (Apr-26..Oct-26) without timezone drift while preserving numeric Amount=46113', async () => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Branch', 'Amount', 'Month'],
    ['Akm-01', 46113, { t: 'n', v: 46113, z: 'mmm-yy' }],
    ['Ch-01', 590193, { t: 'n', v: 46143, z: 'mmm-yy' }],
    ['Cm-01', 200865, { t: 'n', v: 46174, z: 'mmm-yy' }],
    ['Md-01', 396551, { t: 'n', v: 46204, z: 'mmm-yy' }],
    ['Try-01', 410000, { t: 'n', v: 46235, z: 'mmm-yy' }],
    ['Er-01', 515000, { t: 'n', v: 46266, z: 'mmm-yy' }],
    ['Slm-01', 620000, { t: 'n', v: 46296, z: 'mmm-yy' }],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Daily Sales Report');

  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const dataset = await parseExcelFile(buf, 'AprOct.xlsx');

  assert.equal(dataset.defaultDateCol, 'Month');
  assert.equal(dataset.rows[0]['Month'], '2026-04-01');
  assert.equal(dataset.rows[6]['Month'], '2026-10-01');
  assert.equal(dataset.rows[0]['Amount'], 46113);
});

test('parseExcelWorkbook extracts both Sales Report and Finance Data sheets with Finance defaults', async () => {
  const wb = XLSX.utils.book_new();

  const salesWs = XLSX.utils.aoa_to_sheet([
    ['Branch', 'Category', 'Product', 'Brand', 'Discount', 'DP Discount', 'Quantity', 'Amount', 'Month', 'GM', 'ASM'],
    ['Akm-01', 'HOME APPLIANCES', 'WM', 'Haier', 1000, 500, 1, 25000, { t: 'n', v: 46113, z: 'mmm-yy' }, 'RIYAS', 'KUMAR'],
    ['Ch-01', 'MOBILE & TABLET', '5G Phone', 'OPPO', 500, 0, 2, 42000, { t: 'n', v: 46143, z: 'mmm-yy' }, 'RIYAS', 'KUMAR'],
  ]);
  XLSX.utils.book_append_sheet(wb, salesWs, 'Sales Report');

  const financeWs = XLSX.utils.aoa_to_sheet([
    ['Branch', 'Invoice Number', 'Category', 'Brand', 'Qty', 'Invoice Count', 'Financier', 'Loan Amount', 'Count', 'Month', 'GM', 'ASM'],
    ['Akm-01', '26-SI-AKM1-004', 'MOBILE & TABLET', 'OPPO', 1, 1, 'IDFC FINANCE', 18999, 1, { t: 'n', v: 46113, z: 'mmm-yy' }, 'RIYAS', 'KUMAR'],
    ['Akm-01', '26-SI-AKM1-004', 'ACCESSORIES', 'BOAT', 1, 1, 'IDFC FINANCE', 1799, '', { t: 'n', v: 46113, z: 'mmm-yy' }, 'RIYAS', 'KUMAR'],
  ]);
  XLSX.utils.book_append_sheet(wb, financeWs, 'Finance Data');

  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const datasets = await parseExcelWorkbook(buf, 'SalesAndFinance.xlsx');

  assert.equal(datasets.length, 2);

  const salesDs = datasets.find((d) => d.activeSheet === 'Sales Report');
  const financeDs = datasets.find((d) => d.activeSheet === 'Finance Data');

  assert.ok(salesDs);
  assert.equal(salesDs.reportType, 'sales');
  assert.equal(salesDs.defaultMetricCol, 'Amount');

  assert.ok(financeDs);
  assert.equal(financeDs.reportType, 'finance');
  assert.equal(financeDs.defaultMetricCol, 'Loan Amount');
  assert.equal(financeDs.defaultDimCol, 'Financier');
  assert.equal(financeDs.defaultCountCol, 'Count');
  assert.equal(financeDs.defaultDateCol, 'Month');
  assert.equal(financeDs.rows[0]['Month'], '2026-04-01');
});

