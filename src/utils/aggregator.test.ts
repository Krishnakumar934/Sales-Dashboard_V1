import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeToMonthKey,
  formatMonthLabel,
  getMonthSpan,
  getPreviousMonthRange,
  computeAggregate,
  filterRowsByDate,
  filterRowsByFacetAndSearch,
  aggregateTimeSeries,
  aggregateByDimension,
  calculateKPIs,
  formatNumberCompact,
  formatIndianCurrency,
  formatIndianFull,
  formatIndianCount,
  isNumericValue,
  cleanNumber,
  inferColumnTypes,
  getPrimaryAmountMetric,
  isCurrencyMetric,
  extractMonthRangeFromVal,
  extractAvailableMonths,
  findDedicatedCountCol,
  findExplicitCountCol,
  isFinanceDataset,
  aggregateTopStores,
  aggregateShareByDimension,
  calculateStoreDetails,
  computeDashboardBundle,
  prewarmDatasetCaches,
} from './aggregator.ts';

test('isNumericValue and cleanNumber prevent text with dashes from becoming negative numbers', () => {
  // Alphanumeric text should NOT be numeric
  assert.equal(isNumericValue('Branch 1'), false);
  assert.equal(isNumericValue('Branch-01'), false);
  assert.equal(isNumericValue('GM 4'), false);
  assert.equal(isNumericValue('B-101'), false);
  assert.equal(isNumericValue('Zone-A'), false);

  // cleanNumber must return 0 for alphanumeric text, NOT negative numbers!
  assert.equal(cleanNumber('Branch-01'), 0); // was previously -1!
  assert.equal(cleanNumber('B-101'), 0);     // was previously -101!
  assert.equal(cleanNumber('GM 4'), 0);

  // Genuine numbers
  assert.equal(isNumericValue('12500'), true);
  assert.equal(isNumericValue('$12,500.50'), true);
  assert.equal(isNumericValue('-500'), true);
  assert.equal(isNumericValue('(250)'), true);
  assert.equal(isNumericValue('45.2%'), true);

  assert.equal(cleanNumber('$12,500.50'), 12500.5);
  assert.equal(cleanNumber('-$500'), -500);
  assert.equal(cleanNumber('(250)'), -250);
  assert.equal(cleanNumber('75%'), 75);
});

test('inferColumnTypes properly categorizes Branch and GM as categories, not numbers', () => {
  const rows = [
    { Branch: 'Branch-01', GM: 'GM 1', Sales: 45000 },
    { Branch: 'Branch-02', GM: 'GM 2', Sales: 52000 },
    { Branch: 'Branch-03', GM: 'GM 1', Sales: 61000 },
  ];

  const cols = inferColumnTypes(rows);
  const branchCol = cols.find((c) => c.name === 'Branch');
  const gmCol = cols.find((c) => c.name === 'GM');
  const salesCol = cols.find((c) => c.name === 'Sales');

  assert.equal(branchCol?.type, 'category');
  assert.equal(gmCol?.type, 'category');
  assert.equal(salesCol?.type, 'number');
});

test('computeAggregate handles 250,000 elements without Maximum call stack size exceeded', () => {
  const largeArray = new Array(250_000);
  for (let i = 0; i < 250_000; i++) {
    largeArray[i] = (i % 100) + 1;
  }

  const sum = computeAggregate(largeArray, 'sum');
  const max = computeAggregate(largeArray, 'max');
  const min = computeAggregate(largeArray, 'min');
  const avg = computeAggregate(largeArray, 'avg');

  assert.equal(max, 100);
  assert.equal(min, 1);
  assert.equal(avg, 50.5);
  assert.equal(sum > 0, true);
});

test('calculateKPIs and aggregateTimeSeries handle 250,000 rows smoothly', () => {
  const rows = new Array(250_000);
  for (let i = 0; i < 250_000; i++) {
    const month = (i % 5) + 1;
    rows[i] = {
      Date: `2026-0${month}-15`,
      Revenue: (i % 500) + 10,
      Region: i % 2 === 0 ? 'APAC' : 'EMEA',
    };
  }

  const kpis = calculateKPIs(rows, rows, {
    metricCol: 'Revenue',
    dimCol: 'Region',
    dateCol: 'Date',
    aggType: 'sum',
  }, {
    startMonth: '2026-01',
    endMonth: '2026-05',
  });

  assert.equal(kpis.length, 3);
  assert.equal(kpis[0].label, 'Total Amount');
  assert.equal(kpis[1].label, 'Total Quantity');
  assert.equal(kpis[1].value, 250_000);
  assert.equal(kpis[2].label, 'Total Discount');

  const slices = aggregateByDimension(rows, 'Region', 'Revenue', 'sum');
  assert.equal(slices.length, 2);
  assert.equal(slices[0].count, 125_000);

  const topStores = aggregateTopStores(rows, 'Region', 'Revenue', 2);
  assert.equal(topStores.length, 2);
  assert.equal(topStores[0].category !== 'Other', true);
});

test('formatIndianCurrency strictly follows tiered system: Crores, Lakhs, Thousands', () => {
  // ₹ Crores (>= 1,00,00,000)
  assert.equal(formatIndianCurrency(15000000), '₹ 1.50 Cr');
  assert.equal(formatIndianCurrency(250000000), '₹ 25.00 Cr');
  assert.equal(formatIndianCurrency(929971535.8), '₹ 93.00 Cr');

  // ₹ Lakhs (>= 1,00,000 and < 1,00,00,000)
  assert.equal(formatIndianCurrency(6576842), '₹ 65.77 L');
  assert.equal(formatIndianCurrency(4371644.5), '₹ 43.72 L');
  assert.equal(formatIndianCurrency(1250000), '₹ 12.50 L');
  assert.equal(formatIndianCurrency(450000), '₹ 4.50 L');

  // ₹ Thousands (>= 1,000 and < 1,00,000) - specifically testing 55,024.65 from User Image 2!
  assert.equal(formatIndianCurrency(55024.65), '₹ 55.02 K');
  assert.equal(formatIndianCurrency(12500), '₹ 12.50 K');
  assert.equal(formatIndianCurrency(1000), '₹ 1.00 K');

  // Raw Rupees (< 1,000)
  assert.equal(formatIndianCurrency(850.5), '₹ 850.50');
  assert.equal(formatIndianCurrency(45), '₹ 45');
  assert.equal(formatIndianCurrency(0), '₹ 0.00');

  // Full Indian grouping with commas for counts
  assert.equal(formatIndianCount(1234567), '12,34,567');

  // Parsing Indian values with ₹, Rs, INR, Lakh, Cr
  assert.equal(cleanNumber('₹ 15,00,000'), 1500000);
  assert.equal(cleanNumber('Rs. 45,000'), 45000);
  assert.equal(cleanNumber('INR 2,50,000'), 250000);
  assert.equal(cleanNumber('2.5 Cr'), 25000000);
  assert.equal(cleanNumber('10 Lakhs'), 1000000);
});

test('normalizeToMonthKey and extractMonthRangeFromVal correctly parse Indian and Apr-Aug dates', () => {
  assert.equal(normalizeToMonthKey('2025-04-15'), '2025-04');
  assert.equal(normalizeToMonthKey('15/04/2025'), '2025-04');
  assert.equal(normalizeToMonthKey('01/08/2025'), '2025-08');
  assert.equal(normalizeToMonthKey('15-Apr-2025'), '2025-04');
  assert.equal(normalizeToMonthKey('Apr-25'), '2025-04');
  assert.equal(normalizeToMonthKey('Aug-25'), '2025-08');
  assert.equal(normalizeToMonthKey('Apr 2025'), '2025-04');
  assert.equal(normalizeToMonthKey('August 2025'), '2025-08');
  assert.equal(normalizeToMonthKey('Apr'), '2025-04');
  assert.equal(normalizeToMonthKey('Aug'), '2025-08');
  assert.equal(normalizeToMonthKey('Apr - Aug'), '2025-04');
  assert.equal(normalizeToMonthKey('Apr-Aug'), '2025-04');
  assert.equal(normalizeToMonthKey('Apr - Sep 2026'), '2026-04');

  // Verify UTC Date instances (as returned by XLSX with cellDates: true)
  const utcApril = new Date(Date.UTC(2026, 3, 1, 0, 0, 0)); // April 1, 2026 UTC
  const utcSept = new Date(Date.UTC(2026, 8, 30, 0, 0, 0)); // Sept 30, 2026 UTC
  assert.equal(normalizeToMonthKey(utcApril), '2026-04');
  assert.equal(normalizeToMonthKey(utcSept), '2026-09');

  const range = extractMonthRangeFromVal('Apr - Aug');
  assert.deepEqual(range, { start: '2025-04', end: '2025-08' });

  const rangeSep = extractMonthRangeFromVal('Apr - Sep 2026');
  assert.deepEqual(rangeSep, { start: '2026-04', end: '2026-09' });

  // Test date filtering with Apr - Aug
  const testRows = [
    { Date: 'Apr - Aug', Amount: 100 },
    { Date: '15/04/2025', Amount: 200 },
    { Date: '15/09/2025', Amount: 300 }, // outside
  ];
  const dateFiltered = filterRowsByDate(testRows, 'Date', '2025-04', '2025-08');
  assert.equal(dateFiltered.length, 2);

  // Guard against invalid numeric/text fallbacks creating bogus years like 2001 or 0100
  assert.equal(normalizeToMonthKey('1'), null);
  assert.equal(normalizeToMonthKey('100'), null);
  assert.equal(normalizeToMonthKey('Branch 1'), null);
  assert.equal(normalizeToMonthKey('Store 5'), null);
  assert.equal(normalizeToMonthKey(42), null);

  // Guard against UTC 23:59:59 floating-point underflow shifting Apr 1 -> Mar 31
  const underflowApril = new Date('2026-03-31T23:59:59.990Z');
  assert.equal(normalizeToMonthKey(underflowApril), '2026-04');
});

test('extractAvailableMonths accurately detects MDY vs DMY columns and month spans', () => {
  // US MM/DD/YYYY dates spanning Apr 1, 2026 through Sep 30, 2026 must NOT turn into Jan-Dec!
  const mdyRows = [
    { Date: '4/1/2026', Amount: 100 },
    { Date: '4/15/2026', Amount: 200 },
    { Date: '5/2/2026', Amount: 300 },
    { Date: '9/25/2026', Amount: 400 },
    { Date: '9/1/2026', Amount: 500 },
  ];
  const mdyMonths = extractAvailableMonths(mdyRows, 'Date');
  assert.deepEqual(mdyMonths, ['2026-04', '2026-05', '2026-09']);

  // Indian DD/MM/YYYY dates spanning Apr-Sep 2026
  const dmyRows = [
    { Date: '01/04/2026', Amount: 100 },
    { Date: '20/04/2026', Amount: 200 },
    { Date: '05/06/2026', Amount: 300 },
    { Date: '30/09/2026', Amount: 400 },
  ];
  const dmyMonths = extractAvailableMonths(dmyRows, 'Date');
  assert.deepEqual(dmyMonths, ['2026-04', '2026-06', '2026-09']);

  // Month span string expands across full span
  const spanMonths = extractAvailableMonths([{ Date: 'Apr - Sep 2026', Amount: 100 }], 'Date');
  assert.deepEqual(spanMonths, ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
});

test('getPrimaryAmountMetric and isCurrencyMetric recognize Amount, Discount, and counts', () => {
  const cols = [
    { name: 'S.No', type: 'number' as const },
    { name: 'Branch', type: 'category' as const },
    { name: 'Transaction Count', type: 'number' as const },
    { name: 'Amount', type: 'number' as const },
    { name: 'Discount', type: 'number' as const },
  ];

  assert.equal(getPrimaryAmountMetric(cols), 'Amount');
  assert.equal(isCurrencyMetric('Amount'), true);
  assert.equal(isCurrencyMetric('Discount'), true);
  assert.equal(isCurrencyMetric('Total Discount'), true);
  assert.equal(isCurrencyMetric('Transaction Count'), false);
  assert.equal(isCurrencyMetric('Customers'), false);
  assert.equal(isCurrencyMetric('Disbursement'), true);

  // Discount must not be mistaken for a dedicated count column
  const countCol = findDedicatedCountCol(cols);
  assert.equal(countCol, 'Transaction Count');
});

test('filterRowsByFacetAndSearch matches case-insensitively and handles whitespace', () => {
  const rows = [
    { GM: 'RIYAS ', ASM: 'John', Branch: 'Kochi' },
    { GM: 'Ananya', ASM: 'Priya', Branch: 'Bengaluru' },
  ];

  const matched = filterRowsByFacetAndSearch(rows, { GM: ['RIYAS'] }, '');
  assert.equal(matched.length, 1);
  assert.equal(matched[0].ASM, 'John');
});

test('Finance Data strictly calculates Count as SUM(Count) and Value as SUM(Loan Amount) across multi-item invoices', () => {
  const financeRows = [
    {
      Branch: 'Akm-01 (Arakkonam)',
      'Invoice Number': '26-SI-AKM1-004',
      Category: 'MOBILE & TABLET',
      Brand: 'OPPO',
      Qty: 1,
      'Invoice Count': 1,
      Financier: 'IDFC FINANCE',
      'Loan Amount': 18999,
      Count: 1,
      Month: '2026-04-01',
      GM: 'RIYAS',
      ASM: 'KUMAR',
    },
    {
      Branch: 'Akm-01 (Arakkonam)',
      'Invoice Number': '26-SI-AKM1-004',
      Category: 'ACCESSORIES',
      Brand: 'BOAT',
      Qty: 1,
      'Invoice Count': 1,
      Financier: 'IDFC FINANCE',
      'Loan Amount': 1799,
      Count: '',
      Month: '2026-04-01',
      GM: 'RIYAS',
      ASM: 'KUMAR',
    },
    {
      Branch: 'Ch-01 (Chennai)',
      'Invoice Number': '26-SI-CH1-009',
      Category: 'HOME APPLIANCES',
      Brand: 'Haier',
      Qty: 2,
      'Invoice Count': 1,
      Financier: 'BAJAJ FINSERV',
      'Loan Amount': 35000,
      Count: 2,
      Month: '2026-05-01',
      GM: 'ANANYA',
      ASM: 'SURESH',
    },
  ];

  const cols = inferColumnTypes(financeRows);
  assert.equal(isFinanceDataset(cols), true);
  assert.equal(cols.find((c) => c.name === 'Count')?.type, 'number');
  assert.equal(cols.find((c) => c.name === 'Financier')?.type, 'category');
  assert.equal(cols.find((c) => c.name === 'Brand')?.type, 'category');
  assert.equal(findExplicitCountCol(cols), 'Count');
  assert.equal(findDedicatedCountCol(cols), 'Count');

  const kpis = calculateKPIs(
    financeRows,
    financeRows,
    { metricCol: 'Loan Amount', dimCol: 'Financier', dateCol: 'Month', aggType: 'sum' },
    { startMonth: '2026-04', endMonth: '2026-05', preset: 'all' },
    cols
  );
  assert.equal(kpis[0].label, 'Total Loan Amount');
  assert.equal(kpis[0].value, 55798);
  assert.equal(kpis[1].label, 'Total Count');
  assert.equal(kpis[1].value, 3); // 1 + 0 + 2 (NOT 3 rows and NOT Qty=4)
  assert.equal(kpis[2].label, 'Avg Loan Size');
  assert.equal(Math.round(kpis[2].value), Math.round(55798 / 3));

  const series = aggregateTimeSeries(
    financeRows,
    'Month',
    'Loan Amount',
    'sum',
    '2026-04',
    '2026-05',
    'Count'
  );
  assert.equal(series[0].value, 20798);
  assert.equal(series[0].count, 1);
  assert.equal(series[1].value, 35000);
  assert.equal(series[1].count, 2);

  const catCounts = aggregateShareByDimension(financeRows, 'Category', 'Loan Amount', 8, 'Count', 'count');
  assert.equal(catCounts[0].category, 'HOME APPLIANCES');
  assert.equal(catCounts[0].count, 2);
  assert.equal(catCounts[1].category, 'MOBILE & TABLET');
  assert.equal(catCounts[1].count, 1);
  assert.equal(catCounts[2].category, 'ACCESSORIES');
  assert.equal(catCounts[2].count, 0);
  assert.equal(catCounts[2].value, 1799);

  const stores = aggregateTopStores(financeRows, 'Branch', 'Loan Amount', 10, cols);
  const akmStore = stores.find((s) => s.category === 'Akm-01 (Arakkonam)');
  assert.equal(akmStore?.value, 20798);
  assert.equal(akmStore?.count, 1);
  assert.equal(akmStore?.quantity, 2);

  const storeReport = calculateStoreDetails(financeRows, 'Akm-01 (Arakkonam)', 'Branch', cols);
  assert.equal(storeReport?.isFinance, true);
  assert.equal(storeReport?.totalAmount, 20798);
  assert.equal(storeReport?.recordCount, 1);
  assert.equal(storeReport?.totalQuantity, 2);
  assert.equal(storeReport?.avgTicket, 20798);
});

test('Entity drilldowns return Financier login counts for Brands and cross-linked Sales summaries for GM/ASM/Store', () => {
  const salesRows = [
    { Branch: 'Akm-01', Category: 'MOBILE & TABLET', Brand: 'OPPO', Quantity: 3, Amount: 60000, Discount: 2000, Month: '2026-04-01', GM: 'RIYAS', ASM: 'KUMAR' },
    { Branch: 'Ch-01', Category: 'MOBILE & TABLET', Brand: 'OPPO', Quantity: 2, Amount: 40000, Discount: 1000, Month: '2026-05-01', GM: 'ANANYA', ASM: 'SURESH' },
  ];
  const salesCols = inferColumnTypes(salesRows);

  const financeRows = [
    { Branch: 'Akm-01', 'Invoice Number': 'INV-1', Category: 'MOBILE & TABLET', Brand: 'OPPO', Qty: 1, 'Invoice Count': 1, Financier: 'BAJAJ FINANCE', 'Loan Amount': 25000, Count: 1, Month: '2026-04-01', GM: 'RIYAS', ASM: 'KUMAR' },
    { Branch: 'Akm-01', 'Invoice Number': 'INV-1', Category: 'ACCESSORIES', Brand: 'OPPO', Qty: 1, 'Invoice Count': 1, Financier: 'BAJAJ FINANCE', 'Loan Amount': 2000, Count: '', Month: '2026-04-01', GM: 'RIYAS', ASM: 'KUMAR' },
    { Branch: 'Ch-01', 'Invoice Number': 'INV-2', Category: 'MOBILE & TABLET', Brand: 'OPPO', Qty: 2, 'Invoice Count': 1, Financier: 'IDFC FINANCE', 'Loan Amount': 32000, Count: 2, Month: '2026-05-01', GM: 'ANANYA', ASM: 'SURESH' },
    { Branch: 'Ch-01', 'Invoice Number': 'INV-3', Category: 'HOME APPLIANCES', Brand: 'HAIER', Qty: 1, 'Invoice Count': 1, Financier: 'IDFC FINANCE', 'Loan Amount': 18000, Count: 1, Month: '2026-05-01', GM: 'ANANYA', ASM: 'SURESH' },
  ];
  const financeCols = inferColumnTypes(financeRows);

  // Clicking Brand "OPPO" on Finance Report shows Financier login counts (IDFC: 2, BAJAJ: 1) + Sales summary (100,000)
  const brandReport = calculateStoreDetails(financeRows, 'OPPO', 'Brand', financeCols, {
    dimensionLabel: 'Brand',
    counterpartSalesRows: salesRows,
    counterpartSalesCols: salesCols,
  });
  assert.ok(brandReport);
  assert.equal(brandReport.recordCount, 3);
  assert.equal(brandReport.totalAmount, 59000);
  assert.equal(brandReport.financierBreakdown?.length, 2);
  assert.equal(brandReport.financierBreakdown?.[0].name, 'IDFC FINANCE');
  assert.equal(brandReport.financierBreakdown?.[0].count, 2);
  assert.equal(brandReport.financierBreakdown?.[1].name, 'BAJAJ FINANCE');
  assert.equal(brandReport.financierBreakdown?.[1].count, 1);
  assert.equal(brandReport.salesSummary?.totalSalesAmount, 100000);
  assert.equal(brandReport.salesSummary?.financePenetrationPct, 59);

  // Clicking GM "RIYAS" on Finance Report shows cross-linked Sales Summary + Financier login breakdown
  const gmReport = calculateStoreDetails(financeRows, 'RIYAS', 'GM', financeCols, {
    dimensionLabel: 'GM',
    counterpartSalesRows: salesRows,
    counterpartSalesCols: salesCols,
  });
  assert.ok(gmReport);
  assert.equal(gmReport.salesSummary?.totalSalesAmount, 60000);
  assert.equal(gmReport.salesSummary?.totalQuantity, 3);
  assert.equal(gmReport.financierBreakdown?.[0].name, 'BAJAJ FINANCE');
  assert.equal(gmReport.financierBreakdown?.[0].count, 1);

  // Clicking Brand "OPPO" from Sales Report still shows cross-linked Finance Login Counts by Financier
  const salesBrandReport = calculateStoreDetails(salesRows, 'OPPO', 'Brand', salesCols, {
    dimensionLabel: 'Brand',
    counterpartFinanceRows: financeRows,
    counterpartFinanceCols: financeCols,
  });
  assert.ok(salesBrandReport);
  assert.equal(salesBrandReport.financeSummary?.totalLoginCount, 3);
  assert.equal(salesBrandReport.financeSummary?.totalLoanAmount, 59000);
  assert.equal(salesBrandReport.financierBreakdown?.[0].name, 'IDFC FINANCE');
  assert.equal(salesBrandReport.financierBreakdown?.[0].count, 2);
});

test('Tab switching across 160,000 rows warms cache cleanly and repeats in milliseconds', () => {
  const rows = new Array(160_000);
  const months = ['Apr-26', 'May-26', 'Jun-26', 'Jul-26', 'Aug-26', 'Sep-26', 'Oct-26'];
  for (let i = 0; i < 160_000; i++) {
    rows[i] = {
      Branch: `Store-${i % 45}`,
      Financier: i % 2 === 0 ? 'BAJAJ FINANCE' : 'IDFC FINANCE',
      Brand: i % 3 === 0 ? 'OPPO' : 'VIVO',
      Category: 'MOBILE & TABLET',
      'Loan Amount': 25000,
      Count: i % 5 === 0 ? 0 : 1,
      Qty: 1,
      Month: months[i % months.length],
      GM: `GM-${i % 5}`,
      ASM: `ASM-${i % 12}`,
    };
  }
  const cols = inferColumnTypes(rows);

  // Cold pass
  const coldStart = performance.now();
  const avail = extractAvailableMonths(rows, 'Month');
  const kpis = calculateKPIs(
    rows,
    rows,
    { metricCol: 'Loan Amount', dimCol: 'Financier', dateCol: 'Month', aggType: 'sum' },
    { startMonth: '2026-04', endMonth: '2026-10', preset: 'all' },
    cols
  );
  const series = aggregateTimeSeries(rows, 'Month', 'Loan Amount', 'sum', '2026-04', '2026-10', 'Count');
  const stores = aggregateTopStores(rows, 'Branch', 'Loan Amount', 10, cols);
  const shares = aggregateShareByDimension(rows, 'Financier', 'Loan Amount', 8, 'Count', 'value');
  const coldMs = performance.now() - coldStart;

  assert.equal(avail.length, 7);
  assert.equal(kpis[0].value, 160_000 * 25000);
  assert.equal(series.length, 7);
  assert.equal(stores.length, 10);
  assert.equal(shares.length, 2);
  assert.equal(coldMs < 3000, true, `Cold 160k pass took ${coldMs.toFixed(1)}ms`);

  // Warm tab switch repeat
  const warmStart = performance.now();
  const avail2 = extractAvailableMonths(rows, 'Month');
  const kpis2 = calculateKPIs(
    rows,
    rows,
    { metricCol: 'Loan Amount', dimCol: 'Financier', dateCol: 'Month', aggType: 'sum' },
    { startMonth: '2026-04', endMonth: '2026-10', preset: 'all' },
    cols
  );
  const series2 = aggregateTimeSeries(rows, 'Month', 'Loan Amount', 'sum', '2026-04', '2026-10', 'Count');
  const stores2 = aggregateTopStores(rows, 'Branch', 'Loan Amount', 500, cols);
  const shares2 = aggregateShareByDimension(rows, 'Financier', 'Loan Amount', 8, 'Count', 'value');
  const warmMs = performance.now() - warmStart;

  assert.deepEqual(avail2, avail);
  assert.equal(kpis2[0].value, kpis[0].value);
  assert.equal(series2.length, 7);
  assert.equal(stores2.length, 45);
  assert.equal(shares2.length, 2);
  assert.equal(warmMs < 50, true, `Warm repeat pass took ${warmMs.toFixed(2)}ms`);
});

test('computeDashboardBundle matches individual aggregators for Sales (with deltas) and Finance datasets', () => {
  // 1. Sales Report parity including non-"all" previous-period delta calculation
  const salesRows = [
    { Branch: 'Store A', Category: 'MOBILE', Brand: 'OPPO', Quantity: 2, Amount: 40000, Discount: 1000, Month: '2026-04-05', GM: 'RIYAS', ASM: 'KUMAR' },
    { Branch: 'Store B', Category: 'TV', Brand: 'LG', Quantity: 1, Amount: 30000, Discount: 500, Month: '2026-04-12', GM: 'ANANYA', ASM: 'SURESH' },
    { Branch: 'Store A', Category: 'MOBILE', Brand: 'VIVO', Quantity: 3, Amount: 60000, Discount: 1500, Month: '2026-05-08', GM: 'RIYAS', ASM: 'KUMAR' },
    { Branch: 'Store C', Category: 'AC', Brand: 'VOLTAS', Quantity: 2, Amount: 50000, Discount: 2000, Month: '2026-05-19', GM: 'ANANYA', ASM: 'MEENA' },
  ];
  const salesCols = inferColumnTypes(salesRows);
  const mayRows = filterRowsByDate(salesRows, 'Month', '2026-05', '2026-05');
  const salesConfig = { metricCol: 'Amount', dimCol: 'Branch', dateCol: 'Month', aggType: 'sum' as const };
  const salesRange = { startMonth: '2026-05', endMonth: '2026-05', preset: 'custom' as const };

  const salesBundle = computeDashboardBundle({
    allRows: salesRows,
    filteredRows: mayRows,
    columns: salesCols,
    config: salesConfig,
    dateRange: salesRange,
  });

  const expectedSalesKpis = calculateKPIs(salesRows, mayRows, salesConfig, salesRange, salesCols);
  const expectedSalesSeries = aggregateTimeSeries(mayRows, 'Month', 'Amount', 'sum', '2026-05', '2026-05');
  const expectedSalesStores = aggregateTopStores(mayRows, 'Branch', 'Amount', 10, salesCols);
  const expectedSalesGm = aggregateShareByDimension(mayRows, 'GM', 'Amount', 6, undefined, 'value');
  const expectedSalesAsm = aggregateShareByDimension(mayRows, 'ASM', 'Amount', 8, undefined, 'value');

  assert.deepEqual(salesBundle.kpiMetrics, expectedSalesKpis);
  assert.deepEqual(salesBundle.timeSeriesData, expectedSalesSeries);
  assert.deepEqual(salesBundle.topStoresData, expectedSalesStores);
  assert.deepEqual(salesBundle.gmShareData, expectedSalesGm);
  assert.deepEqual(salesBundle.asmShareData, expectedSalesAsm);
  assert.equal(salesBundle.kpiMetrics[0].previousValue, 70000);
  assert.equal(salesBundle.kpiMetrics[0].deltaPercent, 57.1);

  // 2. Finance Data parity (Loan Amount, SUM(Count), Financier, GM, ASM, Category, Brand)
  const financeRows = [
    { Branch: 'Akm-01', 'Invoice Number': 'INV-1', Category: 'MOBILE', Brand: 'OPPO', Qty: 1, 'Invoice Count': 1, Financier: 'BAJAJ FINANCE', 'Loan Amount': 25000, Count: 1, Month: '2026-04-01', GM: 'RIYAS', ASM: 'KUMAR' },
    { Branch: 'Akm-01', 'Invoice Number': 'INV-1', Category: 'ACCESSORIES', Brand: 'BOAT', Qty: 1, 'Invoice Count': 1, Financier: 'BAJAJ FINANCE', 'Loan Amount': 2000, Count: '', Month: '2026-04-01', GM: 'RIYAS', ASM: 'KUMAR' },
    { Branch: 'Ch-01', 'Invoice Number': 'INV-2', Category: 'MOBILE', Brand: 'VIVO', Qty: 2, 'Invoice Count': 1, Financier: 'IDFC FINANCE', 'Loan Amount': 32000, Count: 2, Month: '2026-05-01', GM: 'ANANYA', ASM: 'SURESH' },
    { Branch: 'Ch-01', 'Invoice Number': 'INV-3', Category: 'APPLIANCES', Brand: 'HAIER', Qty: 1, 'Invoice Count': 1, Financier: 'IDFC FINANCE', 'Loan Amount': 18000, Count: 1, Month: '2026-05-01', GM: 'ANANYA', ASM: 'SURESH' },
  ];
  const finCols = inferColumnTypes(financeRows);
  const finConfig = { metricCol: 'Loan Amount', dimCol: 'Financier', dateCol: 'Month', aggType: 'sum' as const };
  const finRange = { startMonth: '2026-04', endMonth: '2026-05', preset: 'all' as const };

  const finBundle = computeDashboardBundle({
    allRows: financeRows,
    filteredRows: financeRows,
    columns: finCols,
    config: finConfig,
    dateRange: finRange,
  });

  assert.deepEqual(finBundle.kpiMetrics, calculateKPIs(financeRows, financeRows, finConfig, finRange, finCols));
  assert.deepEqual(finBundle.timeSeriesData, aggregateTimeSeries(financeRows, 'Month', 'Loan Amount', 'sum', '2026-04', '2026-05', 'Count'));
  assert.deepEqual(finBundle.topStoresData, aggregateTopStores(financeRows, 'Branch', 'Loan Amount', 10, finCols));
  assert.deepEqual(finBundle.financierShareData, aggregateShareByDimension(financeRows, 'Financier', 'Loan Amount', 8, 'Count', 'value'));
  assert.deepEqual(finBundle.gmShareData, aggregateShareByDimension(financeRows, 'GM', 'Loan Amount', 6, 'Count', 'value'));
  assert.deepEqual(finBundle.asmShareData, aggregateShareByDimension(financeRows, 'ASM', 'Loan Amount', 8, 'Count', 'value'));
  assert.deepEqual(finBundle.categoryCountData, aggregateShareByDimension(financeRows, 'Category', 'Loan Amount', 8, 'Count', 'count'));
  assert.deepEqual(finBundle.brandCountData, aggregateShareByDimension(financeRows, 'Brand', 'Loan Amount', 10, 'Count', 'count'));
});

test('prewarmDatasetCaches warms single-pass bundle for 160,000-row Finance dataset so switch repeats in O(1)', () => {
  const rows = new Array(160_000);
  const months = ['Apr-26', 'May-26', 'Jun-26', 'Jul-26', 'Aug-26', 'Sep-26', 'Oct-26'];
  for (let i = 0; i < 160_000; i++) {
    rows[i] = {
      Branch: `Store-${i % 45}`,
      Financier: i % 2 === 0 ? 'BAJAJ FINANCE' : 'IDFC FINANCE',
      Brand: i % 3 === 0 ? 'OPPO' : 'VIVO',
      Category: i % 4 === 0 ? 'MOBILE & TABLET' : 'HOME APPLIANCES',
      'Loan Amount': 25000,
      Count: i % 5 === 0 ? 0 : 1,
      Qty: 1,
      Month: months[i % months.length],
      GM: `GM-${i % 5}`,
      ASM: `ASM-${i % 12}`,
    };
  }
  const cols = inferColumnTypes(rows);
  const dataset = {
    id: 'gsheet-finance-data',
    name: 'Finance Data',
    description: 'Finance Data test fixture',
    fileName: 'finance.xlsx',
    uploadedAt: '2026-11-21T00:00:00.000Z',
    sheetNames: ['Finance Data'],
    activeSheet: 'Finance Data',
    rows,
    columns: cols,
    defaultMetricCol: 'Loan Amount',
    defaultDimCol: 'Financier',
    defaultDateCol: 'Month',
    reportType: 'finance' as const,
  };

  prewarmDatasetCaches(dataset);

  const warmStart = performance.now();
  const bundle = computeDashboardBundle({
    allRows: rows,
    filteredRows: rows,
    columns: cols,
    config: { metricCol: 'Loan Amount', dimCol: 'Financier', dateCol: 'Month', aggType: 'sum' },
    dateRange: { startMonth: '2026-04', endMonth: '2026-10', preset: 'all' },
  });
  const warmMs = performance.now() - warmStart;

  assert.equal(bundle.kpiMetrics[0].value, 160_000 * 25000);
  assert.equal(bundle.financierShareData.length, 2);
  assert.equal(bundle.brandCountData.length, 2);
  assert.equal(warmMs < 25, true, `Pre-warmed bundle lookup took ${warmMs.toFixed(2)}ms`);
});

