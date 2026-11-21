import type {
  AggregationConfig,
  AggregationType,
  ColumnMeta,
  ColumnType,
  DataRow,
  Dataset,
  DateRangeFilter,
  DimensionSlice,
  KPIMetric,
  TimeSeriesPoint,
} from '../types/data.ts';

/**
 * Checks if a value is genuinely numeric (e.g. 1250, "1250", "₹ 1,250.50", "Rs. 50,000", "12.5 Cr", "45 Lakhs").
 * Explicitly rejects alphanumeric codes like "Branch 1", "Branch-01", "GM 4", "B-101", "Zone-A".
 */
export function isNumericValue(val: any): boolean {
  if (val === null || val === undefined || val === '') return false;
  if (typeof val === 'number') return !isNaN(val);

  if (typeof val === 'string') {
    let trimmed = val.trim();
    if (!trimmed) return false;

    // Reject date-like strings or hyphenated codes (e.g. "2026-01-15", "01/02/2026", "Branch-01")
    if (/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/.test(trimmed)) return false;
    if (/^[A-Za-z0-9]+-[A-Za-z0-9]+/.test(trimmed) && !/^-\d/.test(trimmed)) return false;

    // Strip currency prefixes: ₹, Rs., Rs, INR, $, €, £
    trimmed = trimmed.replace(/^(\s*INR|\s*Rs\.?|\s*[\$€£₹¥])\s*/i, '');

    // Strip Indian multipliers: Cr, Crore, Lakh, Lac, L, K
    trimmed = trimmed.replace(/\s*(cr|crores?|lakhs?|lacs?|l|k)\s*$/i, '');
    trimmed = trimmed.trim();

    // Check if alphanumeric characters remain (like in "Branch", "GM", "Zone")
    if (/[a-zA-Z]/.test(trimmed)) {
      return false;
    }

    const numericRegex = /^[-+]?\s*[\d,]+(\.\d+)?\s*%?$/;
    const parenRegex = /^\([\s]*[\d,]+(\.\d+)?\s*\)$/;

    return numericRegex.test(trimmed) || parenRegex.test(trimmed);
  }

  return false;
}

const PLAIN_NUMBER_RE = /^-?\d+(?:\.\d+)?$/;

/**
 * Robustly parses a value into a valid number in Indian numbering system.
 * Handles ₹, Rs, INR, Lakh, Crore, Cr, L, K, and commas.
 * Never turns alphanumeric text with dashes like "Branch-01" into negative numbers.
 */
export function cleanNumber(val: any): number {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') {
    return isNaN(val) ? 0 : val;
  }

  if (typeof val === 'string') {
    let trimmed = val.trim();
    if (!trimmed) return 0;

    // Fast path for plain numeric strings (e.g. "18999", "1250.50", "-500")
    if (PLAIN_NUMBER_RE.test(trimmed)) {
      const parsed = parseFloat(trimmed);
      return isNaN(parsed) ? 0 : parsed;
    }

    // Date-like or hyphenated codes are not numbers
    if (/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/.test(trimmed)) return 0;
    if (/^[A-Za-z0-9]+-[A-Za-z0-9]+/.test(trimmed) && !/^-\d/.test(trimmed)) return 0;

    const isParenNegative = /^\([\s\$€£₹¥INRrs.]*[\d,.]+[\s%]*\)$/i.test(trimmed);
    const isExplicitNegative = /^-\s*[\$€£₹¥INRrs.]?\s*[\d,.]+/i.test(trimmed);
    const isNegative = isParenNegative || isExplicitNegative;

    // Check multipliers for Indian numbering
    let multiplier = 1;
    if (/\s*(cr|crores?)\s*$/i.test(trimmed)) {
      multiplier = 1_00_00_000;
      trimmed = trimmed.replace(/\s*(cr|crores?)\s*$/i, '');
    } else if (/\s*(lakhs?|lacs?|l)\s*$/i.test(trimmed)) {
      multiplier = 1_00_000;
      trimmed = trimmed.replace(/\s*(lakhs?|lacs?|l)\s*$/i, '');
    } else if (/\s*(k)\s*$/i.test(trimmed)) {
      multiplier = 1_000;
      trimmed = trimmed.replace(/\s*(k)\s*$/i, '');
    }

    // Strip currency prefixes
    trimmed = trimmed.replace(/^(\s*INR|\s*Rs\.?|\s*[\$€£₹¥])\s*/i, '');
    trimmed = trimmed.trim();

    // If remaining text still has alphabetic letters (e.g. "Branch", "GM", "Alpha")
    if (/[a-zA-Z]/.test(trimmed)) {
      return 0;
    }

    const digitsAndDot = trimmed.replace(/[^0-9.]/g, '');
    if (!digitsAndDot || digitsAndDot === '.') return 0;

    const parts = digitsAndDot.split('.');
    const sanitized = parts.length > 1 ? `${parts[0]}.${parts.slice(1).join('')}` : parts[0];

    const n = parseFloat(sanitized);
    if (isNaN(n)) return 0;

    const result = (isNegative ? -n : n) * multiplier;
    return result;
  }

  return 0;
}

/**
 * Formats monetary amounts strictly following the tiered Indian numbering system as requested:
 * ("in the crores value is been crores, lacks is been lacks and thousand is been thousands, follow this and make this perfectly"):
 * - Values >= 1 Crore (10,000,000): formatted in Crores (e.g. ₹ 93.00 Cr, ₹ 1.50 Cr)
 * - Values >= 1 Lakh (100,000) and < 1 Crore: formatted in Lakhs (e.g. ₹ 65.77 L, ₹ 4.37 L)
 * - Values >= 1 Thousand (1,000) and < 1 Lakh: formatted in Thousands (e.g. ₹ 55.02 K, ₹ 12.50 K)
 * - Values < 1,000: formatted as raw rupees (e.g. ₹ 850.50, ₹ 0.00)
 */
export function formatIndianCurrency(val: any, includeSymbol = true): string {
  if (val === null || val === undefined) return includeSymbol ? '₹ 0.00' : '0.00';
  const n = typeof val === 'number' ? val : cleanNumber(val);
  if (isNaN(n)) return includeSymbol ? '₹ 0.00' : '0.00';

  const prefix = includeSymbol ? '₹ ' : '';
  const isNegative = n < 0;
  const abs = Math.abs(n);

  if (abs === 0) {
    return `${prefix}0.00`;
  }

  let formatted: string;
  if (abs >= 1_00_00_000) {
    const cr = abs / 1_00_00_000;
    formatted = `${cr.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} Cr`;
  } else if (abs >= 1_00_000) {
    const l = abs / 1_00_000;
    formatted = `${l.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} L`;
  } else if (abs >= 1_000) {
    const k = abs / 1_000;
    formatted = `${k.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} K`;
  } else {
    formatted = abs.toLocaleString('en-IN', {
      minimumFractionDigits: Number.isInteger(abs) ? 0 : 2,
      maximumFractionDigits: 2,
    });
  }

  return isNegative ? `-${prefix}${formatted}` : `${prefix}${formatted}`;
}

/**
 * Compact Indian number formatting alias for compatibility
 */
export function formatNumberCompact(val: any): string {
  return formatIndianCurrency(val, true);
}

/**
 * Indian full format with tiered representation followed by exact rupee breakdown
 * (e.g. ₹ 93.00 Cr (₹ 92,99,71,535.80), ₹ 55.02 K (₹ 55,024.65))
 */
export function formatIndianFull(val: any, includeSymbol = true): string {
  if (val === null || val === undefined) return includeSymbol ? '₹ 0' : '0';
  const n = typeof val === 'number' ? val : cleanNumber(val);
  if (isNaN(n)) return includeSymbol ? '₹ 0' : '0';
  const prefix = includeSymbol ? '₹ ' : '';
  const isNegative = n < 0;
  const abs = Math.abs(n);

  const rawRupees = abs.toLocaleString('en-IN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: Number.isInteger(abs) ? 0 : 2,
  });

  const compact = formatIndianCurrency(abs, false);
  return isNegative
    ? `-${prefix}${compact} (${prefix}${rawRupees})`
    : `${prefix}${compact} (${prefix}${rawRupees})`;
}

/**
 * Formats pure record counts using Indian Numbering System commas (e.g. 1,23,456)
 */
export function formatIndianCount(val: any): string {
  if (val === null || val === undefined) return '0';
  const n = typeof val === 'number' ? val : cleanNumber(val);
  if (isNaN(n)) return '0';
  return Math.round(n).toLocaleString('en-IN');
}

/**
 * Determines whether a metric column represents monetary currency (₹)
 * or pure counts / quantities / rates (no ₹ symbol).
 */
export function isCurrencyMetric(metricCol: string, aggType?: AggregationType): boolean {
  if (aggType === 'count') return false;
  if (!metricCol) return false;
  const lower = metricCol.toLowerCase().trim();

  // Financial / monetary discounts and fees are always currency!
  if (lower.includes('discount') || lower.includes('fee') || lower.includes('price')) {
    return true;
  }

  // Explicit non-currency keywords (using word boundaries to prevent matching 'discount')
  if (
    /\b(count|counts|qty|quantity|volume|units|number of|no of|no\.|score|rating|percent|percentage|ratio|customers?|accounts?|records?|users?|sno|sr no|id|year)\b/i.test(lower) ||
    lower.includes('transaction count') ||
    lower.includes('record count') ||
    lower === 's.no' ||
    lower === 'sno' ||
    lower === 'sr no' ||
    lower === 'id' ||
    lower === 'year'
  ) {
    return false;
  }

  return true;
}

/**
 * Automatically formats a metric value appropriately:
 * with Indian Rupee symbol (₹) for currency amounts,
 * and pure integer formatting for record counts and quantities.
 */
export function formatSmartMetric(val: number, metricCol: string, aggType?: AggregationType): string {
  if (isCurrencyMetric(metricCol, aggType)) {
    return formatIndianCurrency(val, true);
  }
  return formatIndianCount(val);
}

/**
 * Finds the primary amount column in a dataset, strictly prioritizing "Amount"
 * as requested ("in the Metric Value (Value to Calculate), it been primarly on amount").
 */
export function getPrimaryAmountMetric(columns: ColumnMeta[]): string {
  if (!columns || columns.length === 0) return '';

  // 1. Exact match for 'amount' or 'amt'
  const exactAmount = columns.find((c) => {
    if (c.type !== 'number') return false;
    const l = c.name.toLowerCase().trim();
    return l === 'amount' || l === 'amt' || l === 'net amount' || l === 'total amount';
  });
  if (exactAmount) return exactAmount.name;

  // 2. Partial match containing 'amount' or 'amt'
  const partialAmount = columns.find((c) => {
    if (c.type !== 'number') return false;
    const l = c.name.toLowerCase();
    return l.includes('amount') || l.includes('amt');
  });
  if (partialAmount) return partialAmount.name;

  // 3. Known financial currency metrics
  const financialKeywords = [
    'disbursement', 'collection', 'revenue', 'sales', 'target',
    'turnover', 'spend', 'cost', 'profit', 'balance', 'fee', 'price'
  ];
  const financialCol = columns.find((c) => {
    if (c.type !== 'number') return false;
    const l = c.name.toLowerCase();
    return financialKeywords.some((kw) => l.includes(kw));
  });
  if (financialCol) return financialCol.name;

  // 4. Any numeric column that is not an ID, Serial No, or Year
  const nonIdNumeric = columns.find((c) => {
    if (c.type !== 'number') return false;
    const l = c.name.toLowerCase();
    const isExcluded = ['id', 'sno', 's.no', 'sr', 'sl', 'year', 'phone', 'zip', 'pin'].some(
      (kw) => l === kw || l.startsWith(`${kw} `) || l.endsWith(` ${kw}`)
    );
    return !isExcluded;
  });
  if (nonIdNumeric) return nonIdNumeric.name;

  // 5. Fallback to any numeric column
  const anyNumeric = columns.find((c) => c.type === 'number');
  if (anyNumeric) return anyNumeric.name;

  return columns[0]?.name || '';
}

export const findAmountCol = getPrimaryAmountMetric;

/**
 * Finds a dedicated count / quantity volume column (e.g. "Quantity", "Qty", "Units Sold", "Transaction Count", "Count")
 */
export function findQuantityCol(columns: ColumnMeta[]): string {
  if (!columns || columns.length === 0) return '';
  const col = columns.find((c) => {
    if (c.type !== 'number') return false;
    const l = c.name.toLowerCase().trim();
    if (
      l.includes('discount') ||
      l.includes('price') ||
      l.includes('amount') ||
      l.includes('amt') ||
      l.includes('fee') ||
      l.includes('invoice')
    ) {
      return false;
    }
    return (
      l === 'quantity' ||
      l === 'qty' ||
      l === 'total quantity' ||
      l === 'units' ||
      l === 'units sold' ||
      l === 'volume'
    );
  });
  if (col) return col.name;

  const fallback = columns.find((c) => {
    if (c.type !== 'number') return false;
    const l = c.name.toLowerCase().trim();
    if (
      l.includes('discount') ||
      l.includes('price') ||
      l.includes('amount') ||
      l.includes('amt') ||
      l.includes('fee') ||
      l.includes('invoice')
    ) {
      return false;
    }
    return (
      l === 'transaction count' ||
      l === 'count' ||
      /\b(qty|quantity|units|volume|counts?)\b/i.test(l)
    );
  });
  return fallback?.name || '';
}

/**
 * Finds an explicit count column (e.g. "Count", "Finance Count", "Transaction Count")
 * strictly excluding Quantity/Qty and Invoice Count unless no primary Count column exists.
 */
export function findExplicitCountCol(columns: ColumnMeta[]): string | undefined {
  if (!columns || columns.length === 0) return undefined;
  const isMonetary = (l: string) =>
    l.includes('discount') ||
    l.includes('price') ||
    l.includes('amt') ||
    l.includes('amount') ||
    l.includes('fee') ||
    l.includes('margin') ||
    l.includes('cost') ||
    l.includes('sales') ||
    l.includes('revenue') ||
    l.includes('target') ||
    l.includes('collection') ||
    l.includes('disbursement') ||
    l.includes('balance');

  const exact = columns.find((c) => {
    if (c.type !== 'number') return false;
    const l = c.name.toLowerCase().trim();
    if (isMonetary(l)) return false;
    return (
      l === 'count' ||
      l === 'counts' ||
      l === 'finance count' ||
      l === 'loan count' ||
      l === 'transaction count' ||
      l === 'record count' ||
      l === 'item count'
    );
  });
  if (exact) return exact.name;

  const partialNonInvoice = columns.find((c) => {
    if (c.type !== 'number') return false;
    const l = c.name.toLowerCase().trim();
    if (isMonetary(l) || l.includes('invoice')) return false;
    return /\b(counts?|transactions?|no_of_\w+)\b/i.test(l) || l.includes(' count');
  });
  return partialNonInvoice?.name;
}

/**
 * Finds Invoice Count column if present (e.g. "Invoice Count")
 */
export function findInvoiceCountCol(columns: ColumnMeta[]): string {
  if (!columns || columns.length === 0) return '';
  const col = columns.find((c) => {
    if (c.type !== 'number') return false;
    const l = c.name.toLowerCase().trim();
    return l === 'invoice count' || l === 'inv count' || l.includes('invoice count');
  });
  return col?.name || '';
}

/**
 * Finds the Financier column (e.g. "Financier", "Finance Company", "Lender")
 */
export function findFinancierCol(columns: ColumnMeta[]): string {
  if (!columns || columns.length === 0) return '';
  const col = columns.find((c) => {
    const l = c.name.toLowerCase().trim();
    return (
      l === 'financier' ||
      l === 'financer' ||
      l === 'finance' ||
      l === 'finance company' ||
      l === 'lender' ||
      l === 'nbfc' ||
      l.includes('financier') ||
      l.includes('financer')
    );
  });
  return col?.name || '';
}

/**
 * Finds the Brand column (e.g. "Brand", "Make")
 */
export function findBrandCol(columns: ColumnMeta[]): string {
  if (!columns || columns.length === 0) return '';
  const col = columns.find((c) => {
    const l = c.name.toLowerCase().trim();
    return l === 'brand' || l === 'brands' || l.includes('brand');
  });
  return col?.name || '';
}

/**
 * Detects whether a dataset schema represents Finance Data (Loan Amount / Financier + Count)
 */
export function isFinanceDataset(columns?: ColumnMeta[]): boolean {
  if (!columns || columns.length === 0) return false;
  const hasLoanAmt = columns.some((c) => c.name.toLowerCase().includes('loan amount'));
  const hasFinancier = Boolean(findFinancierCol(columns));
  return hasLoanAmt || hasFinancier;
}

/**
 * Finds dedicated discount column (e.g. "Discount", "Total Discount", "Discounts", "Disc")
 */
export function findDiscountCol(columns: ColumnMeta[]): string {
  if (!columns || columns.length === 0) return '';
  const col = columns.find((c) => {
    if (c.type !== 'number') return false;
    const l = c.name.toLowerCase().trim();
    return (
      l === 'discount' ||
      l === 'total discount' ||
      l === 'discounts' ||
      l === 'disc' ||
      l === 'discount amount' ||
      l.includes('discount') ||
      l.includes('disc amount')
    );
  });
  return col?.name || '';
}

/**
 * Finds the GM (General Manager) column
 */
export function findGMCol(columns: ColumnMeta[]): string {
  if (!columns || columns.length === 0) return '';
  const col = columns.find((c) => {
    const l = c.name.toLowerCase().trim();
    return (
      l === 'gm' ||
      l === 'general manager' ||
      l === 'gm name' ||
      l === 'gm_name' ||
      l.startsWith('gm ') ||
      l.endsWith(' gm')
    );
  });
  return col?.name || '';
}

/**
 * Finds the ASM (Area Sales Manager) column
 */
export function findASMCol(columns: ColumnMeta[]): string {
  if (!columns || columns.length === 0) return '';
  const col = columns.find((c) => {
    const l = c.name.toLowerCase().trim();
    return (
      l === 'asm' ||
      l === 'area sales manager' ||
      l === 'asm name' ||
      l === 'asm_name' ||
      l.startsWith('asm ') ||
      l.endsWith(' asm')
    );
  });
  return col?.name || '';
}

/**
 * Finds the Store / Branch column
 */
export function findBranchCol(columns: ColumnMeta[]): string {
  if (!columns || columns.length === 0) return '';
  const col = columns.find((c) => {
    const l = c.name.toLowerCase().trim();
    return (
      l === 'branch' ||
      l === 'store' ||
      l === 'store name' ||
      l === 'branch name' ||
      l === 'location' ||
      l === 'outlet' ||
      l.includes('branch') ||
      l.includes('store')
    );
  });
  return col?.name || '';
}

/**
 * Finds the Product Category column
 */
export function findCategoryCol(columns: ColumnMeta[]): string {
  if (!columns || columns.length === 0) return '';
  const col = columns.find((c) => {
    const l = c.name.toLowerCase().trim();
    return (
      l === 'category' ||
      l === 'cat' ||
      l === 'product category' ||
      l === 'item category' ||
      l.includes('category')
    );
  });
  return col?.name || '';
}

/**
 * Finds a dedicated count / transaction volume column if present (e.g. "Count", "Transaction Count", "Quantity", "Qty").
 * Strictly prioritizes explicit Count columns ahead of Qty/Quantity so Finance Data sums `Count` rather than `Qty`.
 */
export function findDedicatedCountCol(columns: ColumnMeta[]): string | undefined {
  if (!columns || columns.length === 0) return undefined;
  const explicit = findExplicitCountCol(columns);
  if (explicit) return explicit;

  const qtyFallback = columns.find((c) => {
    if (c.type !== 'number') return false;
    const l = c.name.toLowerCase().trim();
    if (
      l.includes('discount') ||
      l.includes('price') ||
      l.includes('amt') ||
      l.includes('amount') ||
      l.includes('fee') ||
      l.includes('margin') ||
      l.includes('cost') ||
      l.includes('sales') ||
      l.includes('revenue') ||
      l.includes('target') ||
      l.includes('collection') ||
      l.includes('disbursement') ||
      l.includes('balance') ||
      l.includes('invoice')
    ) {
      return false;
    }
    return /\b(qty|quantity|volume|units)\b/i.test(l);
  });
  return qtyFallback?.name;
}

const MONTH_NAME_MAP: Record<string, string> = {
  jan: '01', january: '01',
  feb: '02', february: '02',
  mar: '03', march: '03',
  apr: '04', april: '04',
  may: '05',
  jun: '06', june: '06',
  jul: '07', july: '07',
  aug: '08', august: '08',
  sep: '09', sept: '09', september: '09',
  oct: '10', october: '10',
  nov: '11', november: '11',
  dec: '12', december: '12',
};

export type DateOrder = 'DMY' | 'MDY';

/**
 * Inspects a date column across rows to detect whether slash/dash numeric dates
 * follow DD/MM/YYYY ('DMY') or MM/DD/YYYY ('MDY').
 */
export function detectDateOrder(rows: DataRow[], dateCol: string): DateOrder {
  if (!rows || rows.length === 0 || !dateCol) return 'DMY';
  let dmyEvidence = 0;
  let mdyEvidence = 0;
  const maxScan = Math.min(rows.length, 500);

  for (let i = 0; i < maxScan; i++) {
    const raw = rows[i]?.[dateCol];
    if (typeof raw !== 'string') continue;
    const str = raw.trim();
    const m = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:\s|$|T)/);
    if (!m) continue;
    const p1 = parseInt(m[1], 10);
    const p2 = parseInt(m[2], 10);
    if (p1 > 12 && p2 >= 1 && p2 <= 12) dmyEvidence++;
    else if (p2 > 12 && p1 >= 1 && p1 <= 12) mdyEvidence++;
  }

  return mdyEvidence > dmyEvidence ? 'MDY' : 'DMY';
}

/**
 * Infers the most common explicit 4-digit year in a dataset's date column
 * so yearless month labels ("Apr", "Apr - Sep") resolve to the dataset's actual year.
 */
export function inferDatasetDefaultYear(rows: DataRow[], dateCol: string): number {
  const fallbackYear = new Date().getUTCFullYear();
  if (!rows || rows.length === 0 || !dateCol) return fallbackYear;

  const yearCounts = new Map<number, number>();
  const maxScan = Math.min(rows.length, 500);

  for (let i = 0; i < maxScan; i++) {
    const raw = rows[i]?.[dateCol];
    if (raw === null || raw === undefined || raw === '') continue;

    if (raw instanceof Date && !isNaN(raw.getTime())) {
      const y = raw.getUTCFullYear();
      if (y >= 1990 && y <= 2099) {
        yearCounts.set(y, (yearCounts.get(y) || 0) + 1);
      }
      continue;
    }

    const str = String(raw).trim();
    const yrMatch = str.match(/\b(199\d|20\d{2})\b/);
    if (yrMatch) {
      const y = parseInt(yrMatch[1], 10);
      yearCounts.set(y, (yearCounts.get(y) || 0) + 1);
    }
  }

  if (yearCounts.size === 0) return fallbackYear;
  let bestYear = fallbackYear;
  let bestCount = -1;
  for (const [yr, cnt] of yearCounts.entries()) {
    if (cnt > bestCount || (cnt === bestCount && yr > bestYear)) {
      bestCount = cnt;
      bestYear = yr;
    }
  }
  return bestYear;
}

function isValidYear(yr: number): boolean {
  return Number.isFinite(yr) && yr >= 1990 && yr <= 2099;
}

/**
 * Normalizes any date value (string, Excel serial number, or Date) to 'YYYY-MM'
 * Seamlessly handles:
 * - Month spans: e.g. "Apr - Aug", "Apr-Aug", "April - August", "Apr – Aug", "Apr - Aug 2025", "Apr-25 to Aug-25"
 * - Indian/UK DD/MM/YYYY and US MM/DD/YYYY (via column-detected dateOrder)
 * - Text months: Apr-25, Aug-25, 15-Apr-2025, Apr 2025, April 2025, Apr, Aug
 * - ISO dates: YYYY-MM-DD, YYYY-MM
 * - Excel numeric serial dates
 */
export function normalizeToMonthKey(
  val: any,
  defaultYear = 2025,
  dateOrder: DateOrder = 'DMY'
): string | null {
  if (val === null || val === undefined || val === '') return null;

  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    // Guard against floating-point underflow by seconds before UTC midnight (e.g. 23:59:59.999Z)
    const safeDate =
      val.getUTCHours() === 23 && val.getUTCMinutes() >= 55
        ? new Date(val.getTime() + 5 * 60 * 1000)
        : val;
    const year = safeDate.getUTCFullYear();
    if (!isValidYear(year)) return null;
    const month = String(safeDate.getUTCMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  if (typeof val === 'number') {
    if (val > 25000 && val < 70000) {
      // Excel serial date to UTC: Add 12 hours (43200000 ms) so slight rounding never dips into previous day
      const jsDate = new Date(Math.round((val - 25569) * 86400 * 1000) + 43200000);
      if (!isNaN(jsDate.getTime())) {
        const year = jsDate.getUTCFullYear();
        if (!isValidYear(year)) return null;
        const month = String(jsDate.getUTCMonth() + 1).padStart(2, '0');
        return `${year}-${month}`;
      }
    }
    return null;
  }

  const str = String(val).trim();
  if (!str) return null;

  // Handle stringified Excel serial number e.g. "45382" or "46143.5"
  if (/^\d{5}(\.\d+)?$/.test(str)) {
    const num = parseFloat(str);
    if (num > 25000 && num < 70000) {
      const jsDate = new Date(Math.round((num - 25569) * 86400 * 1000) + 43200000);
      if (!isNaN(jsDate.getTime())) {
        const year = jsDate.getUTCFullYear();
        if (!isValidYear(year)) return null;
        const month = String(jsDate.getUTCMonth() + 1).padStart(2, '0');
        return `${year}-${month}`;
      }
    }
  }

  // 0. Month spans e.g. "Apr - Aug", "Apr-Aug", "April - August", "Apr – Aug", "Apr - Aug 2026"
  const spanMatch = str.match(/^([a-zA-Z]+)(?:\s*[-–—/]|(?:\s+to\s+))\s*([a-zA-Z]+)(?:\s+(\d{2,4}))?$/i);
  if (spanMatch) {
    const m1 = MONTH_NAME_MAP[spanMatch[1].toLowerCase()];
    let yr = spanMatch[3] || String(defaultYear);
    if (yr.length === 2) yr = `20${yr}`;
    if (m1 && isValidYear(parseInt(yr, 10))) return `${yr}-${m1}`;
  }

  // 1. ISO format: YYYY-MM or YYYY-MM-DD or YYYY/MM
  const yyyyMm = str.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?(?:\s|T|$)/);
  if (yyyyMm) {
    const yrNum = parseInt(yyyyMm[1], 10);
    const mNum = parseInt(yyyyMm[2], 10);
    if (isValidYear(yrNum) && mNum >= 1 && mNum <= 12) {
      return `${yyyyMm[1]}-${String(mNum).padStart(2, '0')}`;
    }
  }

  // 1b. MM/YYYY or MM-YYYY or M/YYYY or M-YYYY (e.g. 05/2026, 05-2026, 5/2026)
  const mmYyyy = str.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (mmYyyy) {
    const mVal = parseInt(mmYyyy[1], 10);
    const yrNum = parseInt(mmYyyy[2], 10);
    if (isValidYear(yrNum) && mVal >= 1 && mVal <= 12) {
      return `${mmYyyy[2]}-${String(mVal).padStart(2, '0')}`;
    }
  }

  // 2. Month-Year text e.g. "Apr-26", "Apr-2026", "Apr 2026", "August 2026", "May-26"
  const monYear = str.match(/^([a-zA-Z]+)[-/\s]+(\d{2,4})$/);
  if (monYear) {
    const mon = MONTH_NAME_MAP[monYear[1].toLowerCase()];
    let yr = monYear[2];
    if (yr.length === 2) yr = `20${yr}`;
    if (mon && isValidYear(parseInt(yr, 10))) return `${yr}-${mon}`;
  }

  // 2b. Year-Month text e.g. "2026-Apr", "2026 May", "26-May"
  const yearMon = str.match(/^(\d{2,4})[-/\s]+([a-zA-Z]+)$/);
  if (yearMon) {
    let yr = yearMon[1];
    if (yr.length === 2) yr = `20${yr}`;
    const mon = MONTH_NAME_MAP[yearMon[2].toLowerCase()];
    if (mon && isValidYear(parseInt(yr, 10))) return `${yr}-${mon}`;
  }

  // 3. Day-Month-Year with word month e.g. "15-Apr-2026", "01-Aug-26", "15 Apr 2026"
  const dayMonYear = str.match(/^(\d{1,2})[-/\s]+([a-zA-Z]+)[-/\s]+(\d{2,4})(?:\s|$)/);
  if (dayMonYear) {
    const mon = MONTH_NAME_MAP[dayMonYear[2].toLowerCase()];
    let yr = dayMonYear[3];
    if (yr.length === 2) yr = `20${yr}`;
    if (mon && isValidYear(parseInt(yr, 10))) return `${yr}-${mon}`;
  }

  // 3b. Word Month-Day-Year e.g. "Apr 15, 2026", "April 1 2026"
  const monDayYear = str.match(/^([a-zA-Z]+)\s+(\d{1,2}),?\s+(\d{2,4})(?:\s|$)/);
  if (monDayYear) {
    const mon = MONTH_NAME_MAP[monDayYear[1].toLowerCase()];
    let yr = monDayYear[3];
    if (yr.length === 2) yr = `20${yr}`;
    if (mon && isValidYear(parseInt(yr, 10))) return `${yr}-${mon}`;
  }

  // 4. DD/MM/YYYY or MM/DD/YYYY (respecting column-detected dateOrder)
  const dmyMatch = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:\s|T|$)/);
  if (dmyMatch) {
    const p1 = parseInt(dmyMatch[1], 10);
    const p2 = parseInt(dmyMatch[2], 10);
    let yr = dmyMatch[3];
    if (yr.length === 2) yr = `20${yr}`;
    const yrNum = parseInt(yr, 10);

    let month = dateOrder === 'MDY' ? p1 : p2;
    if (p1 > 12 && p2 <= 12) {
      month = p2;
    } else if (p2 > 12 && p1 <= 12) {
      month = p1;
    }
    if (isValidYear(yrNum) && month >= 1 && month <= 12) {
      return `${yr}-${String(month).padStart(2, '0')}`;
    }
  }

  // 5. Month name alone like "Apr", "May", "August", "MAY"
  const singleMon = MONTH_NAME_MAP[str.toLowerCase()];
  if (singleMon && isValidYear(defaultYear)) {
    return `${defaultYear}-${singleMon}`;
  }

  // 6. Strict JS Date fallback ONLY when string has an explicit 4-digit year (prevents "1", "100", "Branch 1" -> 2001/0100!)
  if (/\b(199\d|20\d{2})\b/.test(str) && /[-/,\s]/.test(str)) {
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
      const year = parsed.getUTCFullYear();
      if (isValidYear(year)) {
        const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
        return `${year}-${month}`;
      }
    }
  }

  return null;
}

/**
 * Extracts month range (start and end month keys) from a date cell,
 * seamlessly supporting month ranges like "Apr - Aug" or "Apr-25 to Aug-25"
 */
export function extractMonthRangeFromVal(
  val: any,
  defaultYear = 2025,
  dateOrder: DateOrder = 'DMY'
): { start: string; end: string } | null {
  if (val === null || val === undefined || val === '') return null;
  const str = String(val).trim();

  // Range pattern like "Apr - Aug", "Apr – Aug", "Apr to Aug", "Apr - Aug 2025"
  const spanMatch = str.match(/^([a-zA-Z]+)(?:\s*[-–—/]|(?:\s+to\s+))\s*([a-zA-Z]+)(?:\s+(\d{2,4}))?$/i);
  if (spanMatch) {
    const m1 = MONTH_NAME_MAP[spanMatch[1].toLowerCase()];
    const m2 = MONTH_NAME_MAP[spanMatch[2].toLowerCase()];
    let yr = spanMatch[3] || String(defaultYear);
    if (yr.length === 2) yr = `20${yr}`;
    if (m1 && m2 && isValidYear(parseInt(yr, 10))) {
      const k1 = `${yr}-${m1}`;
      const k2 = `${yr}-${m2}`;
      return k1 <= k2 ? { start: k1, end: k2 } : { start: k2, end: k1 };
    }
  }

  const single = normalizeToMonthKey(val, defaultYear, dateOrder);
  if (single) {
    return { start: single, end: single };
  }

  return null;
}

// WeakMap caches keyed by immutable dataset/filtered row array references
const availableMonthsCache = new WeakMap<DataRow[], Map<string, string[]>>();
const timeSeriesCache = new WeakMap<DataRow[], Map<string, TimeSeriesPoint[]>>();
const topStoresAllCache = new WeakMap<DataRow[], Map<string, DimensionSlice[]>>();
const shareDimensionCache = new WeakMap<DataRow[], Map<string, DimensionSlice[]>>();
const kpiCache = new WeakMap<DataRow[], Map<string, KPIMetric[]>>();

function getRowMapCache<T>(store: WeakMap<DataRow[], Map<string, T>>, rows: DataRow[]): Map<string, T> {
  let inner = store.get(rows);
  if (!inner) {
    inner = new Map<string, T>();
    store.set(rows, inner);
  }
  return inner;
}

/**
 * Extracts all sorted chronological 'YYYY-MM' months across a dataset's date column,
 * automatically detecting MDY vs DMY date order, inferring yearless labels, and expanding month spans.
 */
export function extractAvailableMonths(rows: DataRow[], dateCol: string): string[] {
  if (!rows || rows.length === 0 || !dateCol || dateCol === 'none') return [];

  const rowCache = getRowMapCache(availableMonthsCache, rows);
  const cached = rowCache.get(dateCol);
  if (cached) return cached.slice();

  const dateOrder = detectDateOrder(rows, dateCol);
  const defaultYear = inferDatasetDefaultYear(rows, dateCol);
  const monthSet = new Set<string>();
  const rangeLookup = new Map<any, { start: string; end: string } | null>();

  for (let i = 0; i < rows.length; i++) {
    const rawVal = rows[i]?.[dateCol];
    if (rawVal === null || rawVal === undefined || rawVal === '') continue;
    const cacheKey = rawVal instanceof Date ? rawVal.getTime() : rawVal;
    let range = rangeLookup.get(cacheKey);
    if (range === undefined) {
      range = extractMonthRangeFromVal(rawVal, defaultYear, dateOrder);
      rangeLookup.set(cacheKey, range);
      if (range) {
        monthSet.add(range.start);
        monthSet.add(range.end);
        if (range.start !== range.end) {
          const span = getMonthSpan(range.start, range.end);
          if (span.length <= 24) {
            for (const m of span) monthSet.add(m);
          }
        }
      }
    }
  }

  const sorted = Array.from(monthSet).sort();
  rowCache.set(dateCol, sorted);
  return sorted.slice();
}

/**
 * Formats a 'YYYY-MM' string into human-friendly label like 'Jan 2026'
 */
export function formatMonthLabel(monthKey: string): string {
  if (!monthKey || typeof monthKey !== 'string' || !monthKey.includes('-')) {
    return String(monthKey || '');
  }
  const [yearStr, monthStr] = monthKey.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (month >= 1 && month <= 12) {
    return `${months[month - 1]} ${year}`;
  }
  return monthKey;
}

/**
 * Generates an array of all continuous month keys between start and end (inclusive)
 */
export function getMonthSpan(startMonth: string, endMonth: string): string[] {
  if (!startMonth || !endMonth) return [];
  if (startMonth > endMonth) {
    const temp = startMonth;
    startMonth = endMonth;
    endMonth = temp;
  }
  const results: string[] = [];
  const [startYear, startM] = startMonth.split('-').map(Number);
  const [endYear, endM] = endMonth.split('-').map(Number);

  if (isNaN(startYear) || isNaN(startM) || isNaN(endYear) || isNaN(endM)) {
    return [startMonth];
  }

  let curYear = startYear;
  let curM = startM;

  while (curYear < endYear || (curYear === endYear && curM <= endM)) {
    results.push(`${curYear}-${String(curM).padStart(2, '0')}`);
    curM++;
    if (curM > 12) {
      curM = 1;
      curYear++;
    }
    if (results.length > 360) break;
  }

  return results;
}

/**
 * Calculates previous period month range of equal length
 */
export function getPreviousMonthRange(startMonth: string, endMonth: string): { startMonth: string; endMonth: string } {
  const months = getMonthSpan(startMonth, endMonth);
  const count = months.length;
  if (count === 0) return { startMonth, endMonth };

  const [startYear, startM] = startMonth.split('-').map(Number);
  let prevEndYear = startYear;
  let prevEndM = startM - 1;
  if (prevEndM < 1) {
    prevEndM = 12;
    prevEndYear -= 1;
  }

  const prevEndKey = `${prevEndYear}-${String(prevEndM).padStart(2, '0')}`;
  
  let prevStartYear = prevEndYear;
  let prevStartM = prevEndM - (count - 1);
  while (prevStartM < 1) {
    prevStartM += 12;
    prevStartYear -= 1;
  }
  const prevStartKey = `${prevStartYear}-${String(prevStartM).padStart(2, '0')}`;

  return {
    startMonth: prevStartKey,
    endMonth: prevEndKey,
  };
}

/**
 * Single-pass filter for dates supporting month spans (like Apr - Aug) and specific dates
 */
export function filterRowsByDate(
  rows: DataRow[],
  dateCol: string,
  startMonth: string,
  endMonth: string
): DataRow[] {
  if (!rows || rows.length === 0) return [];
  if (!dateCol || dateCol === 'none' || !startMonth || !endMonth) return rows;

  const dateOrder = detectDateOrder(rows, dateCol);
  const defaultYear = inferDatasetDefaultYear(rows, dateCol);
  const matchCache = new Map<any, boolean>();

  const len = rows.length;
  const filtered: DataRow[] = [];

  for (let i = 0; i < len; i++) {
    const row = rows[i];
    const rawVal = row[dateCol];
    if (rawVal === null || rawVal === undefined || rawVal === '') continue;
    const cacheKey = rawVal instanceof Date ? rawVal.getTime() : rawVal;
    let isMatch = matchCache.get(cacheKey);
    if (isMatch === undefined) {
      const range = extractMonthRangeFromVal(rawVal, defaultYear, dateOrder);
      isMatch = Boolean(range && range.start <= endMonth && range.end >= startMonth);
      matchCache.set(cacheKey, isMatch);
    }
    if (isMatch) {
      filtered.push(row);
    }
  }

  return filtered;
}

/**
 * Filter rows by multi-category selections and search query.
 * Trims values and matches case-insensitively with O(1) Sets to prevent space/casing mismatches.
 */
export function filterRowsByFacetAndSearch(
  rows: DataRow[],
  categoryFilters: Record<string, string[]>,
  searchQuery: string
): DataRow[] {
  if (!rows || rows.length === 0) return [];

  const activeKeys = Object.keys(categoryFilters || {}).filter(
    (k) => categoryFilters[k] && categoryFilters[k].length > 0
  );
  const hasFacets = activeKeys.length > 0;
  const q = searchQuery ? searchQuery.toLowerCase().trim() : '';

  if (!hasFacets && !q) return rows;

  // Pre-normalize filter values: lowercase, trimmed Sets for O(1) matching
  const filterSets: Record<string, Set<string>> = {};
  for (let j = 0; j < activeKeys.length; j++) {
    const col = activeKeys[j];
    filterSets[col] = new Set(
      categoryFilters[col].map((val) => String(val ?? '').trim().toLowerCase())
    );
  }

  const len = rows.length;
  const filtered: DataRow[] = [];

  for (let i = 0; i < len; i++) {
    const row = rows[i];

    if (hasFacets) {
      let match = true;
      for (let j = 0; j < activeKeys.length; j++) {
        const col = activeKeys[j];
        const rawCell = row[col];
        const cellVal = String(rawCell ?? '').trim().toLowerCase();
        if (!filterSets[col].has(cellVal)) {
          match = false;
          break;
        }
      }
      if (!match) continue;
    }

    if (q) {
      let found = false;
      const values = Object.values(row);
      for (let k = 0; k < values.length; k++) {
        const v = values[k];
        if (v !== null && v !== undefined && String(v).toLowerCase().includes(q)) {
          found = true;
          break;
        }
      }
      if (!found) continue;
    }

    filtered.push(row);
  }

  return filtered;
}

/**
 * Computes aggregation of a list of numbers using a direct iterative loop
 */
export function computeAggregate(values: any[], aggType: AggregationType): number {
  if (!values || values.length === 0) return 0;
  const len = values.length;

  let sum = 0;
  let min = Infinity;
  let max = -Infinity;

  for (let i = 0; i < len; i++) {
    const n = cleanNumber(values[i]);
    sum += n;
    if (n < min) min = n;
    if (n > max) max = n;
  }

  switch (aggType) {
    case 'sum':
      return sum;
    case 'avg':
      return len > 0 ? sum / len : 0;
    case 'count':
      return len;
    case 'min':
      return min === Infinity ? 0 : min;
    case 'max':
      return max === -Infinity ? 0 : max;
    default:
      return 0;
  }
}

/**
 * Aggregates data by Month for time-series charts
 */
export function aggregateTimeSeries(
  rows: DataRow[],
  dateCol: string,
  metricCol: string,
  aggType: AggregationType,
  startMonth: string,
  endMonth: string,
  countCol?: string
): TimeSeriesPoint[] {
  if (!rows || rows.length === 0) return [];
  if (!startMonth || !endMonth) return [];

  const cacheKey = `${dateCol}|${metricCol}|${aggType}|${startMonth}|${endMonth}|${countCol || ''}`;
  const rowCache = getRowMapCache(timeSeriesCache, rows);
  const cached = rowCache.get(cacheKey);
  if (cached) return cached.map((pt) => ({ ...pt }));

  const monthSpan = getMonthSpan(startMonth, endMonth);
  if (monthSpan.length === 0) return [];

  interface MonthAccumulator {
    sum: number;
    count: number;
    rowCount: number;
    min: number;
    max: number;
  }

  const dateOrder = detectDateOrder(rows, dateCol);
  const defaultYear = inferDatasetDefaultYear(rows, dateCol);

  const buckets = new Map<string, MonthAccumulator>();
  for (const m of monthSpan) {
    buckets.set(m, { sum: 0, count: 0, rowCount: 0, min: Infinity, max: -Infinity });
  }

  const monthCache = new Map<any, string | null>();
  const useCountCol = Boolean(countCol && countCol !== metricCol);
  const len = rows.length;
  for (let i = 0; i < len; i++) {
    const row = rows[i];
    const rawDate = row[dateCol];
    if (rawDate === null || rawDate === undefined || rawDate === '') continue;
    const dKey = rawDate instanceof Date ? rawDate.getTime() : rawDate;
    let monthKey = monthCache.get(dKey);
    if (monthKey === undefined) {
      monthKey = normalizeToMonthKey(rawDate, defaultYear, dateOrder);
      monthCache.set(dKey, monthKey);
    }
    if (monthKey) {
      const b = buckets.get(monthKey);
      if (b) {
        const val = cleanNumber(row[metricCol]);
        b.sum += val;
        b.rowCount++;
        b.count += useCountCol && countCol ? cleanNumber(row[countCol]) : 1;
        if (val < b.min) b.min = val;
        if (val > b.max) b.max = val;
      }
    }
  }

  const result = monthSpan.map((m) => {
    const b = buckets.get(m)!;
    let val = 0;
    if (b.rowCount > 0) {
      switch (aggType) {
        case 'sum': val = b.sum; break;
        case 'avg': val = b.sum / b.rowCount; break;
        case 'count': val = b.count; break;
        case 'min': val = b.min; break;
        case 'max': val = b.max; break;
      }
    }
    return {
      period: m,
      label: formatMonthLabel(m),
      value: Number(val.toFixed(2)),
      count: Math.round(b.count),
    };
  });

  rowCache.set(cacheKey, result);
  return result.map((pt) => ({ ...pt }));
}

/**
 * Aggregates data by Dimension column using on-the-fly streaming accumulation.
 */
export function aggregateByDimension(
  rows: DataRow[],
  dimCol: string,
  metricCol: string,
  aggType: AggregationType,
  topN = 12,
  countCol?: string
): DimensionSlice[] {
  if (!rows || rows.length === 0 || !dimCol) return [];

  interface DimAccumulator {
    sum: number;
    count: number;
    rowCount: number;
    min: number;
    max: number;
  }

  const groups: Record<string, DimAccumulator> = {};
  const useCountCol = Boolean(countCol && countCol !== metricCol);
  const len = rows.length;

  for (let i = 0; i < len; i++) {
    const row = rows[i];
    const rawCat = row[dimCol];
    const cat = rawCat !== null && rawCat !== undefined && String(rawCat).trim() !== ''
      ? String(rawCat).trim()
      : 'Unspecified';

    if (!groups[cat]) {
      groups[cat] = { sum: 0, count: 0, rowCount: 0, min: Infinity, max: -Infinity };
    }
    const g = groups[cat];
    const val = cleanNumber(row[metricCol]);
    g.sum += val;
    g.rowCount++;
    g.count += useCountCol && countCol ? cleanNumber(row[countCol]) : 1;
    if (val < g.min) g.min = val;
    if (val > g.max) g.max = val;
  }

  const slices: { category: string; value: number; count: number }[] = [];
  let totalSum = 0;
  let totalCount = 0;

  for (const [category, g] of Object.entries(groups)) {
    let value = 0;
    if (g.rowCount > 0) {
      switch (aggType) {
        case 'sum': value = g.sum; break;
        case 'avg': value = g.sum / g.rowCount; break;
        case 'count': value = g.count; break;
        case 'min': value = g.min; break;
        case 'max': value = g.max; break;
      }
    }
    const countVal = Math.round(g.count);
    slices.push({
      category,
      value: Number(value.toFixed(2)),
      count: countVal,
    });
    totalSum += Math.max(0, value);
    totalCount += Math.max(0, countVal);
  }

  slices.sort((a, b) => b.value - a.value);

  let result = slices;
  if (slices.length > topN) {
    const top = slices.slice(0, topN - 1);
    const rest = slices.slice(topN - 1);
    const restValue = rest.reduce((acc, item) => acc + item.value, 0);
    const restCount = rest.reduce((acc, item) => acc + item.count, 0);
    top.push({
      category: 'Other',
      value: Number(restValue.toFixed(2)),
      count: restCount,
    });
    result = top;
  }

  return result.map((slice) => {
    const percentage = totalSum > 0 ? (slice.value / totalSum) * 100 : 0;
    const countPercentage = totalCount > 0 ? (slice.count / totalCount) * 100 : 0;
    return {
      ...slice,
      percentage: Number(percentage.toFixed(1)),
      countPercentage: Number(countPercentage.toFixed(1)),
    };
  });
}

/**
 * Calculates primary KPI summary metrics in a single pass loop using Indian Numbering.
 * Strictly outputs EXACTLY 3 Cards as requested:
 * 1. Total Amount - Amount Column
 * 2. Total Quantity - Quantity Column
 * 3. Total Discount - Discount Column
 */
export function calculateKPIs(
  allRows: DataRow[],
  filteredRows: DataRow[],
  config: AggregationConfig,
  currentRange: DateRangeFilter,
  columns?: ColumnMeta[],
  categoryFilters?: Record<string, string[]>,
  searchQuery?: string
): KPIMetric[] {
  const count = filteredRows ? filteredRows.length : 0;
  const colList = columns || [];
  const isFinance = isFinanceDataset(colList);

  const amountCol = findAmountCol(colList) || config.metricCol || 'Amount';
  const explicitCountCol = findExplicitCountCol(colList) || '';
  const quantityCol = findQuantityCol(colList) || findDedicatedCountCol(colList) || '';
  const discountCol = findDiscountCol(colList) || '';
  const invoiceCountCol = findInvoiceCountCol(colList) || '';
  const canUsePrevPeriod = Boolean(
    currentRange.preset !== 'all' &&
      config.dateCol &&
      currentRange.startMonth &&
      currentRange.endMonth
  );

  const kpiCacheKey =
    count > 0 && (!canUsePrevPeriod || allRows === filteredRows)
      ? `${isFinance ? '1' : '0'}|${amountCol}|${explicitCountCol}|${quantityCol}|${discountCol}|${invoiceCountCol}|${currentRange.preset || ''}|${currentRange.startMonth || ''}|${currentRange.endMonth || ''}|${searchQuery || ''}|${categoryFilters ? JSON.stringify(categoryFilters) : ''}`
      : '';
  if (kpiCacheKey && filteredRows) {
    const rowCache = getRowMapCache(kpiCache, filteredRows);
    const cached = rowCache.get(kpiCacheKey);
    if (cached) return cached.map((k) => ({ ...k }));
  }

  if (isFinance) {
    const financierCol = findFinancierCol(colList);
    const catCol = findCategoryCol(colList);
    const brandCol = findBrandCol(colList);

    if (count === 0) {
      return [
        {
          id: 'kpi-amount',
          label: 'Total Loan Amount',
          value: 0,
          formattedValue: '₹ 0.00',
          subValue: '0 entries',
          isPositiveGood: true,
        },
        {
          id: 'kpi-quantity',
          label: 'Total Count',
          value: 0,
          formattedValue: '0',
          subValue: '0 Qty · 0 Rows',
          isPositiveGood: true,
        },
        {
          id: 'kpi-discount',
          label: 'Avg Loan Size',
          value: 0,
          formattedValue: '₹ 0.00',
          subValue: '0 Financiers · 0 Categories · 0 Brands',
          isPositiveGood: true,
        },
      ];
    }

    let totalLoanAmount = 0;
    let totalFinanceCount = 0;
    let totalQty = 0;
    let totalInvCount = 0;
    const financierSet = new Set<string>();
    const catSet = new Set<string>();
    const brandSet = new Set<string>();

    for (let i = 0; i < count; i++) {
      const row = filteredRows[i];
      totalLoanAmount += cleanNumber(row[amountCol]);

      if (explicitCountCol) {
        totalFinanceCount += cleanNumber(row[explicitCountCol]);
      } else {
        totalFinanceCount += 1;
      }

      if (quantityCol) {
        totalQty += cleanNumber(row[quantityCol]);
      }
      if (invoiceCountCol) {
        totalInvCount += cleanNumber(row[invoiceCountCol]);
      }

      if (financierCol && row[financierCol]) {
        const v = String(row[financierCol]).trim();
        if (v) financierSet.add(v);
      }
      if (catCol && row[catCol]) {
        const v = String(row[catCol]).trim();
        if (v) catSet.add(v);
      }
      if (brandCol && row[brandCol]) {
        const v = String(row[brandCol]).trim();
        if (v) brandSet.add(v);
      }
    }

    let prevLoanAmount: number | undefined;
    let prevFinanceCount: number | undefined;
    let prevAvgLoan: number | undefined;

    const { dateCol } = config;
    if (canUsePrevPeriod && dateCol && currentRange.startMonth && currentRange.endMonth) {
      const prevRange = getPreviousMonthRange(currentRange.startMonth, currentRange.endMonth);
      const dateFilteredPrev = filterRowsByDate(allRows, dateCol, prevRange.startMonth, prevRange.endMonth);
      const prevRows = categoryFilters || searchQuery
        ? filterRowsByFacetAndSearch(dateFilteredPrev, categoryFilters || {}, searchQuery || '')
        : dateFilteredPrev;

      const pCount = prevRows.length;
      if (pCount > 0) {
        let pLoan = 0;
        let pCnt = 0;
        for (let j = 0; j < pCount; j++) {
          const pRow = prevRows[j];
          pLoan += cleanNumber(pRow[amountCol]);
          pCnt += explicitCountCol ? cleanNumber(pRow[explicitCountCol]) : 1;
        }
        prevLoanAmount = pLoan;
        prevFinanceCount = pCnt;
        prevAvgLoan = pCnt > 0 ? pLoan / pCnt : 0;
      }
    }

    const calcDelta = (cur: number, prev: number | undefined): number | undefined => {
      if (prev === undefined || prev === 0) return undefined;
      return Number((((cur - prev) / Math.abs(prev)) * 100).toFixed(1));
    };

    const avgLoan = totalFinanceCount > 0 ? totalLoanAmount / totalFinanceCount : 0;

    const finKpis: KPIMetric[] = [
      {
        id: 'kpi-amount',
        label: 'Total Loan Amount',
        value: totalLoanAmount,
        formattedValue: formatIndianCurrency(totalLoanAmount, true),
        subValue: `${formatIndianCurrency(totalLoanAmount, true)} total financed`,
        previousValue: prevLoanAmount,
        formattedPreviousValue: prevLoanAmount !== undefined ? formatIndianCurrency(prevLoanAmount, true) : undefined,
        deltaPercent: calcDelta(totalLoanAmount, prevLoanAmount),
        isPositiveGood: true,
      },
      {
        id: 'kpi-quantity',
        label: 'Total Count',
        value: totalFinanceCount,
        formattedValue: formatIndianCount(totalFinanceCount),
        subValue: `${formatIndianCount(totalInvCount || count)} Invoices · ${formatIndianCount(totalQty)} Qty`,
        previousValue: prevFinanceCount,
        formattedPreviousValue: prevFinanceCount !== undefined ? formatIndianCount(prevFinanceCount) : undefined,
        deltaPercent: calcDelta(totalFinanceCount, prevFinanceCount),
        isPositiveGood: true,
      },
      {
        id: 'kpi-discount',
        label: 'Avg Loan Size',
        value: avgLoan,
        formattedValue: formatIndianCurrency(avgLoan, true),
        subValue: `${financierSet.size} Financiers · ${catSet.size} Categories · ${brandSet.size} Brands`,
        previousValue: prevAvgLoan,
        formattedPreviousValue: prevAvgLoan !== undefined ? formatIndianCurrency(prevAvgLoan, true) : undefined,
        deltaPercent: calcDelta(avgLoan, prevAvgLoan),
        isPositiveGood: true,
      },
    ];
    if (kpiCacheKey && filteredRows) {
      getRowMapCache(kpiCache, filteredRows).set(kpiCacheKey, finKpis);
    }
    return finKpis.map((k) => ({ ...k }));
  }

  if (count === 0) {
    return [
      {
        id: 'kpi-amount',
        label: 'Total Amount',
        value: 0,
        formattedValue: '₹ 0.00',
        subValue: '0 entries',
        isPositiveGood: true,
      },
      {
        id: 'kpi-quantity',
        label: 'Total Quantity',
        value: 0,
        formattedValue: '0',
        subValue: '0 Spreadsheet Rows',
        isPositiveGood: true,
      },
      {
        id: 'kpi-discount',
        label: 'Total Discount',
        value: 0,
        formattedValue: '₹ 0.00',
        subValue: '0 discounts',
        isPositiveGood: false,
      },
    ];
  }

  let totalAmount = 0;
  let totalQuantity = 0;
  let totalDiscount = 0;

  for (let i = 0; i < count; i++) {
    const row = filteredRows[i];
    totalAmount += cleanNumber(row[amountCol]);

    if (quantityCol) {
      totalQuantity += cleanNumber(row[quantityCol]);
    } else {
      totalQuantity += 1;
    }

    if (discountCol) {
      totalDiscount += cleanNumber(row[discountCol]);
    }
  }

  // Previous period comparison
  let prevTotalAmount: number | undefined;
  let prevTotalQuantity: number | undefined;
  let prevTotalDiscount: number | undefined;

  const { dateCol } = config;
  if (canUsePrevPeriod && dateCol && currentRange.startMonth && currentRange.endMonth) {
    const prevRange = getPreviousMonthRange(currentRange.startMonth, currentRange.endMonth);
    const dateFilteredPrev = filterRowsByDate(allRows, dateCol, prevRange.startMonth, prevRange.endMonth);
    const prevRows = categoryFilters || searchQuery
      ? filterRowsByFacetAndSearch(dateFilteredPrev, categoryFilters || {}, searchQuery || '')
      : dateFilteredPrev;

    const pCount = prevRows.length;
    if (pCount > 0) {
      let pAmount = 0;
      let pQty = 0;
      let pDisc = 0;

      for (let j = 0; j < pCount; j++) {
        const pRow = prevRows[j];
        pAmount += cleanNumber(pRow[amountCol]);
        if (quantityCol) {
          pQty += cleanNumber(pRow[quantityCol]);
        } else {
          pQty += 1;
        }
        if (discountCol) {
          pDisc += cleanNumber(pRow[discountCol]);
        }
      }

      prevTotalAmount = pAmount;
      prevTotalQuantity = pQty;
      prevTotalDiscount = pDisc;
    }
  }

  const calcDelta = (cur: number, prev: number | undefined): number | undefined => {
    if (prev === undefined || prev === 0) return undefined;
    return Number((((cur - prev) / Math.abs(prev)) * 100).toFixed(1));
  };

  const amountDelta = calcDelta(totalAmount, prevTotalAmount);
  const qtyDelta = calcDelta(totalQuantity, prevTotalQuantity);
  const discDelta = calcDelta(totalDiscount, prevTotalDiscount);

  const discountPercent = totalAmount > 0 ? ((totalDiscount / totalAmount) * 100).toFixed(2) : '0.00';

  const salesKpis: KPIMetric[] = [
    {
      id: 'kpi-amount',
      label: 'Total Amount',
      value: totalAmount,
      formattedValue: formatIndianCurrency(totalAmount, true),
      subValue: `${formatIndianCurrency(totalAmount, true)} in aggregate`,
      previousValue: prevTotalAmount,
      formattedPreviousValue: prevTotalAmount !== undefined ? formatIndianCurrency(prevTotalAmount, true) : undefined,
      deltaPercent: amountDelta,
      isPositiveGood: true,
    },
    {
      id: 'kpi-quantity',
      label: 'Total Quantity',
      value: totalQuantity,
      formattedValue: formatIndianCount(totalQuantity),
      subValue: `${count.toLocaleString('en-IN')} Spreadsheet Rows`,
      previousValue: prevTotalQuantity,
      formattedPreviousValue: prevTotalQuantity !== undefined ? formatIndianCount(prevTotalQuantity) : undefined,
      deltaPercent: qtyDelta,
      isPositiveGood: true,
    },
    {
      id: 'kpi-discount',
      label: 'Total Discount',
      value: totalDiscount,
      formattedValue: formatIndianCurrency(totalDiscount, true),
      subValue: totalDiscount > 0 ? `${discountPercent}% of Total Amount` : 'Total Discounts Given',
      previousValue: prevTotalDiscount,
      formattedPreviousValue: prevTotalDiscount !== undefined ? formatIndianCurrency(prevTotalDiscount, true) : undefined,
      deltaPercent: discDelta,
      isPositiveGood: false,
    },
  ];
  if (kpiCacheKey && filteredRows) {
    getRowMapCache(kpiCache, filteredRows).set(kpiCacheKey, salesKpis);
  }
  return salesKpis.map((k) => ({ ...k }));
}

/**
 * Aggregates Top 10 Stores without "Other" grouping dominating #1
 * Returns exactly the actual stores ranked #1 through #10 with real names, values, percentages, and counts.
 * Uses explicit Count column sum when present (e.g. Finance Data `Count`), preserving row counts otherwise.
 */
export function aggregateTopStores(
  rows: DataRow[],
  storeCol: string,
  metricCol: string,
  topN = 10,
  columns?: ColumnMeta[]
): DimensionSlice[] {
  if (!rows || rows.length === 0 || !storeCol) return [];

  const explicitCountCol = columns ? findExplicitCountCol(columns) : undefined;
  const qtyCol = columns ? findQuantityCol(columns) : '';
  const discCol = columns ? findDiscountCol(columns) : '';
  const gmCol = columns ? findGMCol(columns) : '';
  const asmCol = columns ? findASMCol(columns) : '';

  const cacheKey = `${storeCol}|${metricCol}|${explicitCountCol || ''}|${qtyCol}|${discCol}|${gmCol}|${asmCol}`;
  const rowCache = getRowMapCache(topStoresAllCache, rows);
  const cachedAll = rowCache.get(cacheKey);
  if (cachedAll) {
    return cachedAll.slice(0, topN).map((s) => ({ ...s }));
  }

  interface StoreAccumulator {
    sum: number;
    count: number;
    quantity: number;
    discount: number;
    gmSet: Set<string>;
    asmSet: Set<string>;
  }

  const groups = new Map<string, StoreAccumulator>();
  const len = rows.length;

  for (let i = 0; i < len; i++) {
    const row = rows[i];
    const rawStore = row[storeCol];
    if (rawStore === null || rawStore === undefined) continue;
    const store = typeof rawStore === 'string' ? rawStore.trim() : String(rawStore).trim();
    if (!store) continue;
    const lowerStore = store.toLowerCase();
    if (lowerStore === 'other' || lowerStore === 'unspecified') continue;

    let g = groups.get(store);
    if (!g) {
      g = {
        sum: 0,
        count: 0,
        quantity: 0,
        discount: 0,
        gmSet: new Set<string>(),
        asmSet: new Set<string>(),
      };
      groups.set(store, g);
    }
    const val = cleanNumber(row[metricCol]);
    g.sum += val;
    g.count += explicitCountCol ? cleanNumber(row[explicitCountCol]) : 1;

    if (qtyCol && row[qtyCol] !== undefined) {
      g.quantity += cleanNumber(row[qtyCol]);
    } else {
      g.quantity += 1;
    }

    if (discCol && row[discCol] !== undefined) {
      g.discount += cleanNumber(row[discCol]);
    }

    if (gmCol && row[gmCol]) {
      const gmVal = row[gmCol];
      g.gmSet.add(typeof gmVal === 'string' ? gmVal.trim() : String(gmVal).trim());
    }
    if (asmCol && row[asmCol]) {
      const asmVal = row[asmCol];
      g.asmSet.add(typeof asmVal === 'string' ? asmVal.trim() : String(asmVal).trim());
    }
  }

  const items: Array<Omit<DimensionSlice, 'percentage' | 'countPercentage'>> = [];
  let grandTotal = 0;
  let grandCount = 0;

  for (const [category, g] of groups.entries()) {
    const value = Number(g.sum.toFixed(2));
    const cnt = Math.round(g.count);
    grandTotal += Math.max(0, value);
    grandCount += Math.max(0, cnt);
    items.push({
      category,
      value,
      count: cnt,
      quantity: Math.round(g.quantity),
      discount: Number(g.discount.toFixed(2)),
      gm: g.gmSet.size > 0 ? Array.from(g.gmSet).join(', ') : undefined,
      asm: g.asmSet.size > 0 ? Array.from(g.asmSet).join(', ') : undefined,
    });
  }

  items.sort((a, b) => b.value - a.value);

  const allWithPct: DimensionSlice[] = items.map((store) => ({
    ...store,
    percentage: grandTotal > 0 ? Number(((store.value / grandTotal) * 100).toFixed(1)) : 0,
    countPercentage: grandCount > 0 ? Number(((store.count / grandCount) * 100).toFixed(1)) : 0,
  }));

  rowCache.set(cacheKey, allWithPct);
  return allWithPct.slice(0, topN).map((s) => ({ ...s }));
}

/**
 * Aggregates share of metric across a dimension (Financier, GM, ASM, Category, Brand, Region) for donut/breakdown charts
 */
export function aggregateShareByDimension(
  rows: DataRow[],
  dimCol: string,
  metricCol: string,
  topN = 6,
  countCol?: string,
  sortBy: 'value' | 'count' = 'value'
): DimensionSlice[] {
  if (!rows || rows.length === 0 || !dimCol) return [];

  const cacheKey = `${dimCol}|${metricCol}|${topN}|${countCol || ''}|${sortBy}`;
  const rowCache = getRowMapCache(shareDimensionCache, rows);
  const cached = rowCache.get(cacheKey);
  if (cached) return cached.map((s) => ({ ...s }));

  const groups = new Map<string, { sum: number; count: number }>();
  const useCountCol = Boolean(countCol && countCol !== metricCol);
  const len = rows.length;

  for (let i = 0; i < len; i++) {
    const row = rows[i];
    const raw = row[dimCol];
    if (raw === null || raw === undefined) continue;
    const cat = typeof raw === 'string' ? raw.trim() : String(raw).trim();
    if (!cat) continue;

    let g = groups.get(cat);
    if (!g) {
      g = { sum: 0, count: 0 };
      groups.set(cat, g);
    }
    g.sum += cleanNumber(row[metricCol]);
    g.count += useCountCol && countCol ? cleanNumber(row[countCol]) : 1;
  }

  const items: Array<{ category: string; value: number; count: number }> = [];
  for (const [category, g] of groups.entries()) {
    items.push({
      category,
      value: Number(g.sum.toFixed(2)),
      count: Math.round(g.count),
    });
  }

  items.sort((a, b) => (sortBy === 'count' ? b.count - a.count || b.value - a.value : b.value - a.value));

  let result = items;
  if (items.length > topN) {
    const top = items.slice(0, topN);
    const rest = items.slice(topN);
    const restValue = rest.reduce((acc, it) => acc + it.value, 0);
    const restCount = rest.reduce((acc, it) => acc + it.count, 0);
    if (restValue > 0 || restCount > 0) {
      top.push({
        category: 'Other',
        value: Number(restValue.toFixed(2)),
        count: restCount,
      });
    }
    result = top;
  }

  const totalSum = result.reduce((acc, it) => acc + Math.max(0, it.value), 0);
  const totalCount = result.reduce((acc, it) => acc + Math.max(0, it.count), 0);

  const slices: DimensionSlice[] = result.map((slice) => ({
    ...slice,
    percentage: totalSum > 0 ? Number(((slice.value / totalSum) * 100).toFixed(1)) : 0,
    countPercentage: totalCount > 0 ? Number(((slice.count / totalCount) * 100).toFixed(1)) : 0,
  }));

  rowCache.set(cacheKey, slices);
  return slices.map((s) => ({ ...s }));
}

export interface FinancierLoginBreakdownItem {
  name: string;
  count: number;
  amount: number;
  countPercentage: number;
  percentage: number;
  avgLoan: number;
}

export interface EntityBreakdownItem {
  name: string;
  count: number;
  amount: number;
  countPercentage: number;
  percentage: number;
}

export interface CounterpartSalesSummary {
  totalSalesAmount: number;
  totalQuantity: number;
  totalDiscount: number;
  discountPercentage: number;
  rowCount: number;
  financePenetrationPct: number | null;
}

export interface CounterpartFinanceSummary {
  totalLoanAmount: number;
  totalLoginCount: number;
  avgLoanSize: number;
  financeSharePct: number | null;
}

export interface EntityDetailsOptions {
  dimensionLabel?: string;
  excludeNames?: string[];
  counterpartSalesRows?: DataRow[];
  counterpartSalesCols?: ColumnMeta[];
  counterpartFinanceRows?: DataRow[];
  counterpartFinanceCols?: ColumnMeta[];
}

export interface StoreDetailedReport {
  storeName: string;
  dimensionLabel?: string;
  isFinance?: boolean;
  gm: string;
  asm: string;
  zone: string;
  totalAmount: number;
  totalQuantity: number;
  totalDiscount: number;
  recordCount: number;
  avgTicket: number;
  discountPercentage: number;
  salesSummary?: CounterpartSalesSummary;
  financeSummary?: CounterpartFinanceSummary;
  financierBreakdown?: FinancierLoginBreakdownItem[];
  brandBreakdown?: EntityBreakdownItem[];
  topBranchesBreakdown?: EntityBreakdownItem[];
  monthlyBreakdown: {
    monthKey: string;
    monthLabel: string;
    amount: number;
    discount: number;
    quantity: number;
    count: number;
    discountPercent: number;
  }[];
  categoryBreakdown: {
    category: string;
    amount: number;
    percentage: number;
    quantity: number;
    count: number;
    discount: number;
  }[];
  allParameters: {
    name: string;
    sum: number;
    avg: number;
    isCurrency: boolean;
  }[];
}

export type EntityDetailedReport = StoreDetailedReport;

function findCounterpartColumn(sourceCol: string, counterpartCols: ColumnMeta[]): string {
  if (!sourceCol || !counterpartCols || counterpartCols.length === 0) return '';
  const lower = sourceCol.toLowerCase().trim();
  const exact = counterpartCols.find((c) => c.name.toLowerCase().trim() === lower);
  if (exact) return exact.name;

  if (lower === 'gm' || lower.includes('general manager')) return findGMCol(counterpartCols);
  if (lower === 'asm' || lower.includes('area sales')) return findASMCol(counterpartCols);
  if (lower.includes('branch') || lower.includes('store') || lower.includes('outlet')) {
    return findBranchCol(counterpartCols);
  }
  if (lower.includes('category')) return findCategoryCol(counterpartCols);
  if (lower.includes('brand')) return findBrandCol(counterpartCols);
  if (lower.includes('financier') || lower.includes('financer')) return findFinancierCol(counterpartCols);
  return '';
}

function buildFinancierBreakdown(
  rows: DataRow[],
  financierCol: string,
  loanCol: string,
  countCol?: string
): FinancierLoginBreakdownItem[] {
  if (!rows || rows.length === 0 || !financierCol) return [];
  const map: Record<string, { count: number; amount: number }> = {};
  let totalCount = 0;
  let totalAmount = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const raw = r[financierCol];
    const name = raw !== null && raw !== undefined && String(raw).trim() !== '' ? String(raw).trim() : 'Unspecified';
    if (!map[name]) map[name] = { count: 0, amount: 0 };
    const cnt = countCol ? cleanNumber(r[countCol]) : 1;
    const amt = cleanNumber(r[loanCol]);
    map[name].count += cnt;
    map[name].amount += amt;
    totalCount += cnt;
    totalAmount += Math.max(0, amt);
  }

  return Object.entries(map)
    .sort(([, a], [, b]) => b.count - a.count || b.amount - a.amount)
    .map(([name, d]) => {
      const roundedCount = Math.round(d.count);
      const roundedAmt = Number(d.amount.toFixed(2));
      return {
        name,
        count: roundedCount,
        amount: roundedAmt,
        countPercentage: totalCount > 0 ? Number(((d.count / totalCount) * 100).toFixed(1)) : 0,
        percentage: totalAmount > 0 ? Number(((d.amount / totalAmount) * 100).toFixed(1)) : 0,
        avgLoan: d.count > 0 ? Number((d.amount / d.count).toFixed(2)) : 0,
      };
    });
}

/**
 * Calculates a complete entity performance profile (Branch/Store, Financier, GM, ASM, Category, Brand)
 * across monthly trends, category breakdowns, financier login counts, and cross-linked Sales/Finance summaries.
 */
export function calculateStoreDetails(
  rows: DataRow[],
  storeName: string,
  storeCol: string,
  columns: ColumnMeta[],
  options?: EntityDetailsOptions
): StoreDetailedReport | null {
  if (!rows || rows.length === 0 || !storeName) return null;

  const targetName = storeName.toLowerCase().trim();
  const isOtherBucket = targetName === 'other' && Boolean(options?.excludeNames && options.excludeNames.length > 0);
  const excludeSet = isOtherBucket
    ? new Set((options?.excludeNames || []).map((n) => n.toLowerCase().trim()))
    : null;

  const matchesTarget = (val: any): boolean => {
    if (val === null || val === undefined) return false;
    const norm = String(val).toLowerCase().trim();
    if (!norm) return false;
    if (excludeSet) return !excludeSet.has(norm);
    return norm === targetName;
  };

  const storeRows = rows.filter((r) => matchesTarget(r[storeCol]));
  if (storeRows.length === 0) return null;

  const isFinance = isFinanceDataset(columns);
  const amountCol = findAmountCol(columns) || 'Amount';
  const explicitCountCol = findExplicitCountCol(columns);
  const quantityCol = findQuantityCol(columns);
  const discountCol = findDiscountCol(columns);
  const gmCol = findGMCol(columns);
  const asmCol = findASMCol(columns);
  const financierCol = findFinancierCol(columns);
  const brandCol = findBrandCol(columns);
  const branchCol = findBranchCol(columns);
  const dateCol = columns.find((c) => c.type === 'date')?.name || 'Date';
  const categoryCol =
    findCategoryCol(columns) ||
    columns.find((c) => {
      const l = c.name.toLowerCase();
      return l.includes('category') || l.includes('segment') || l.includes('product');
    })?.name ||
    'Category';

  let totalAmount = 0;
  let totalQuantity = 0;
  let totalDiscount = 0;
  let totalCount = 0;
  const gmSet = new Set<string>();
  const asmSet = new Set<string>();
  const zoneSet = new Set<string>();

  const monthlyMap: Record<string, { amount: number; discount: number; quantity: number; count: number }> = {};
  const categoryMap: Record<string, { amount: number; discount: number; quantity: number; count: number }> = {};
  const brandMap: Record<string, { amount: number; count: number }> = {};
  const branchMap: Record<string, { amount: number; count: number }> = {};

  const trackBrands = Boolean(brandCol && brandCol !== storeCol);
  const trackBranches = Boolean(branchCol && branchCol !== storeCol);

  const numCols = columns.filter((c) => c.type === 'number');
  const paramSums: Record<string, number> = {};
  numCols.forEach((c) => {
    paramSums[c.name] = 0;
  });

  const dateOrder = detectDateOrder(storeRows, dateCol);
  const defaultYear = inferDatasetDefaultYear(storeRows, dateCol);
  const monthCache = new Map<any, string>();

  const len = storeRows.length;
  for (let i = 0; i < len; i++) {
    const r = storeRows[i];

    const amt = cleanNumber(r[amountCol]);
    totalAmount += amt;

    const cnt = explicitCountCol ? cleanNumber(r[explicitCountCol]) : 1;
    totalCount += cnt;

    const qty = quantityCol ? cleanNumber(r[quantityCol]) : 1;
    totalQuantity += qty;

    const disc = discountCol ? cleanNumber(r[discountCol]) : 0;
    totalDiscount += disc;

    if (gmCol && r[gmCol]) gmSet.add(String(r[gmCol]).trim());
    if (asmCol && r[asmCol]) asmSet.add(String(r[asmCol]).trim());
    if (r['Zone']) zoneSet.add(String(r['Zone']).trim());
    if (r['Region']) zoneSet.add(String(r['Region']).trim());

    // Monthly breakdown (memoized per distinct date value)
    const rawDate = r[dateCol];
    const dKey = rawDate instanceof Date ? rawDate.getTime() : rawDate;
    let mKey = monthCache.get(dKey);
    if (mKey === undefined) {
      mKey = normalizeToMonthKey(rawDate, defaultYear, dateOrder) || 'Other Period';
      monthCache.set(dKey, mKey);
    }
    if (!monthlyMap[mKey]) {
      monthlyMap[mKey] = { amount: 0, discount: 0, quantity: 0, count: 0 };
    }
    monthlyMap[mKey].amount += amt;
    monthlyMap[mKey].discount += disc;
    monthlyMap[mKey].quantity += qty;
    monthlyMap[mKey].count += cnt;

    // Category breakdown
    const cat = r[categoryCol] ? String(r[categoryCol]).trim() : 'General';
    if (!categoryMap[cat]) {
      categoryMap[cat] = { amount: 0, discount: 0, quantity: 0, count: 0 };
    }
    categoryMap[cat].amount += amt;
    categoryMap[cat].discount += disc;
    categoryMap[cat].quantity += qty;
    categoryMap[cat].count += cnt;

    // Brand breakdown
    if (trackBrands && brandCol) {
      const bName = r[brandCol] ? String(r[brandCol]).trim() : '';
      if (bName) {
        if (!brandMap[bName]) brandMap[bName] = { amount: 0, count: 0 };
        brandMap[bName].amount += amt;
        brandMap[bName].count += cnt;
      }
    }

    // Branch breakdown (useful when inspecting Financier, GM, ASM, Category, or Brand)
    if (trackBranches && branchCol) {
      const brName = r[branchCol] ? String(r[branchCol]).trim() : '';
      if (brName) {
        if (!branchMap[brName]) branchMap[brName] = { amount: 0, count: 0 };
        branchMap[brName].amount += amt;
        branchMap[brName].count += cnt;
      }
    }

    // All numeric parameters
    for (const c of numCols) {
      paramSums[c.name] += cleanNumber(r[c.name]);
    }
  }

  // Build sorted monthly breakdown
  const monthlyBreakdown = Object.entries(monthlyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mKey, data]) => {
      const discPct = data.amount > 0 ? Number(((data.discount / data.amount) * 100).toFixed(2)) : 0;
      return {
        monthKey: mKey,
        monthLabel: formatMonthLabel(mKey),
        amount: Number(data.amount.toFixed(2)),
        discount: Number(data.discount.toFixed(2)),
        quantity: Math.round(data.quantity),
        count: Math.round(data.count),
        discountPercent: discPct,
      };
    });

  // Build sorted category breakdown
  const categoryBreakdown = Object.entries(categoryMap)
    .sort(([, a], [, b]) => (isFinance ? b.count - a.count || b.amount - a.amount : b.amount - a.amount))
    .map(([category, data]) => {
      const pct = totalAmount > 0 ? Number(((data.amount / totalAmount) * 100).toFixed(1)) : 0;
      return {
        category,
        amount: Number(data.amount.toFixed(2)),
        percentage: pct,
        quantity: Math.round(data.quantity),
        count: Math.round(data.count),
        discount: Number(data.discount.toFixed(2)),
      };
    });

  // Build top Brand breakdown (when not inspecting Brand directly)
  const resolvedCount = explicitCountCol ? Math.round(totalCount) : len;
  const brandBreakdown: EntityBreakdownItem[] | undefined = trackBrands
    ? Object.entries(brandMap)
        .sort(([, a], [, b]) => (isFinance ? b.count - a.count || b.amount - a.amount : b.amount - a.amount))
        .slice(0, 12)
        .map(([name, d]) => ({
          name,
          count: Math.round(d.count),
          amount: Number(d.amount.toFixed(2)),
          countPercentage: resolvedCount > 0 ? Number(((d.count / resolvedCount) * 100).toFixed(1)) : 0,
          percentage: totalAmount > 0 ? Number(((d.amount / totalAmount) * 100).toFixed(1)) : 0,
        }))
    : undefined;

  // Build top Branch breakdown (when inspecting Financier, GM, ASM, Brand, or Category)
  const topBranchesBreakdown: EntityBreakdownItem[] | undefined = trackBranches
    ? Object.entries(branchMap)
        .sort(([, a], [, b]) => b.amount - a.amount || b.count - a.count)
        .slice(0, 10)
        .map(([name, d]) => ({
          name,
          count: Math.round(d.count),
          amount: Number(d.amount.toFixed(2)),
          countPercentage: resolvedCount > 0 ? Number(((d.count / resolvedCount) * 100).toFixed(1)) : 0,
          percentage: totalAmount > 0 ? Number(((d.amount / totalAmount) * 100).toFixed(1)) : 0,
        }))
    : undefined;

  // Financier breakdown from active Finance rows (when inspecting Brand, Category, GM, ASM, or Branch)
  let financierBreakdown: FinancierLoginBreakdownItem[] | undefined =
    isFinance && financierCol && financierCol !== storeCol
      ? buildFinancierBreakdown(storeRows, financierCol, amountCol, explicitCountCol)
      : undefined;

  // Cross-linked Sales Summary when viewing Finance Data (GM, ASM, Store, Category, Brand)
  let salesSummary: CounterpartSalesSummary | undefined;
  if (isFinance && options?.counterpartSalesRows?.length && options?.counterpartSalesCols?.length) {
    const matchSalesCol = findCounterpartColumn(storeCol, options.counterpartSalesCols);
    if (matchSalesCol) {
      const sAmtCol = findAmountCol(options.counterpartSalesCols) || 'Amount';
      const sQtyCol = findQuantityCol(options.counterpartSalesCols);
      const sDiscCol = findDiscountCol(options.counterpartSalesCols);
      let sAmt = 0;
      let sQty = 0;
      let sDisc = 0;
      let sRowsCount = 0;
      const sRows = options.counterpartSalesRows;
      for (let i = 0; i < sRows.length; i++) {
        const sr = sRows[i];
        if (!matchesTarget(sr[matchSalesCol])) continue;
        sRowsCount++;
        sAmt += cleanNumber(sr[sAmtCol]);
        sQty += sQtyCol ? cleanNumber(sr[sQtyCol]) : 1;
        sDisc += sDiscCol ? cleanNumber(sr[sDiscCol]) : 0;
      }
      if (sRowsCount > 0) {
        salesSummary = {
          totalSalesAmount: Number(sAmt.toFixed(2)),
          totalQuantity: Math.round(sQty),
          totalDiscount: Number(sDisc.toFixed(2)),
          discountPercentage: sAmt > 0 ? Number(((sDisc / sAmt) * 100).toFixed(2)) : 0,
          rowCount: sRowsCount,
          financePenetrationPct: sAmt > 0 ? Number(((totalAmount / sAmt) * 100).toFixed(1)) : null,
        };
      }
    }
  }

  // Cross-linked Finance Summary & Financier Login Breakdown when viewing Sales Report
  let financeSummary: CounterpartFinanceSummary | undefined;
  if (!isFinance && options?.counterpartFinanceRows?.length && options?.counterpartFinanceCols?.length) {
    const matchFinDimCol = findCounterpartColumn(storeCol, options.counterpartFinanceCols);
    if (matchFinDimCol) {
      const fRows = options.counterpartFinanceRows.filter((fr) => matchesTarget(fr[matchFinDimCol]));
      if (fRows.length > 0) {
        const fAmtCol = findAmountCol(options.counterpartFinanceCols) || 'Loan Amount';
        const fCountCol = findExplicitCountCol(options.counterpartFinanceCols);
        const fFinancierCol = findFinancierCol(options.counterpartFinanceCols);
        let fLoan = 0;
        let fCount = 0;
        for (let i = 0; i < fRows.length; i++) {
          fLoan += cleanNumber(fRows[i][fAmtCol]);
          fCount += fCountCol ? cleanNumber(fRows[i][fCountCol]) : 1;
        }
        const roundedFCount = Math.round(fCount);
        financeSummary = {
          totalLoanAmount: Number(fLoan.toFixed(2)),
          totalLoginCount: roundedFCount,
          avgLoanSize: roundedFCount > 0 ? Number((fLoan / roundedFCount).toFixed(2)) : 0,
          financeSharePct: totalAmount > 0 ? Number(((fLoan / totalAmount) * 100).toFixed(1)) : null,
        };
        if (fFinancierCol && fFinancierCol !== matchFinDimCol) {
          financierBreakdown = buildFinancierBreakdown(fRows, fFinancierCol, fAmtCol, fCountCol);
        }
      }
    }
  }

  // All parameter summaries
  const allParameters = numCols.map((c) => {
    const sum = paramSums[c.name] || 0;
    const avg = len > 0 ? sum / len : 0;
    const isCurrency = isCurrencyMetric(c.name, 'sum');
    return {
      name: c.name,
      sum: Number(sum.toFixed(2)),
      avg: Number(avg.toFixed(2)),
      isCurrency,
    };
  });

  const avgTicket = resolvedCount > 0 ? totalAmount / resolvedCount : 0;
  const discountPercentage = totalAmount > 0 ? Number(((totalDiscount / totalAmount) * 100).toFixed(2)) : 0;

  return {
    storeName,
    dimensionLabel: options?.dimensionLabel || storeCol,
    isFinance,
    gm: Array.from(gmSet).join(', ') || 'N/A',
    asm: Array.from(asmSet).join(', ') || 'N/A',
    zone: Array.from(zoneSet).join(', ') || 'N/A',
    totalAmount: Number(totalAmount.toFixed(2)),
    totalQuantity: Math.round(totalQuantity),
    totalDiscount: Number(totalDiscount.toFixed(2)),
    recordCount: resolvedCount,
    avgTicket: Number(avgTicket.toFixed(2)),
    discountPercentage,
    salesSummary,
    financeSummary,
    financierBreakdown: financierBreakdown && financierBreakdown.length > 0 ? financierBreakdown : undefined,
    brandBreakdown: brandBreakdown && brandBreakdown.length > 0 ? brandBreakdown : undefined,
    topBranchesBreakdown:
      topBranchesBreakdown && topBranchesBreakdown.length > 0 ? topBranchesBreakdown : undefined,
    monthlyBreakdown,
    categoryBreakdown,
    allParameters,
  };
}

const KNOWN_DIMENSION_NAMES = [
  'branch', 'gm', 'asm', 'financier', 'financer', 'brand', 'region', 'manager', 'department', 'rep', 'executive',
  'segment', 'product', 'category', 'status', 'type', 'state', 'city',
  'country', 'zone', 'route', 'carrier', 'channel', 'division', 'team'
];

const KNOWN_METRIC_NAMES = [
  'sales', 'revenue', 'amount', 'loan amount', 'count', 'invoice count', 'target', 'achieved', 'achievement', 'profit',
  'margin', 'cost', 'total', 'volume', 'qty', 'quantity', 'units', 'spend',
  'budget', 'variance', 'turnover', 'collection', 'disbursement', 'balance',
  'price', 'score', 'rating', 'value'
];

/**
 * Infers column schema types from an array of records
 */
export function inferColumnTypes(rows: DataRow[]): ColumnMeta[] {
  if (!rows || rows.length === 0) return [];
  const sample = rows.slice(0, 100);
  const rawColNames = Object.keys(rows[0] || {});

  const colNames = rawColNames.map((name, i) => {
    const trimmed = String(name || '').trim();
    if (!trimmed || trimmed.startsWith('__EMPTY')) {
      return `Column ${i + 1}`;
    }
    return trimmed;
  });

  return colNames.map((name, idx) => {
    const rawKey = rawColNames[idx];
    const lowerName = name.toLowerCase().trim();

    const isKnownDimension = KNOWN_DIMENSION_NAMES.some((d) => lowerName.includes(d));
    const isKnownMetric = KNOWN_METRIC_NAMES.some((m) => lowerName.includes(m));
    const isExplicitNumericName =
      lowerName === 'count' ||
      lowerName === 'qty' ||
      lowerName === 'quantity' ||
      lowerName === 'invoice count' ||
      lowerName === 'loan amount' ||
      lowerName === 'amount';

    let dateHits = 0;
    let numericHits = 0;
    let nonEmptyHits = 0;
    const distinctSet = new Set<string>();
    const colDateOrder = detectDateOrder(sample, rawKey);

    for (const row of sample) {
      const val = row[rawKey];
      if (val === null || val === undefined || val === '') continue;

      nonEmptyHits++;
      distinctSet.add(String(val));

      if (val instanceof Date) {
        dateHits++;
      } else if (typeof val === 'number' && val > 25000 && val < 70000 && (lowerName.includes('date') || lowerName.includes('dt') || lowerName.includes('period'))) {
        dateHits++;
      } else if (isNumericValue(val)) {
        numericHits++;
      } else if (typeof val === 'string') {
        const normMonth = normalizeToMonthKey(val, new Date().getUTCFullYear(), colDateOrder);
        if (
          normMonth &&
          (lowerName.includes('date') ||
            lowerName.includes('month') ||
            lowerName.includes('period') ||
            lowerName.includes('dt') ||
            /^\d{1,4}[-/.]\d{1,2}[-/.]\d{2,4}/.test(val) ||
            /^[a-zA-Z]{3,9}[-/\s]+\d{2,4}$/.test(val))
        ) {
          dateHits++;
        }
      }
    }

    let type: ColumnType = 'text';

    if (
      (nonEmptyHits > 0 && dateHits >= nonEmptyHits * 0.4) ||
      ((lowerName.includes('date') || lowerName.includes('month')) && numericHits === 0)
    ) {
      type = 'date';
    } else if (isExplicitNumericName && (numericHits > 0 || nonEmptyHits === 0)) {
      type = 'number';
    } else if (isKnownDimension) {
      type = 'category';
    } else if (nonEmptyHits > 0 && (numericHits >= nonEmptyHits * 0.6 || (isKnownMetric && numericHits > 0))) {
      type = 'number';
    } else if (distinctSet.size <= 100) {
      type = 'category';
    }

    return {
      name,
      type,
      distinctCount: distinctSet.size,
    };
  });
}

export interface RowHandle {
  readonly key: string;
  readonly length: number;
}

const rowHandleRegistry = new WeakMap<RowHandle, DataRow[]>();
let rowHandleSeq = 0;

export function createRowHandle(rows: DataRow[], label = 'rows'): RowHandle {
  const handle: RowHandle = {
    key: `${label}:${++rowHandleSeq}:${rows.length}`,
    length: rows.length,
  };
  rowHandleRegistry.set(handle, rows);
  return handle;
}

export function resolveRows(rowsOrHandle?: DataRow[] | RowHandle | null): DataRow[] {
  if (!rowsOrHandle) return [];
  if (Array.isArray(rowsOrHandle)) return rowsOrHandle;
  return rowHandleRegistry.get(rowsOrHandle) || [];
}

export interface EntityChartFormItem {
  name: string;
  value: number;
  count: number;
  rowCount: number;
  quantity: number;
  discount: number;
  percentage: number;
  countPercentage: number;
  avgPerCount: number;
}

const entityChartFormCache = new WeakMap<DataRow[], Map<string, EntityChartFormItem[]>>();

export function getOrComputeEntityChartFormItems(params: {
  rows: DataRow[];
  dimensionCol: string;
  metricCol: string;
  dedicatedCountCol: string;
  qtyCol: string;
  discCol: string;
}): EntityChartFormItem[] {
  const { rows, dimensionCol, metricCol, dedicatedCountCol, qtyCol, discCol } = params;
  if (!rows || rows.length === 0 || !dimensionCol) return [];

  const hasDedicatedCount = Boolean(dedicatedCountCol && dedicatedCountCol !== metricCol);
  const cacheKey = `${dimensionCol}|${metricCol}|${hasDedicatedCount ? dedicatedCountCol : ''}|${qtyCol}|${discCol}`;
  const innerCache = getRowMapCache(entityChartFormCache, rows);
  const cached = innerCache.get(cacheKey);
  if (cached) return cached;

  const map = new Map<string, { value: number; count: number; rowCount: number; quantity: number; discount: number }>();
  const len = rows.length;

  for (let i = 0; i < len; i++) {
    const row = rows[i];
    const rawDim = row[dimensionCol];
    const dimStr =
      rawDim !== null && rawDim !== undefined
        ? typeof rawDim === 'string'
          ? rawDim.trim()
          : String(rawDim).trim()
        : '';
    const dimName = dimStr || 'Unspecified';

    let entry = map.get(dimName);
    if (!entry) {
      entry = { value: 0, count: 0, rowCount: 0, quantity: 0, discount: 0 };
      map.set(dimName, entry);
    }

    entry.value += cleanNumber(row[metricCol]);
    entry.rowCount++;

    if (hasDedicatedCount) {
      entry.count += cleanNumber(row[dedicatedCountCol]);
    } else {
      entry.count++;
    }

    if (qtyCol && row[qtyCol] !== undefined) {
      entry.quantity += cleanNumber(row[qtyCol]);
    }
    if (discCol && row[discCol] !== undefined) {
      entry.discount += cleanNumber(row[discCol]);
    }
  }

  let totalSum = 0;
  let totalCount = 0;

  const items: EntityChartFormItem[] = [];
  for (const [name, data] of map.entries()) {
    totalSum += Math.max(0, data.value);
    totalCount += data.count;
    items.push({
      name,
      value: Number(data.value.toFixed(2)),
      count: Math.round(data.count),
      rowCount: data.rowCount,
      quantity: Math.round(data.quantity),
      discount: Number(data.discount.toFixed(2)),
      percentage: 0,
      countPercentage: 0,
      avgPerCount: data.count > 0 ? data.value / data.count : 0,
    });
  }

  for (const item of items) {
    item.percentage = totalSum > 0 ? Number(((item.value / totalSum) * 100).toFixed(1)) : 0;
    item.countPercentage = totalCount > 0 ? Number(((item.count / totalCount) * 100).toFixed(1)) : 0;
  }

  innerCache.set(cacheKey, items);
  return items;
}

export interface TopBarFilterOptionsBundle {
  financierOptions: string[];
  gmOptions: string[];
  asmOptions: string[];
  branchOptions: string[];
  categoryOptions: string[];
  brandOptions: string[];
}

const topBarFilterOptionsCache = new WeakMap<DataRow[], Map<string, TopBarFilterOptionsBundle>>();
const fastOptionCollator = new Intl.Collator('en', { sensitivity: 'base' });
const sortOptionSet = (s: Set<string>) => Array.from(s).sort(fastOptionCollator.compare);

export function getOrComputeTopBarFilterOptions(params: {
  allRows: DataRow[];
  hasFinancier: boolean;
  hasGM: boolean;
  hasASM: boolean;
  hasBranch: boolean;
  hasCategory: boolean;
  hasBrand: boolean;
  financierCol: string;
  gmCol: string;
  asmCol: string;
  branchCol: string;
  categoryCol: string;
  brandCol: string;
  selectedFinancier?: string;
  selectedGM?: string;
  selectedASM?: string;
  selectedBranch?: string;
  selectedCategory?: string;
  selectedBrand?: string;
}): TopBarFilterOptionsBundle {
  const {
    allRows,
    hasFinancier,
    hasGM,
    hasASM,
    hasBranch,
    hasCategory,
    hasBrand,
    financierCol,
    gmCol,
    asmCol,
    branchCol,
    categoryCol,
    brandCol,
    selectedFinancier = 'all',
    selectedGM = 'all',
    selectedASM = 'all',
    selectedBranch = 'all',
    selectedCategory = 'all',
    selectedBrand = 'all',
  } = params;

  const fTarget = hasFinancier && selectedFinancier !== 'all' ? selectedFinancier.trim().toLowerCase() : '';
  const gmTarget = hasGM && selectedGM !== 'all' ? selectedGM.trim().toLowerCase() : '';
  const asmTarget = hasASM && selectedASM !== 'all' ? selectedASM.trim().toLowerCase() : '';
  const brTarget = hasBranch && selectedBranch !== 'all' ? selectedBranch.trim().toLowerCase() : '';
  const catTarget = hasCategory && selectedCategory !== 'all' ? selectedCategory.trim().toLowerCase() : '';
  const brandTarget = hasBrand && selectedBrand !== 'all' ? selectedBrand.trim().toLowerCase() : '';

  const hasNoSelection = !fTarget && !gmTarget && !asmTarget && !brTarget && !catTarget && !brandTarget;
  const schemaCacheKey = `${hasFinancier ? financierCol : ''}|${hasGM ? gmCol : ''}|${hasASM ? asmCol : ''}|${hasBranch ? branchCol : ''}|${hasCategory ? categoryCol : ''}|${hasBrand ? brandCol : ''}`;

  if (hasNoSelection) {
    const cached = getRowMapCache(topBarFilterOptionsCache, allRows).get(schemaCacheKey);
    if (cached) return cached;
  }

  const financierSet = new Set<string>();
  const gmSet = new Set<string>();
  const asmSet = new Set<string>();
  const branchSet = new Set<string>();
  const categorySet = new Set<string>();
  const brandSet = new Set<string>();

  const readFast = (val: unknown): string => {
    if (val === null || val === undefined) return '';
    if (typeof val === 'string') {
      const l = val.length;
      if (l === 0) return '';
      if (val.charCodeAt(0) > 32 && val.charCodeAt(l - 1) > 32) return val;
      return val.trim();
    }
    return String(val).trim();
  };

  const len = allRows.length;
  if (hasNoSelection) {
    // Fast path: zero .toLowerCase() checks across 300k+ cells
    for (let i = 0; i < len; i++) {
      const r = allRows[i];
      if (hasFinancier) {
        const v = readFast(r[financierCol]);
        if (v) financierSet.add(v);
      }
      if (hasGM) {
        const v = readFast(r[gmCol]);
        if (v) gmSet.add(v);
      }
      if (hasASM) {
        const v = readFast(r[asmCol]);
        if (v) asmSet.add(v);
      }
      if (hasBranch) {
        const v = readFast(r[branchCol]);
        if (v) branchSet.add(v);
      }
      if (hasCategory) {
        const v = readFast(r[categoryCol]);
        if (v) categorySet.add(v);
      }
      if (hasBrand) {
        const v = readFast(r[brandCol]);
        if (v) brandSet.add(v);
      }
    }
  } else {
    for (let i = 0; i < len; i++) {
      const r = allRows[i];

      const fStr = hasFinancier ? readFast(r[financierCol]) : '';
      const gmStr = hasGM ? readFast(r[gmCol]) : '';
      const asmStr = hasASM ? readFast(r[asmCol]) : '';

      const matchFin = !fTarget || fStr.toLowerCase() === fTarget;
      const matchGM = !gmTarget || gmStr.toLowerCase() === gmTarget;
      const matchASM = !asmTarget || asmStr.toLowerCase() === asmTarget;

      if (hasFinancier && fStr && matchGM && matchASM) {
        financierSet.add(fStr);
      }
      if (hasGM && gmStr && matchFin) {
        gmSet.add(gmStr);
      }
      if (hasASM && asmStr && matchFin && matchGM) {
        asmSet.add(asmStr);
      }

      if (matchFin && matchGM && matchASM) {
        const brStr = hasBranch ? readFast(r[branchCol]) : '';
        const catStr = hasCategory ? readFast(r[categoryCol]) : '';
        const brandStr = hasBrand ? readFast(r[brandCol]) : '';

        const matchBr = !brTarget || brStr.toLowerCase() === brTarget;
        const matchCat = !catTarget || catStr.toLowerCase() === catTarget;
        const matchBrand = !brandTarget || brandStr.toLowerCase() === brandTarget;

        if (hasBranch && brStr && matchCat && matchBrand) {
          branchSet.add(brStr);
        }
        if (hasCategory && catStr && matchBr) {
          categorySet.add(catStr);
        }
        if (hasBrand && brandStr && matchBr && matchCat) {
          brandSet.add(brandStr);
        }
      }
    }
  }

  const bundle: TopBarFilterOptionsBundle = {
    financierOptions: sortOptionSet(financierSet),
    gmOptions: sortOptionSet(gmSet),
    asmOptions: sortOptionSet(asmSet),
    branchOptions: sortOptionSet(branchSet),
    categoryOptions: sortOptionSet(categorySet),
    brandOptions: sortOptionSet(brandSet),
  };

  if (hasNoSelection) {
    getRowMapCache(topBarFilterOptionsCache, allRows).set(schemaCacheKey, bundle);
  }

  return bundle;
}

export interface DashboardBundle {
  kpiMetrics: KPIMetric[];
  timeSeriesData: TimeSeriesPoint[];
  topStoresData: DimensionSlice[];
  financierShareData: DimensionSlice[];
  gmShareData: DimensionSlice[];
  asmShareData: DimensionSlice[];
  categoryCountData: DimensionSlice[];
  brandCountData: DimensionSlice[];
}

const dashboardBundleCache = new WeakMap<DataRow[], Map<string, DashboardBundle>>();

function finalizeShareMap(
  groups: Map<string, { sum: number; count: number; quantity?: number; discount?: number; rowCount?: number }>,
  topN: number,
  sortBy: 'value' | 'count'
): DimensionSlice[] {
  if (groups.size === 0) return [];
  const items: Array<{ category: string; value: number; count: number }> = [];
  for (const [category, g] of groups.entries()) {
    items.push({
      category,
      value: Number(g.sum.toFixed(2)),
      count: Math.round(g.count),
    });
  }
  items.sort((a, b) =>
    sortBy === 'count' ? b.count - a.count || b.value - a.value : b.value - a.value
  );

  let result = items;
  if (items.length > topN) {
    const top = items.slice(0, topN);
    const rest = items.slice(topN);
    const restValue = rest.reduce((acc, it) => acc + it.value, 0);
    const restCount = rest.reduce((acc, it) => acc + it.count, 0);
    if (restValue > 0 || restCount > 0) {
      top.push({
        category: 'Other',
        value: Number(restValue.toFixed(2)),
        count: restCount,
      });
    }
    result = top;
  }

  const totalSum = result.reduce((acc, it) => acc + Math.max(0, it.value), 0);
  const totalCount = result.reduce((acc, it) => acc + Math.max(0, it.count), 0);

  return result.map((slice) => ({
    ...slice,
    percentage: totalSum > 0 ? Number(((slice.value / totalSum) * 100).toFixed(1)) : 0,
    countPercentage: totalCount > 0 ? Number(((slice.count / totalCount) * 100).toFixed(1)) : 0,
  }));
}

/**
 * Computes KPIs, monthly time-series, Top 10 Stores, and Financier/GM/ASM/Category/Brand breakdowns
 * in a SINGLE linear pass over `filteredRows` and populates all WeakMap caches so downstream callers
 * (including AI snapshot generation, EntityPerformanceChartForm & tab switches) execute in O(1).
 */
export function computeDashboardBundle(params: {
  allRows: DataRow[];
  filteredRows: DataRow[];
  columns: ColumnMeta[];
  config: AggregationConfig;
  dateRange: DateRangeFilter;
  categoryFilters?: Record<string, string[]>;
  searchQuery?: string;
}): DashboardBundle {
  const { allRows, filteredRows, columns, config, dateRange, categoryFilters, searchQuery } = params;
  const colList = columns || [];
  const isFinance = isFinanceDataset(colList);

  const amountCol = findAmountCol(colList) || config.metricCol || 'Amount';
  const metricCol = config.metricCol || amountCol;
  const explicitCountCol = findExplicitCountCol(colList) || '';
  const quantityCol = findQuantityCol(colList) || findDedicatedCountCol(colList) || '';
  const topStoreQtyCol = findQuantityCol(colList);
  const discountCol = findDiscountCol(colList) || '';
  const invoiceCountCol = findInvoiceCountCol(colList) || '';

  const storeCol = findBranchCol(colList) || config.dimCol || 'Branch';
  const financierCol = findFinancierCol(colList);
  const gmCol = findGMCol(colList) || 'GM';
  const asmCol = findASMCol(colList) || 'ASM';
  const catCol = findCategoryCol(colList) || 'Category';
  const brandCol = findBrandCol(colList) || 'Brand';

  const hasFinancier = Boolean(isFinance && financierCol);
  const gmTarget = colList.some((c) => c.name === gmCol) ? gmCol : config.dimCol;
  const asmTarget = colList.some((c) => c.name === asmCol) ? asmCol : 'Zone';
  const hasCat = Boolean(colList.some((c) => c.name === catCol));
  const hasBrand = Boolean(isFinance && colList.some((c) => c.name === brandCol));

  const canUsePrevPeriod = Boolean(
    dateRange.preset !== 'all' && config.dateCol && dateRange.startMonth && dateRange.endMonth
  );

  const bundleKey = `${isFinance ? '1' : '0'}|${metricCol}|${config.dimCol}|${config.dateCol}|${config.aggType}|${dateRange.preset || ''}|${dateRange.startMonth || ''}|${dateRange.endMonth || ''}|${searchQuery || ''}|${categoryFilters ? JSON.stringify(categoryFilters) : ''}`;
  if (filteredRows && (!canUsePrevPeriod || allRows === filteredRows)) {
    const cached = getRowMapCache(dashboardBundleCache, filteredRows).get(bundleKey);
    if (cached) {
      return {
        kpiMetrics: cached.kpiMetrics.map((k) => ({ ...k })),
        timeSeriesData: cached.timeSeriesData.map((t) => ({ ...t })),
        topStoresData: cached.topStoresData.map((s) => ({ ...s })),
        financierShareData: cached.financierShareData.map((s) => ({ ...s })),
        gmShareData: cached.gmShareData.map((s) => ({ ...s })),
        asmShareData: cached.asmShareData.map((s) => ({ ...s })),
        categoryCountData: cached.categoryCountData.map((s) => ({ ...s })),
        brandCountData: cached.brandCountData.map((s) => ({ ...s })),
      };
    }
  }

  const len = filteredRows ? filteredRows.length : 0;
  if (len === 0) {
    return {
      kpiMetrics: calculateKPIs(allRows, filteredRows, config, dateRange, colList, categoryFilters, searchQuery),
      timeSeriesData: [],
      topStoresData: [],
      financierShareData: [],
      gmShareData: [],
      asmShareData: [],
      categoryCountData: [],
      brandCountData: [],
    };
  }

  // Time series setup
  const monthSpan =
    dateRange.startMonth && dateRange.endMonth && config.dateCol
      ? getMonthSpan(dateRange.startMonth, dateRange.endMonth)
      : [];
  const hasTimeSeries = monthSpan.length > 0 && Boolean(config.dateCol);
  const tsBuckets = new Map<
    string,
    { sum: number; count: number; rowCount: number; min: number; max: number }
  >();
  if (hasTimeSeries) {
    for (const m of monthSpan) {
      tsBuckets.set(m, { sum: 0, count: 0, rowCount: 0, min: Infinity, max: -Infinity });
    }
  }
  const dateOrder = hasTimeSeries ? detectDateOrder(filteredRows, config.dateCol) : 'DMY';
  const defaultYear = hasTimeSeries ? inferDatasetDefaultYear(filteredRows, config.dateCol) : 2025;
  const monthCache = new Map<any, string | null>();

  // Top Stores setup
  interface StoreAccumulator {
    sum: number;
    count: number;
    quantity: number;
    discount: number;
    rowCount: number;
    gmSet: Set<string>;
    asmSet: Set<string>;
  }
  const storeGroups = new Map<string, StoreAccumulator>();

  // Share accumulators (Financier tracks qty/discount/rowCount too so ChartForm & Snapshot hit O(1))
  const financierGroups = new Map<
    string,
    { sum: number; count: number; rowCount: number; quantity: number; discount: number }
  >();
  const gmGroups = new Map<string, { sum: number; count: number }>();
  const asmGroups = new Map<string, { sum: number; count: number }>();
  const catGroups = new Map<string, { sum: number; count: number }>();
  const brandGroups = new Map<string, { sum: number; count: number }>();

  // KPI accumulators
  let kpiAmount = 0;
  let kpiExplicitCount = 0;
  let kpiQty = 0;
  let kpiDiscount = 0;
  let kpiInvCount = 0;
  const financierSet = isFinance && financierCol ? new Set<string>() : null;
  const catSet = isFinance && catCol ? new Set<string>() : null;
  const brandSet = isFinance && brandCol ? new Set<string>() : null;

  const sameAmountMetric = amountCol === metricCol;
  const useExplicitCountCol = Boolean(explicitCountCol && explicitCountCol !== metricCol);
  const sameQtyExplicit = Boolean(quantityCol && quantityCol === explicitCountCol);

  const chartDedicatedCountCol = findDedicatedCountCol(colList) || '';
  const hasChartDedicatedCount = Boolean(chartDedicatedCountCol && chartDedicatedCountCol !== metricCol);
  const sameChartExplicit = chartDedicatedCountCol === explicitCountCol;

  const readTrimmed = (raw: any): string => {
    if (raw === null || raw === undefined) return '';
    if (typeof raw === 'string') {
      const l = raw.length;
      if (l === 0) return '';
      if (raw.charCodeAt(0) > 32 && raw.charCodeAt(l - 1) > 32) return raw;
      return raw.trim();
    }
    return String(raw).trim();
  };

  for (let i = 0; i < len; i++) {
    const row = filteredRows[i];

    const metricVal = cleanNumber(row[metricCol]);
    const amtVal = sameAmountMetric ? metricVal : cleanNumber(row[amountCol]);
    const expCountVal = explicitCountCol ? cleanNumber(row[explicitCountCol]) : 1;
    const shareCountVal = useExplicitCountCol ? expCountVal : 1;
    const kpiQtyVal = sameQtyExplicit
      ? expCountVal
      : quantityCol
      ? cleanNumber(row[quantityCol])
      : 1;
    const storeQtyVal =
      topStoreQtyCol && row[topStoreQtyCol] !== undefined
        ? topStoreQtyCol === quantityCol
          ? kpiQtyVal
          : cleanNumber(row[topStoreQtyCol])
        : 1;
    const chartCountVal = hasChartDedicatedCount
      ? sameChartExplicit
        ? expCountVal
        : cleanNumber(row[chartDedicatedCountCol])
      : 1;
    const discVal = discountCol && row[discountCol] !== undefined ? cleanNumber(row[discountCol]) : 0;

    // 1. KPI totals
    kpiAmount += amtVal;
    kpiExplicitCount += expCountVal;
    kpiQty += kpiQtyVal;
    kpiDiscount += discVal;
    if (isFinance && invoiceCountCol) {
      kpiInvCount += cleanNumber(row[invoiceCountCol]);
    }

    // 2. Time series
    if (hasTimeSeries) {
      const rawDate = row[config.dateCol];
      if (rawDate !== null && rawDate !== undefined && rawDate !== '') {
        const dKey = rawDate instanceof Date ? rawDate.getTime() : rawDate;
        let monthKey = monthCache.get(dKey);
        if (monthKey === undefined) {
          monthKey = normalizeToMonthKey(rawDate, defaultYear, dateOrder);
          monthCache.set(dKey, monthKey);
        }
        if (monthKey) {
          const b = tsBuckets.get(monthKey);
          if (b) {
            b.sum += metricVal;
            b.rowCount++;
            b.count += shareCountVal;
            if (metricVal < b.min) b.min = metricVal;
            if (metricVal > b.max) b.max = metricVal;
          }
        }
      }
    }

    const gmStr = gmTarget ? readTrimmed(row[gmTarget]) : '';
    const asmStr = asmTarget ? readTrimmed(row[asmTarget]) : '';

    // 3. Top Stores
    if (storeCol) {
      const store = readTrimmed(row[storeCol]);
      if (store) {
        const lowerStore = store.toLowerCase();
        if (lowerStore !== 'other' && lowerStore !== 'unspecified') {
          let sg = storeGroups.get(store);
          if (!sg) {
            sg = {
              sum: 0,
              count: 0,
              quantity: 0,
              discount: 0,
              rowCount: 0,
              gmSet: new Set<string>(),
              asmSet: new Set<string>(),
            };
            storeGroups.set(store, sg);
          }
          sg.sum += metricVal;
          sg.count += expCountVal;
          sg.quantity += storeQtyVal;
          sg.discount += discVal;
          sg.rowCount++;
          if (gmCol && row[gmCol]) {
            const gVal = gmCol === gmTarget ? gmStr : readTrimmed(row[gmCol]);
            if (gVal) sg.gmSet.add(gVal);
          }
          if (asmCol && row[asmCol]) {
            const aVal = asmCol === asmTarget ? asmStr : readTrimmed(row[asmCol]);
            if (aVal) sg.asmSet.add(aVal);
          }
        }
      }
    }

    // 4. GM & ASM share breakdowns
    if (gmStr) {
      let g = gmGroups.get(gmStr);
      if (!g) {
        g = { sum: 0, count: 0 };
        gmGroups.set(gmStr, g);
      }
      g.sum += metricVal;
      g.count += shareCountVal;
    }

    if (asmStr) {
      let g = asmGroups.get(asmStr);
      if (!g) {
        g = { sum: 0, count: 0 };
        asmGroups.set(asmStr, g);
      }
      g.sum += metricVal;
      g.count += shareCountVal;
    }

    // 5. Category share breakdown (collected for both Sales & Finance so snapshot hits O(1))
    if (hasCat && catCol) {
      const catStr = readTrimmed(row[catCol]);
      if (catStr) {
        catSet?.add(catStr);
        let g = catGroups.get(catStr);
        if (!g) {
          g = { sum: 0, count: 0 };
          catGroups.set(catStr, g);
        }
        g.sum += metricVal;
        g.count += shareCountVal;
      }
    }

    // 6. Finance-specific breakdowns & distinct counters
    if (isFinance) {
      if (hasFinancier && financierCol) {
        const finStr = readTrimmed(row[financierCol]) || 'Unspecified';
        if (finStr !== 'Unspecified') {
          financierSet?.add(finStr);
        }
        let g = financierGroups.get(finStr);
        if (!g) {
          g = { sum: 0, count: 0, rowCount: 0, quantity: 0, discount: 0 };
          financierGroups.set(finStr, g);
        }
        g.sum += metricVal;
        g.count += chartCountVal;
        g.rowCount++;
        if (topStoreQtyCol && row[topStoreQtyCol] !== undefined) g.quantity += storeQtyVal;
        if (discVal) g.discount += discVal;
      }

      if (hasBrand && brandCol) {
        const bStr = readTrimmed(row[brandCol]);
        if (bStr) {
          brandSet?.add(bStr);
          let g = brandGroups.get(bStr);
          if (!g) {
            g = { sum: 0, count: 0 };
            brandGroups.set(bStr, g);
          }
          g.sum += metricVal;
          g.count += shareCountVal;
        }
      }
    }
  }

  // Finalize Time Series & warm cache
  const timeSeriesData: TimeSeriesPoint[] = hasTimeSeries
    ? monthSpan.map((m) => {
        const b = tsBuckets.get(m)!;
        let val = 0;
        if (b.rowCount > 0) {
          switch (config.aggType) {
            case 'sum': val = b.sum; break;
            case 'avg': val = b.sum / b.rowCount; break;
            case 'count': val = b.count; break;
            case 'min': val = b.min; break;
            case 'max': val = b.max; break;
          }
        }
        return {
          period: m,
          label: formatMonthLabel(m),
          value: Number(val.toFixed(2)),
          count: Math.round(b.count),
        };
      })
    : [];

  if (hasTimeSeries) {
    const tsKey = `${config.dateCol}|${metricCol}|${config.aggType}|${dateRange.startMonth}|${dateRange.endMonth}|${explicitCountCol || ''}`;
    getRowMapCache(timeSeriesCache, filteredRows).set(tsKey, timeSeriesData);
  }

  // Finalize Top Stores & warm cache
  const storeItems: Array<Omit<DimensionSlice, 'percentage' | 'countPercentage'>> = [];
  let storeGrandTotal = 0;
  let storeGrandCount = 0;
  for (const [category, g] of storeGroups.entries()) {
    const value = Number(g.sum.toFixed(2));
    const cnt = Math.round(g.count);
    storeGrandTotal += Math.max(0, value);
    storeGrandCount += Math.max(0, cnt);
    storeItems.push({
      category,
      value,
      count: cnt,
      quantity: Math.round(g.quantity),
      discount: Number(g.discount.toFixed(2)),
      gm: g.gmSet.size > 0 ? Array.from(g.gmSet).join(', ') : undefined,
      asm: g.asmSet.size > 0 ? Array.from(g.asmSet).join(', ') : undefined,
    });
  }
  storeItems.sort((a, b) => b.value - a.value);
  const allStoresWithPct: DimensionSlice[] = storeItems.map((store) => ({
    ...store,
    percentage: storeGrandTotal > 0 ? Number(((store.value / storeGrandTotal) * 100).toFixed(1)) : 0,
    countPercentage: storeGrandCount > 0 ? Number(((store.count / storeGrandCount) * 100).toFixed(1)) : 0,
  }));

  if (storeCol) {
    const storeCacheKey = `${storeCol}|${metricCol}|${explicitCountCol || ''}|${topStoreQtyCol}|${discountCol}|${findGMCol(colList)}|${findASMCol(colList)}`;
    getRowMapCache(topStoresAllCache, filteredRows).set(storeCacheKey, allStoresWithPct);
  }
  const topStoresData = allStoresWithPct.slice(0, 10);

  // Also warm topStoresAllCache & entityChartFormCache for Financier (when Finance Data)
  if (hasFinancier && financierCol) {
    const finSliceItems: Array<Omit<DimensionSlice, 'percentage' | 'countPercentage'>> = [];
    const finFormItems: EntityChartFormItem[] = [];
    let finTotal = 0;
    let finCount = 0;
    for (const [name, g] of financierGroups.entries()) {
      const value = Number(g.sum.toFixed(2));
      const cnt = Math.round(g.count);
      finTotal += Math.max(0, value);
      finCount += Math.max(0, cnt);
      finFormItems.push({
        name,
        value,
        count: cnt,
        rowCount: g.rowCount,
        quantity: Math.round(g.quantity),
        discount: Number(g.discount.toFixed(2)),
        percentage: 0,
        countPercentage: 0,
        avgPerCount: cnt > 0 ? value / cnt : 0,
      });
      if (name !== 'Unspecified' && name.toLowerCase() !== 'other') {
        finSliceItems.push({
          category: name,
          value,
          count: cnt,
          quantity: Math.round(g.quantity),
          discount: Number(g.discount.toFixed(2)),
        });
      }
    }
    for (const it of finFormItems) {
      it.percentage = finTotal > 0 ? Number(((it.value / finTotal) * 100).toFixed(1)) : 0;
      it.countPercentage = finCount > 0 ? Number(((it.count / finCount) * 100).toFixed(1)) : 0;
    }
    const chartCacheKey = `${financierCol}|${metricCol}|${hasChartDedicatedCount ? chartDedicatedCountCol : ''}|${topStoreQtyCol}|${discountCol}`;
    getRowMapCache(entityChartFormCache, filteredRows).set(chartCacheKey, finFormItems);

    finSliceItems.sort((a, b) => b.value - a.value);
    const finSlicesPct: DimensionSlice[] = finSliceItems.map((s) => ({
      ...s,
      percentage: finTotal > 0 ? Number(((s.value / finTotal) * 100).toFixed(1)) : 0,
      countPercentage: finCount > 0 ? Number(((s.count / finCount) * 100).toFixed(1)) : 0,
    }));
    const finStoreCacheKey = `${financierCol}|${metricCol}|${explicitCountCol || ''}|${topStoreQtyCol}|${discountCol}|${findGMCol(colList)}|${findASMCol(colList)}`;
    getRowMapCache(topStoresAllCache, filteredRows).set(finStoreCacheKey, finSlicesPct);
  }

  // Also warm entityChartFormCache for Store / Branch when storeCol is active
  if (storeCol && storeGroups.size > 0 && !hasChartDedicatedCount) {
    const storeFormItems: EntityChartFormItem[] = [];
    let sTot = 0;
    let sCnt = 0;
    for (const [name, g] of storeGroups.entries()) {
      const value = Number(g.sum.toFixed(2));
      const cnt = g.rowCount;
      sTot += Math.max(0, value);
      sCnt += cnt;
      storeFormItems.push({
        name,
        value,
        count: cnt,
        rowCount: g.rowCount,
        quantity: Math.round(g.quantity),
        discount: Number(g.discount.toFixed(2)),
        percentage: 0,
        countPercentage: 0,
        avgPerCount: cnt > 0 ? value / cnt : 0,
      });
    }
    for (const it of storeFormItems) {
      it.percentage = sTot > 0 ? Number(((it.value / sTot) * 100).toFixed(1)) : 0;
      it.countPercentage = sCnt > 0 ? Number(((it.count / sCnt) * 100).toFixed(1)) : 0;
    }
    const storeFormKey = `${storeCol}|${metricCol}||${topStoreQtyCol}|${discountCol}`;
    getRowMapCache(entityChartFormCache, filteredRows).set(storeFormKey, storeFormItems);
  }

  // Finalize Dimension Shares & warm shareDimensionCache (strip Unspecified from Financier shares)
  const shareCache = getRowMapCache(shareDimensionCache, filteredRows);
  let financierShareData: DimensionSlice[] = [];
  if (hasFinancier) {
    const cleanFinGroups = new Map(financierGroups);
    cleanFinGroups.delete('Unspecified');
    financierShareData = finalizeShareMap(cleanFinGroups, 8, 'value');
    if (financierCol) {
      shareCache.set(`${financierCol}|${metricCol}|8|${explicitCountCol || ''}|value`, financierShareData);
    }
  }
  const gmShareData = finalizeShareMap(gmGroups, 6, 'value');
  if (gmTarget) {
    shareCache.set(`${gmTarget}|${metricCol}|6|${explicitCountCol || ''}|value`, gmShareData);
  }
  const asmShareData = finalizeShareMap(asmGroups, 8, 'value');
  if (asmTarget) {
    shareCache.set(`${asmTarget}|${metricCol}|8|${explicitCountCol || ''}|value`, asmShareData);
  }
  const categoryCountData = hasCat && isFinance ? finalizeShareMap(catGroups, 8, 'count') : [];
  if (hasCat && catCol) {
    if (isFinance) {
      shareCache.set(`${catCol}|${metricCol}|8|${explicitCountCol || ''}|count`, categoryCountData);
    } else {
      shareCache.set(
        `${catCol}|${metricCol}|8|${explicitCountCol || ''}|value`,
        finalizeShareMap(catGroups, 8, 'value')
      );
    }
  }
  const brandCountData = hasBrand ? finalizeShareMap(brandGroups, 10, 'count') : [];
  if (hasBrand && brandCol) {
    shareCache.set(`${brandCol}|${metricCol}|10|${explicitCountCol || ''}|count`, brandCountData);
  }

  // Finalize KPIs (including optional previous period comparison when preset !== 'all')
  const calcDelta = (cur: number, prev: number | undefined): number | undefined => {
    if (prev === undefined || prev === 0) return undefined;
    return Number((((cur - prev) / Math.abs(prev)) * 100).toFixed(1));
  };

  let kpiMetrics: KPIMetric[];
  if (isFinance) {
    let prevLoanAmount: number | undefined;
    let prevFinanceCount: number | undefined;
    let prevAvgLoan: number | undefined;

    if (canUsePrevPeriod && config.dateCol && dateRange.startMonth && dateRange.endMonth) {
      const prevRange = getPreviousMonthRange(dateRange.startMonth, dateRange.endMonth);
      const dateFilteredPrev = filterRowsByDate(allRows, config.dateCol, prevRange.startMonth, prevRange.endMonth);
      const prevRows = categoryFilters || searchQuery
        ? filterRowsByFacetAndSearch(dateFilteredPrev, categoryFilters || {}, searchQuery || '')
        : dateFilteredPrev;

      const pCount = prevRows.length;
      if (pCount > 0) {
        let pLoan = 0;
        let pCnt = 0;
        for (let j = 0; j < pCount; j++) {
          const pRow = prevRows[j];
          pLoan += cleanNumber(pRow[amountCol]);
          pCnt += explicitCountCol ? cleanNumber(pRow[explicitCountCol]) : 1;
        }
        prevLoanAmount = pLoan;
        prevFinanceCount = pCnt;
        prevAvgLoan = pCnt > 0 ? pLoan / pCnt : 0;
      }
    }

    const avgLoan = kpiExplicitCount > 0 ? kpiAmount / kpiExplicitCount : 0;
    kpiMetrics = [
      {
        id: 'kpi-amount',
        label: 'Total Loan Amount',
        value: kpiAmount,
        formattedValue: formatIndianCurrency(kpiAmount, true),
        subValue: `${formatIndianCurrency(kpiAmount, true)} total financed`,
        previousValue: prevLoanAmount,
        formattedPreviousValue: prevLoanAmount !== undefined ? formatIndianCurrency(prevLoanAmount, true) : undefined,
        deltaPercent: calcDelta(kpiAmount, prevLoanAmount),
        isPositiveGood: true,
      },
      {
        id: 'kpi-quantity',
        label: 'Total Count',
        value: kpiExplicitCount,
        formattedValue: formatIndianCount(kpiExplicitCount),
        subValue: `${formatIndianCount(kpiInvCount || len)} Invoices · ${formatIndianCount(kpiQty)} Qty`,
        previousValue: prevFinanceCount,
        formattedPreviousValue: prevFinanceCount !== undefined ? formatIndianCount(prevFinanceCount) : undefined,
        deltaPercent: calcDelta(kpiExplicitCount, prevFinanceCount),
        isPositiveGood: true,
      },
      {
        id: 'kpi-discount',
        label: 'Avg Loan Size',
        value: avgLoan,
        formattedValue: formatIndianCurrency(avgLoan, true),
        subValue: `${financierSet?.size || 0} Financiers · ${catSet?.size || 0} Categories · ${brandSet?.size || 0} Brands`,
        previousValue: prevAvgLoan,
        formattedPreviousValue: prevAvgLoan !== undefined ? formatIndianCurrency(prevAvgLoan, true) : undefined,
        deltaPercent: calcDelta(avgLoan, prevAvgLoan),
        isPositiveGood: true,
      },
    ];
  } else {
    let prevTotalAmount: number | undefined;
    let prevTotalQuantity: number | undefined;
    let prevTotalDiscount: number | undefined;

    if (canUsePrevPeriod && config.dateCol && dateRange.startMonth && dateRange.endMonth) {
      const prevRange = getPreviousMonthRange(dateRange.startMonth, dateRange.endMonth);
      const dateFilteredPrev = filterRowsByDate(allRows, config.dateCol, prevRange.startMonth, prevRange.endMonth);
      const prevRows = categoryFilters || searchQuery
        ? filterRowsByFacetAndSearch(dateFilteredPrev, categoryFilters || {}, searchQuery || '')
        : dateFilteredPrev;

      const pCount = prevRows.length;
      if (pCount > 0) {
        let pAmount = 0;
        let pQty = 0;
        let pDisc = 0;
        for (let j = 0; j < pCount; j++) {
          const pRow = prevRows[j];
          pAmount += cleanNumber(pRow[amountCol]);
          pQty += quantityCol ? cleanNumber(pRow[quantityCol]) : 1;
          if (discountCol) {
            pDisc += cleanNumber(pRow[discountCol]);
          }
        }
        prevTotalAmount = pAmount;
        prevTotalQuantity = pQty;
        prevTotalDiscount = pDisc;
      }
    }

    const discountPercent = kpiAmount > 0 ? ((kpiDiscount / kpiAmount) * 100).toFixed(2) : '0.00';
    kpiMetrics = [
      {
        id: 'kpi-amount',
        label: 'Total Amount',
        value: kpiAmount,
        formattedValue: formatIndianCurrency(kpiAmount, true),
        subValue: `${formatIndianCurrency(kpiAmount, true)} in aggregate`,
        previousValue: prevTotalAmount,
        formattedPreviousValue: prevTotalAmount !== undefined ? formatIndianCurrency(prevTotalAmount, true) : undefined,
        deltaPercent: calcDelta(kpiAmount, prevTotalAmount),
        isPositiveGood: true,
      },
      {
        id: 'kpi-quantity',
        label: 'Total Quantity',
        value: kpiQty,
        formattedValue: formatIndianCount(kpiQty),
        subValue: `${len.toLocaleString('en-IN')} Spreadsheet Rows`,
        previousValue: prevTotalQuantity,
        formattedPreviousValue: prevTotalQuantity !== undefined ? formatIndianCount(prevTotalQuantity) : undefined,
        deltaPercent: calcDelta(kpiQty, prevTotalQuantity),
        isPositiveGood: true,
      },
      {
        id: 'kpi-discount',
        label: 'Total Discount',
        value: kpiDiscount,
        formattedValue: formatIndianCurrency(kpiDiscount, true),
        subValue: kpiDiscount > 0 ? `${discountPercent}% of Total Amount` : 'Total Discounts Given',
        previousValue: prevTotalDiscount,
        formattedPreviousValue: prevTotalDiscount !== undefined ? formatIndianCurrency(prevTotalDiscount, true) : undefined,
        deltaPercent: calcDelta(kpiDiscount, prevTotalDiscount),
        isPositiveGood: false,
      },
    ];
  }

  if (!canUsePrevPeriod || allRows === filteredRows) {
    const kpiCacheKey = `${isFinance ? '1' : '0'}|${amountCol}|${explicitCountCol}|${quantityCol}|${discountCol}|${invoiceCountCol}|${dateRange.preset || ''}|${dateRange.startMonth || ''}|${dateRange.endMonth || ''}|${searchQuery || ''}|${categoryFilters ? JSON.stringify(categoryFilters) : ''}`;
    getRowMapCache(kpiCache, filteredRows).set(kpiCacheKey, kpiMetrics);
  }

  const bundle: DashboardBundle = {
    kpiMetrics,
    timeSeriesData,
    topStoresData,
    financierShareData,
    gmShareData,
    asmShareData,
    categoryCountData,
    brandCountData,
  };

  if (!canUsePrevPeriod || allRows === filteredRows) {
    getRowMapCache(dashboardBundleCache, filteredRows).set(bundleKey, bundle);
  }

  return bundle;
}

/**
 * Pre-warms WeakMap caches (availableMonths + single-pass dashboard bundle + TopBar filter options +
 * EntityChartForm default view) for an inactive dataset so switching tabs is instantaneous.
 */
export function prewarmDatasetCaches(dataset: Dataset | null | undefined): void {
  if (!dataset || !dataset.rows || dataset.rows.length === 0) return;
  const cols = dataset.columns || [];
  const dateCol =
    dataset.defaultDateCol || cols.find((c) => c.type === 'date')?.name || '';
  const metricCol = dataset.defaultMetricCol || getPrimaryAmountMetric(cols);
  const dimCol =
    dataset.defaultDimCol ||
    cols.find((c) => c.type === 'category' || c.type === 'text')?.name ||
    cols[0]?.name ||
    '';

  const months = extractAvailableMonths(dataset.rows, dateCol);
  const dateRange: DateRangeFilter =
    months.length > 0
      ? { startMonth: months[0], endMonth: months[months.length - 1], preset: 'all' }
      : { startMonth: '', endMonth: '', preset: 'all' };

  computeDashboardBundle({
    allRows: dataset.rows,
    filteredRows: dataset.rows,
    columns: cols,
    config: { metricCol, dimCol, dateCol, aggType: 'sum' },
    dateRange,
  });

  // Also pre-warm TopBarFilters options so filter dropdowns mount in 0ms
  const finCol = findFinancierCol(cols) || '';
  const gCol = findGMCol(cols) || 'GM';
  const aCol = findASMCol(cols) || 'ASM';
  const bCol = findBranchCol(cols) || 'Branch';
  const cCol =
    findCategoryCol(cols) ||
    cols.find((c) => {
      const l = c.name.toLowerCase();
      return l.includes('segment') || l.includes('product');
    })?.name ||
    'Category';
  const brCol = findBrandCol(cols) || '';

  getOrComputeTopBarFilterOptions({
    allRows: dataset.rows,
    hasFinancier: Boolean(finCol && cols.some((c) => c.name === finCol)),
    hasGM: cols.some((c) => c.name === gCol),
    hasASM: cols.some((c) => c.name === aCol),
    hasBranch: cols.some((c) => c.name === bCol),
    hasCategory: cols.some((c) => c.name === cCol),
    hasBrand: Boolean(brCol && cols.some((c) => c.name === brCol)),
    financierCol: finCol,
    gmCol: gCol,
    asmCol: aCol,
    branchCol: bCol,
    categoryCol: cCol,
    brandCol: brCol,
  });
}
