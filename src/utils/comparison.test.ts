import test from 'node:test';
import assert from 'node:assert/strict';
import type { ColumnMeta, DataRow } from '../types/data.ts';
import {
  extractDistinctComparisonOptions,
  reconcilePairSelection,
  computeHeadToHeadComparison,
} from './comparison.ts';

const salesCols: ColumnMeta[] = [
  { name: 'Branch', type: 'category', distinctCount: 3 },
  { name: 'GM', type: 'category', distinctCount: 3 },
  { name: 'ASM', type: 'category', distinctCount: 3 },
  { name: 'Category', type: 'category', distinctCount: 2 },
  { name: 'Brand', type: 'category', distinctCount: 2 },
  { name: 'Amount', type: 'number', distinctCount: 4 },
  { name: 'Qty', type: 'number', distinctCount: 4 },
  { name: 'Discount', type: 'number', distinctCount: 4 },
  { name: 'Month', type: 'date', distinctCount: 2 },
];

const financeCols: ColumnMeta[] = [
  { name: 'Branch', type: 'category', distinctCount: 3 },
  { name: 'GM', type: 'category', distinctCount: 3 },
  { name: 'ASM', type: 'category', distinctCount: 3 },
  { name: 'Financier', type: 'category', distinctCount: 2 },
  { name: 'Loan Amount', type: 'number', distinctCount: 3 },
  { name: 'Count', type: 'number', distinctCount: 3 },
  { name: 'Month', type: 'date', distinctCount: 2 },
];

const salesRows: DataRow[] = [
  {
    Branch: 'Ch-12 (Porur, Chennai)',
    GM: 'Riyas',
    ASM: 'Arun',
    Category: 'Smartphones',
    Brand: 'Apple',
    Amount: 500000,
    Qty: 10,
    Discount: 15000,
    Month: '2026-08',
  },
  {
    Branch: 'Ch-13 (Omr, Chennai)',
    GM: 'RIYAS ',
    ASM: 'arun',
    Category: 'Smartphones',
    Brand: 'Apple',
    Amount: 300000,
    Qty: 6,
    Discount: 9000,
    Month: '2026-09',
  },
  {
    Branch: 'Vpm-01 (Nehruji Road, Vilupuram)',
    GM: 'Silambu',
    ASM: 'Karthik',
    Category: 'Smartphones',
    Brand: 'Vivo',
    Amount: 420000,
    Qty: 14,
    Discount: 21000,
    Month: '2026-08',
  },
  {
    Branch: 'Md-02 (Simakkal, Madurai)',
    GM: 'Mani',
    ASM: 'Suresh',
    Category: 'Tablets',
    Brand: 'Samsung',
    Amount: 180000,
    Qty: 5,
    Discount: 5000,
    Month: '2026-09',
  },
];

const financeRows: DataRow[] = [
  {
    Branch: 'Ch-12 (Porur, Chennai)',
    GM: 'Riyas',
    ASM: 'Arun',
    Financier: 'Bajaj Finance',
    'Loan Amount': 240000,
    Count: 6,
    Month: '2026-08',
  },
  {
    Branch: 'Vpm-01 (Nehruji Road, Vilupuram)',
    GM: 'Silambu',
    ASM: 'Karthik',
    Financier: 'IDFC Finance',
    'Loan Amount': 120000,
    Count: 4,
    Month: '2026-08',
  },
];

test('extractDistinctComparisonOptions deduplicates case-insensitively and merges Sales + Finance metrics', () => {
  const gms = extractDistinctComparisonOptions({
    dimension: 'gm',
    salesRows,
    salesCols,
    financeRows,
    financeCols,
  });

  assert.equal(gms.length, 3);
  assert.equal(gms[0].name, 'Riyas');
  assert.equal(gms[0].salesAmount, 800000);
  assert.equal(gms[0].financeLoanAmount, 240000);
  assert.equal(gms[0].financeCount, 6);
  assert.equal(gms[1].name, 'Silambu');
  assert.equal(gms[2].name, 'Mani');
});

test('reconcilePairSelection strictly prevents duplicate selections like Riyas vs Riyas or Silambu vs Silambu', () => {
  const gms = extractDistinctComparisonOptions({
    dimension: 'gm',
    salesRows,
    salesCols,
    financeRows,
    financeCols,
  });

  const sameCase = reconcilePairSelection(gms, 'Riyas', 'Riyas');
  assert.notEqual(sameCase.entityA.toLowerCase(), sameCase.entityB.toLowerCase());
  assert.equal(sameCase.entityA, 'Riyas');
  assert.equal(sameCase.entityB, 'Silambu');

  const diffCase = reconcilePairSelection(gms, 'Silambu', 'silambu ');
  assert.equal(diffCase.entityA, 'Silambu');
  assert.notEqual(diffCase.entityA.toLowerCase(), diffCase.entityB.toLowerCase());
});

test('computeHeadToHeadComparison identifies leader, trailing entity, difference drivers, and growth plans for both sides', () => {
  const gms = extractDistinctComparisonOptions({
    dimension: 'gm',
    salesRows,
    salesCols,
    financeRows,
    financeCols,
  });

  const cmp = computeHeadToHeadComparison({
    dimension: 'gm',
    entityAName: 'Silambu',
    entityBName: 'Riyas',
    options: gms,
    salesRows,
    salesCols,
    financeRows,
    financeCols,
  });

  assert.ok(cmp);
  assert.equal(cmp.diagnosis.leaderSide, 'B');
  assert.equal(cmp.diagnosis.leaderName, 'Riyas');
  assert.equal(cmp.diagnosis.trailingName, 'Silambu');
  assert.equal(cmp.diagnosis.gapAmount, 380000);
  assert.ok(cmp.diagnosis.whoLeadsText.includes('Riyas has higher sales'));
  assert.ok(cmp.diagnosis.whyDifference.length >= 2);
  assert.ok(cmp.diagnosis.growthForLeader.length >= 1);
  assert.ok(cmp.diagnosis.growthForTrailing.length >= 1);
  assert.equal(cmp.entityB.financeLoginCount, 6);
  assert.equal(cmp.entityA.financeLoginCount, 4);
});

test('mode=finance computes rankings, leader, breakdowns, and monthly trends strictly from Finance Data even when Sales Report disagrees', () => {
  const divergentSales: DataRow[] = [
    {
      Branch: 'Ch-12 (Porur, Chennai)',
      GM: 'Riyas',
      ASM: 'Arun',
      Category: 'Laptops',
      Brand: 'HP',
      Amount: 900000,
      Qty: 18,
      Discount: 10000,
      Month: '2026-08',
    },
    {
      Branch: 'Vpm-01 (Nehruji Road, Vilupuram)',
      GM: 'Silambu',
      ASM: 'Karthik',
      Category: 'Smartphones',
      Brand: 'Vivo',
      Amount: 250000,
      Qty: 10,
      Discount: 5000,
      Month: '2026-08',
    },
    {
      Branch: 'Md-02 (Simakkal, Madurai)',
      GM: 'Mani',
      ASM: 'Suresh',
      Category: 'Tablets',
      Brand: 'Samsung',
      Amount: 180000,
      Qty: 5,
      Discount: 2000,
      Month: '2026-09',
    },
  ];

  const divergentFinanceCols: ColumnMeta[] = [
    ...financeCols,
    { name: 'Category', type: 'category', distinctCount: 2 },
    { name: 'Brand', type: 'category', distinctCount: 2 },
  ];

  const divergentFinance: DataRow[] = [
    {
      Branch: 'Ch-12 (Porur, Chennai)',
      GM: 'Riyas',
      ASM: 'Arun',
      Financier: 'IDFC Finance',
      Category: 'Air Conditioners',
      Brand: 'LG',
      'Loan Amount': 100000,
      Count: 3,
      Month: '2026-08',
    },
    {
      Branch: 'Vpm-01 (Nehruji Road, Vilupuram)',
      GM: 'Silambu',
      ASM: 'Karthik',
      Financier: 'Bajaj Finance',
      Category: 'Smartphones',
      Brand: 'Apple',
      'Loan Amount': 400000,
      Count: 12,
      Month: '2026-09',
    },
  ];

  const finOptions = extractDistinctComparisonOptions({
    dimension: 'gm',
    mode: 'finance',
    salesRows: divergentSales,
    salesCols,
    financeRows: divergentFinance,
    financeCols: divergentFinanceCols,
  });

  // Mani has 0 finance rows, so Finance Mode only lists GMs active in Finance Data, ranked by Loan Amount
  assert.equal(finOptions.length, 2);
  assert.equal(finOptions[0].name, 'Silambu');
  assert.equal(finOptions[0].financeLoanAmount, 400000);
  assert.equal(finOptions[0].financeCount, 12);
  assert.equal(finOptions[1].name, 'Riyas');
  assert.equal(finOptions[1].financeLoanAmount, 100000);
  assert.equal(finOptions[1].financeCount, 3);

  const cmp = computeHeadToHeadComparison({
    dimension: 'gm',
    mode: 'finance',
    entityAName: 'Riyas',
    entityBName: 'Silambu',
    options: finOptions,
    salesRows: divergentSales,
    salesCols,
    financeRows: divergentFinance,
    financeCols: divergentFinanceCols,
  });

  assert.ok(cmp);
  assert.equal(cmp.mode, 'finance');
  // In Sales Report Riyas led 9L vs 2.5L, but in Finance Report Silambu MUST lead 4L (12 counts) vs 1L (3 counts)
  assert.equal(cmp.diagnosis.leaderSide, 'B');
  assert.equal(cmp.diagnosis.leaderName, 'Silambu');
  assert.equal(cmp.diagnosis.trailingName, 'Riyas');
  assert.equal(cmp.diagnosis.gapAmount, 300000);
  assert.equal(cmp.diagnosis.countGap, 9);
  assert.ok(cmp.diagnosis.whoLeadsText.includes('Silambu has higher Finance Loan Amount'));
  assert.ok(cmp.diagnosis.whoLeadsText.includes('12 counts'));

  // Breakdowns must come from Finance Data (Air Conditioners / LG / IDFC Finance for Riyas), not Sales Report (Laptops / HP)
  assert.equal(cmp.entityA.topCategories[0].name, 'Air Conditioners');
  assert.equal(cmp.entityA.topBrands[0].name, 'LG');
  assert.equal(cmp.entityA.topFinanciers[0].name, 'IDFC Finance');
  assert.equal(cmp.entityB.topBrands[0].name, 'Apple');
  assert.equal(cmp.entityB.topFinanciers[0].name, 'Bajaj Finance');
  assert.equal(cmp.monthlyAligned.length, 2);
  assert.equal(cmp.monthlyAligned[1].financeB, 400000);
});

