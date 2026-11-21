export type ColumnType = 'date' | 'number' | 'category' | 'text';

export interface ColumnMeta {
  name: string;
  type: ColumnType;
  distinctCount?: number;
  min?: number | string;
  max?: number | string;
}

export type DataRow = Record<string, any>;

export interface Dataset {
  id: string;
  name: string;
  description: string;
  fileName?: string;
  sheetNames: string[];
  activeSheet: string;
  reportType?: 'sales' | 'finance';
  rows: DataRow[];
  columns: ColumnMeta[];
  defaultDateCol?: string;
  defaultMetricCol?: string;
  defaultDimCol?: string;
  defaultCountCol?: string;
}

export type AggregationType = 'sum' | 'avg' | 'count' | 'min' | 'max';

export interface DateRangeFilter {
  startMonth: string; // 'YYYY-MM'
  endMonth: string;   // 'YYYY-MM'
  preset?: string;
}

export interface FilterState {
  dateRange: DateRangeFilter;
  categories: Record<string, string[]>; // colName -> selected string values
  numericRanges: Record<string, { min: number; max: number }>;
  searchQuery: string;
}

export interface AggregationConfig {
  metricCol: string;
  dimCol: string;
  dateCol: string;
  aggType: AggregationType;
}

export interface TimeSeriesPoint {
  period: string; // 'YYYY-MM'
  label: string;  // e.g. 'Jan 2026'
  value: number;
  count: number;
}

export interface DimensionSlice {
  category: string;
  value: number;
  percentage: number;
  count: number;
  countPercentage?: number;
  quantity?: number;
  discount?: number;
  gm?: string;
  asm?: string;
}

export interface KPIMetric {
  id: string;
  label: string;
  value: number;
  formattedValue: string;
  subValue?: string;
  previousValue?: number;
  formattedPreviousValue?: string;
  deltaPercent?: number;
  isPositiveGood?: boolean;
  unit?: string;
}
