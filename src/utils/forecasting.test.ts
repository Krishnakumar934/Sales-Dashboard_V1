import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addMonths,
  buildCompactSnapshotForAI,
  buildSalesAnalyticsSnapshot,
  computeLinearForecast,
  matchPromptEntities,
} from './forecasting.ts';
import type { ColumnMeta, TimeSeriesPoint } from '../types/data.ts';

test('addMonths increments calendar months accurately across year boundaries', () => {
  assert.equal(addMonths('2026-09', 1), '2026-10');
  assert.equal(addMonths('2026-10', 3), '2027-01');
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2026-04', 5), '2026-09');
});

test('computeLinearForecast produces realistic upward projections and non-negative bounds', () => {
  const series: TimeSeriesPoint[] = [
    { period: '2026-04', label: 'Apr 2026', value: 100_00_000, count: 100 },
    { period: '2026-05', label: 'May 2026', value: 110_00_000, count: 110 },
    { period: '2026-06', label: 'Jun 2026', value: 120_00_000, count: 120 },
    { period: '2026-07', label: 'Jul 2026', value: 130_00_000, count: 130 },
    { period: '2026-08', label: 'Aug 2026', value: 140_00_000, count: 140 },
    { period: '2026-09', label: 'Sep 2026', value: 150_00_000, count: 150 },
  ];

  const result = computeLinearForecast(series, 3, true);
  assert.equal(result.forecasts.length, 3);
  assert.equal(result.forecasts[0].period, '2026-10');
  assert.equal(result.forecasts[1].period, '2026-11');
  assert.equal(result.forecasts[2].period, '2026-12');
  assert.equal(result.trendDirection, 'up');
  assert.ok(result.forecasts[0].projectedValue > 150_00_000);
  assert.ok(result.forecasts[1].projectedValue > result.forecasts[0].projectedValue);
  assert.ok(result.forecasts[2].projectedValue > result.forecasts[1].projectedValue);
  assert.ok(result.momGrowthPercent !== null && result.momGrowthPercent > 0);
});

test('computeLinearForecast clamps downward series at zero without negative forecasts', () => {
  const series: TimeSeriesPoint[] = [
    { period: '2026-07', label: 'Jul 2026', value: 3000, count: 10 },
    { period: '2026-08', label: 'Aug 2026', value: 1500, count: 5 },
    { period: '2026-09', label: 'Sep 2026', value: 200, count: 1 },
  ];

  const result = computeLinearForecast(series, 3, true);
  assert.equal(result.trendDirection, 'down');
  for (const pt of result.forecasts) {
    assert.ok(pt.projectedValue >= 0);
    assert.ok(pt.lowerBound >= 0);
  }
});

test('buildSalesAnalyticsSnapshot extracts totals, conversion signals, high-discount targets, and compact AI snapshot', () => {
  const columns: ColumnMeta[] = [
    { name: 'Date', type: 'date' },
    { name: 'Branch', type: 'category' },
    { name: 'GM', type: 'category' },
    { name: 'ASM', type: 'category' },
    { name: 'Category', type: 'category' },
    { name: 'Amount', type: 'number' },
    { name: 'Quantity', type: 'number' },
    { name: 'Discount', type: 'number' },
  ];

  const rows = [
    { Date: '2026-04-10', Branch: 'Porur', GM: 'Rajesh', ASM: 'Amit', Category: 'Retail', Amount: 5000000, Quantity: 50, Discount: 250000 },
    { Date: '2026-05-12', Branch: 'OMR', GM: 'Rajesh', ASM: 'Priya', Category: 'MSME', Amount: 7000000, Quantity: 70, Discount: 350000 },
    { Date: '2026-06-15', Branch: 'Porur', GM: 'Rajesh', ASM: 'Amit', Category: 'Retail', Amount: 9000000, Quantity: 90, Discount: 450000 },
  ];

  const snapshot = buildSalesAnalyticsSnapshot({
    datasetName: 'Test Store Sheet',
    dateRangeLabel: 'Apr 2026 – Jun 2026',
    dateRange: { startMonth: '2026-04', endMonth: '2026-06', preset: 'all' },
    categoryFilters: {},
    searchQuery: '',
    filteredRows: rows,
    columns,
    aggConfig: { metricCol: 'Amount', dimCol: 'Branch', dateCol: 'Date', aggType: 'sum' },
    kpiMetrics: [
      { id: 'kpi-amount', label: 'Total Amount', value: 21000000, formattedValue: '₹ 2.10 Cr' },
      { id: 'kpi-quantity', label: 'Total Quantity', value: 210, formattedValue: '210' },
      { id: 'kpi-discount', label: 'Total Discount', value: 1050000, formattedValue: '₹ 10.50 L' },
    ],
    timeSeriesData: [
      { period: '2026-04', label: 'Apr 2026', value: 5000000, count: 1 },
      { period: '2026-05', label: 'May 2026', value: 7000000, count: 1 },
      { period: '2026-06', label: 'Jun 2026', value: 9000000, count: 1 },
    ],
    gmShares: [{ category: 'Rajesh', value: 21000000, percentage: 100, count: 3 }],
    asmShares: [
      { category: 'Amit', value: 14000000, percentage: 66.7, count: 2 },
      { category: 'Priya', value: 7000000, percentage: 33.3, count: 1 },
    ],
  });

  assert.equal(snapshot.totalRows, 3);
  assert.equal(snapshot.formattedTotalValue, '₹ 2.10 Cr');
  assert.equal(snapshot.discountRatePercent, 5);
  assert.equal(snapshot.peakMonth?.label, 'Jun 2026');
  assert.equal(snapshot.lowestMonth?.label, 'Apr 2026');
  assert.equal(snapshot.topEntities[0].name, 'Porur');
  assert.equal(snapshot.topEntities[0].discountRatePercent, 5);
  assert.ok(snapshot.highDiscountEntities.length > 0);
  assert.ok(snapshot.conversionSignals.length > 0);
  assert.equal(snapshot.forecasts.length, 3);
  assert.equal(snapshot.forecasts[0].period, '2026-07');

  const compact = buildCompactSnapshotForAI(snapshot);
  assert.equal(compact.dataset, 'Test Store Sheet');
  assert.equal(compact.totals.sales, '₹ 2.10 Cr');
  assert.equal(compact.forecasts3Mo.length, 3);
});

test('matchPromptEntities resolves short codes like VPM to full mid-rank store names', () => {
  const columns: ColumnMeta[] = [
    { name: 'Date', type: 'date' },
    { name: 'Branch', type: 'category' },
    { name: 'GM', type: 'category' },
    { name: 'ASM', type: 'category' },
    { name: 'Category', type: 'category' },
    { name: 'Amount', type: 'number' },
    { name: 'Quantity', type: 'number' },
    { name: 'Discount', type: 'number' },
  ];

  // Create 15 stores where Vpm-01 sits in the middle (#10) outside top 8 and bottom 5
  const rows = [];
  for (let i = 1; i <= 15; i++) {
    const branchName =
      i === 10 ? 'Vpm-01 (Nehruji Road, Vilupuram)' : `Branch-${String(i).padStart(2, '0')}`;
    const amount = i === 10 ? 550000 : (16 - i) * 200000;
    rows.push({
      Date: '2026-06-15',
      Branch: branchName,
      GM: 'Rajesh',
      ASM: 'Kumar',
      Category: 'Mobiles',
      Amount: amount,
      Quantity: 10,
      Discount: 15000,
    });
  }

  const snapshot = buildSalesAnalyticsSnapshot({
    datasetName: 'Sales Report',
    dateRangeLabel: 'Apr 2026 – Oct 2026',
    dateRange: { startMonth: '2026-04', endMonth: '2026-10', preset: 'all' },
    categoryFilters: {},
    searchQuery: '',
    filteredRows: rows,
    columns,
    aggConfig: { metricCol: 'Amount', dimCol: 'Branch', dateCol: 'Date', aggType: 'sum' },
    kpiMetrics: [
      { id: 'kpi-amount', label: 'Total Amount', value: 24550000, formattedValue: '₹ 2.46 Cr' },
      { id: 'kpi-quantity', label: 'Total Quantity', value: 150, formattedValue: '150' },
      { id: 'kpi-discount', label: 'Total Discount', value: 225000, formattedValue: '₹ 2.25 L' },
    ],
    timeSeriesData: [{ period: '2026-06', label: 'Jun 2026', value: 24550000, count: 15 }],
    gmShares: [{ category: 'Rajesh', value: 24550000, percentage: 100, count: 15 }],
    asmShares: [{ category: 'Kumar', value: 24550000, percentage: 100, count: 15 }],
  });

  const matched = matchPromptEntities('How is VPM store performing this quarter?', snapshot);
  assert.ok(matched.length >= 1);
  assert.equal(matched[0].name, 'Vpm-01 (Nehruji Road, Vilupuram)');
  assert.equal(matched[0].formattedValue, '₹ 5.50 L');

  const compact = buildCompactSnapshotForAI(snapshot, 'Give sales analysis for VPM');
  assert.equal(compact.promptMatchedEntities[0].name, 'Vpm-01 (Nehruji Road, Vilupuram)');
  assert.equal(compact.allBranchesDirectory.length, 15);
});
