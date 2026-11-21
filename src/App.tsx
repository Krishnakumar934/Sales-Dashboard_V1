import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { MotionConfig, AnimatePresence, motion } from 'motion/react';
import type { Dataset, AggregationConfig, DateRangeFilter } from './types/data.ts';
import { SAMPLE_DATASETS } from './utils/sampleData.ts';
import {
  filterRowsByDate,
  filterRowsByFacetAndSearch,
  calculateStoreDetails,
  extractAvailableMonths,
  formatMonthLabel,
  getPrimaryAmountMetric,
  findBranchCol,
  findGMCol,
  findASMCol,
  findFinancierCol,
  findCategoryCol,
  findBrandCol,
  isFinanceDataset,
  computeDashboardBundle,
  prewarmDatasetCaches,
  createRowHandle,
} from './utils/aggregator.ts';
import { Header } from './components/Header.tsx';
import { KPICards } from './components/KPICards.tsx';
import { TimeSeriesChart } from './components/TimeSeriesChart.tsx';
import { TopStoresRanking } from './components/TopStoresRanking.tsx';
import { GMAndASMShareCharts } from './components/GMAndASMShareCharts.tsx';
import { StoreDetailModal } from './components/StoreDetailModal.tsx';
import { TopBarFilters } from './components/TopBarFilters.tsx';
import { MonthRangePicker } from './components/MonthRangePicker.tsx';
import { FilterSheet } from './components/FilterSheet.tsx';
import { EntityPerformanceChartForm } from './components/EntityPerformanceChartForm.tsx';
import { AISalesAdvisor } from './components/AISalesAdvisor.tsx';
import { DataSourceModal } from './components/DataSourceModal.tsx';
import { BottomNav, ActiveTab } from './components/BottomNav.tsx';
import { DashboardSkeleton } from './components/DashboardSkeleton.tsx';
import { buildSalesAnalyticsSnapshot } from './utils/forecasting.ts';
import { Calendar, X, RefreshCw, Link2, AlertCircle, BarChart3, Landmark } from 'lucide-react';
import {
  DEFAULT_GOOGLE_SHEET_ID,
  fetchSheetFromLink,
  loadCachedDefaultSheetDatasets,
  loadSavedMainSheetUrl,
  saveCachedDefaultSheetDatasets,
  saveMainSheetUrl,
} from './utils/googleSheets.ts';
import { loadWorkbookFromIDB, saveWorkbookToIDB } from './utils/sheetCache.ts';

export default function App() {
  const initialCache = useMemo(() => loadCachedDefaultSheetDatasets(), []);

  const [datasets, setDatasets] = useState<Dataset[]>(() => {
    if (initialCache?.datasets && initialCache.datasets.length > 0) {
      return [...initialCache.datasets, ...SAMPLE_DATASETS];
    }
    return SAMPLE_DATASETS;
  });
  const [currentDatasetId, setCurrentDatasetId] = useState<string>(() => {
    if (initialCache?.datasets && initialCache.datasets.length > 0) {
      const preferred =
        initialCache.datasets.find((d) => d.reportType !== 'finance' && !isFinanceDataset(d.columns)) ||
        initialCache.datasets[0];
      return preferred.id;
    }
    return SAMPLE_DATASETS[0].id;
  });

  // Main Google Sheet Link State (No Google Sign-In)
  const [mainSheetUrl, setMainSheetUrl] = useState<string>(() => loadSavedMainSheetUrl());
  const [sheetSyncing, setSheetSyncing] = useState(false);
  const [isBootstrappingSheet, setIsBootstrappingSheet] = useState<boolean>(
    () => !(initialCache?.datasets && initialCache.datasets.length > 0)
  );
  const [isSwitchingDataset, setIsSwitchingDataset] = useState(false);
  const [switchingTargetId, setSwitchingTargetId] = useState<string | null>(null);
  const switchTokenRef = useRef(0);
  const [sheetNotice, setSheetNotice] = useState<string | null>(null);
  const [sheetRestricted, setSheetRestricted] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(initialCache?.syncedAt || null);

  const currentDataset = useMemo(() => {
    return datasets.find((d) => d.id === currentDatasetId) || datasets[0];
  }, [datasets, currentDatasetId]);

  const isFinance = useMemo(() => {
    return currentDataset.reportType === 'finance' || isFinanceDataset(currentDataset.columns);
  }, [currentDataset]);

  const salesReportDataset = useMemo(() => {
    return (
      datasets.find(
        (d) => !d.id.startsWith('sample-') && d.reportType !== 'finance' && !isFinanceDataset(d.columns)
      ) ||
      datasets.find((d) => d.reportType !== 'finance' && !isFinanceDataset(d.columns)) ||
      datasets[0]
    );
  }, [datasets]);

  const financeReportDataset = useMemo(() => {
    return (
      datasets.find(
        (d) => !d.id.startsWith('sample-') && (d.reportType === 'finance' || isFinanceDataset(d.columns))
      ) ||
      datasets.find((d) => d.reportType === 'finance' || isFinanceDataset(d.columns)) ||
      null
    );
  }, [datasets]);

  // Aggregation config - strictly prioritizing Amount
  const [aggConfig, setAggConfig] = useState<AggregationConfig>(() => ({
    metricCol: currentDataset.defaultMetricCol || getPrimaryAmountMetric(currentDataset.columns),
    dimCol: currentDataset.defaultDimCol || currentDataset.columns.find((c) => c.type === 'category')?.name || '',
    dateCol: currentDataset.defaultDateCol || currentDataset.columns.find((c) => c.type === 'date')?.name || '',
    aggType: 'sum',
  }));

  // Available chronological months in dataset (auto-detects DMY/MDY, spans, and yearless labels)
  const availableMonths = useMemo(() => {
    return extractAvailableMonths(currentDataset.rows, aggConfig.dateCol);
  }, [currentDataset.rows, aggConfig.dateCol]);

  // Custom Month Range state - initialized directly from active dataset boundaries
  const [dateRange, setDateRange] = useState<DateRangeFilter>(() => {
    const initDateCol =
      currentDataset.defaultDateCol ||
      currentDataset.columns.find((c) => c.type === 'date')?.name ||
      '';
    const months = extractAvailableMonths(currentDataset.rows, initDateCol);
    return months.length > 0
      ? { startMonth: months[0], endMonth: months[months.length - 1], preset: 'all' }
      : { startMonth: '', endMonth: '', preset: 'all' };
  });

  // Synchronize date range when availableMonths changes (e.g. user switches dateCol)
  useEffect(() => {
    if (availableMonths.length === 0) {
      setDateRange((prev) =>
        !prev.startMonth && !prev.endMonth && prev.preset === 'all'
          ? prev
          : { startMonth: '', endMonth: '', preset: 'all' }
      );
      return;
    }
    const minM = availableMonths[0];
    const maxM = availableMonths[availableMonths.length - 1];

    setDateRange((prev) => {
      const noOverlap =
        !prev.startMonth ||
        !prev.endMonth ||
        prev.endMonth < minM ||
        prev.startMonth > maxM;
      if (!prev.preset || prev.preset === 'all' || noOverlap) {
        if (prev.startMonth === minM && prev.endMonth === maxM && prev.preset === 'all') {
          return prev;
        }
        return {
          startMonth: minM,
          endMonth: maxM,
          preset: 'all',
        };
      }
      const clampedStart = prev.startMonth < minM ? minM : prev.startMonth;
      const clampedEnd = prev.endMonth > maxM ? maxM : prev.endMonth;
      if (clampedStart <= clampedEnd) {
        if (prev.startMonth === clampedStart && prev.endMonth === clampedEnd) {
          return prev;
        }
        return { ...prev, startMonth: clampedStart, endMonth: clampedEnd };
      }
      return { startMonth: minM, endMonth: maxM, preset: 'all' };
    });
  }, [availableMonths]);

  // Single-batch dataset switch handler (prevents double renders when switching tabs)
  const applyDatasetSelection = useCallback((targetDataset: Dataset) => {
    const nextDateCol =
      targetDataset.defaultDateCol ||
      targetDataset.columns.find((c) => c.type === 'date')?.name ||
      '';
    const nextMetricCol =
      targetDataset.defaultMetricCol || getPrimaryAmountMetric(targetDataset.columns);
    const nextDimCol =
      targetDataset.defaultDimCol ||
      targetDataset.columns.find((c) => c.type === 'category' || c.type === 'text')?.name ||
      targetDataset.columns[0]?.name ||
      '';
    const months = extractAvailableMonths(targetDataset.rows, nextDateCol);

    setAggConfig({
      metricCol: nextMetricCol,
      dimCol: nextDimCol,
      dateCol: nextDateCol,
      aggType: 'sum',
    });
    setDateRange(
      months.length > 0
        ? { startMonth: months[0], endMonth: months[months.length - 1], preset: 'all' }
        : { startMonth: '', endMonth: '', preset: 'all' }
    );
    setCategoryFilters({});
    setSearchQuery('');
    setCurrentDatasetId(targetDataset.id);
  }, []);

  // Immediate skeleton display on dataset switch so visual feedback persists while calculating
  const switchToDataset = useCallback(
    (targetDataset: Dataset) => {
      const effectiveActiveId = switchingTargetId || currentDataset.id;
      if (!targetDataset || targetDataset.id === effectiveActiveId) return;

      const token = ++switchTokenRef.current;
      setSwitchingTargetId(targetDataset.id);
      setIsSwitchingDataset(true);

      // Double-rAF guarantees the browser paints the skeleton BEFORE running dataset swap
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (switchTokenRef.current !== token) return;
          const paintedAt = performance.now();
          prewarmDatasetCaches(targetDataset);
          applyDatasetSelection(targetDataset);
          setIsBootstrappingSheet(false);

          const computeMs = performance.now() - paintedAt;
          const remaining = Math.max(0, 220 - computeMs);
          window.setTimeout(() => {
            if (switchTokenRef.current !== token) return;
            setIsSwitchingDataset(false);
            setSwitchingTargetId(null);
          }, remaining);
        });
      });
    },
    [switchingTargetId, currentDataset.id, applyDatasetSelection]
  );

  const handleSelectDatasetById = useCallback(
    (datasetId: string) => {
      const found = datasets.find((d) => d.id === datasetId);
      if (found) {
        switchToDataset(found);
      }
    },
    [datasets, switchToDataset]
  );

  // Filter state
  const [categoryFilters, setCategoryFilters] = useState<Record<string, string[]>>({});
  const [searchQuery, setSearchQuery] = useState<string>('');

  // UI Modals & Navigation state
  const [isMonthPickerOpen, setIsMonthPickerOpen] = useState(false);
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);
  const [isDataModalOpen, setIsDataModalOpen] = useState(false);
  const [isMobileFrame, setIsMobileFrame] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');

  // Filter pipeline optimized for large datasets (200k+ rows)
  const dateFilteredRows = useMemo(() => {
    if (dateRange.preset === 'all' || !aggConfig.dateCol || aggConfig.dateCol === 'none') {
      return currentDataset.rows;
    }
    return filterRowsByDate(
      currentDataset.rows,
      aggConfig.dateCol,
      dateRange.startMonth,
      dateRange.endMonth
    );
  }, [currentDataset.rows, aggConfig.dateCol, dateRange.preset, dateRange.startMonth, dateRange.endMonth]);

  // Fully filtered rows applying active categories and search facets
  const filteredRows = useMemo(() => {
    return filterRowsByFacetAndSearch(dateFilteredRows, categoryFilters, searchQuery);
  }, [dateFilteredRows, categoryFilters, searchQuery]);

  // Store / Branch & Share Column identifiers
  const storeCol = useMemo(() => {
    return findBranchCol(currentDataset.columns) || aggConfig.dimCol || 'Branch';
  }, [currentDataset.columns, aggConfig.dimCol]);

  const financierCol = useMemo(() => findFinancierCol(currentDataset.columns), [currentDataset.columns]);
  const gmCol = useMemo(() => findGMCol(currentDataset.columns) || 'GM', [currentDataset.columns]);
  const asmCol = useMemo(() => findASMCol(currentDataset.columns) || 'ASM', [currentDataset.columns]);
  const categoryCol = useMemo(() => findCategoryCol(currentDataset.columns) || 'Category', [currentDataset.columns]);
  const brandCol = useMemo(() => findBrandCol(currentDataset.columns) || 'Brand', [currentDataset.columns]);

  // Unified single-pass calculation for KPIs, Time-Series, Top Stores, and all Share charts
  const dashboardBundle = useMemo(() => {
    return computeDashboardBundle({
      allRows: currentDataset.rows,
      filteredRows,
      columns: currentDataset.columns,
      config: aggConfig,
      dateRange,
      categoryFilters,
      searchQuery,
    });
  }, [
    currentDataset.rows,
    filteredRows,
    currentDataset.columns,
    aggConfig,
    dateRange,
    categoryFilters,
    searchQuery,
  ]);

  const {
    kpiMetrics,
    timeSeriesData,
    topStoresData,
    financierShareData,
    gmShareData,
    asmShareData,
    categoryCountData,
    brandCountData,
  } = dashboardBundle;

  // Date-filtered counterpart dataset rows (so Sales <-> Finance summaries match selected Month Range)
  const counterpartSalesRows = useMemo(() => {
    if (!isFinance || !salesReportDataset || salesReportDataset.id === currentDataset.id) return [];
    const sDateCol =
      salesReportDataset.defaultDateCol ||
      salesReportDataset.columns.find((c) => c.type === 'date')?.name ||
      '';
    if (dateRange.preset === 'all' || !sDateCol) return salesReportDataset.rows;
    return filterRowsByDate(
      salesReportDataset.rows,
      sDateCol,
      dateRange.startMonth,
      dateRange.endMonth
    );
  }, [isFinance, salesReportDataset, currentDataset.id, dateRange]);

  const counterpartFinanceRows = useMemo(() => {
    if (isFinance || !financeReportDataset || financeReportDataset.id === currentDataset.id) return [];
    const fDateCol =
      financeReportDataset.defaultDateCol ||
      financeReportDataset.columns.find((c) => c.type === 'date')?.name ||
      '';
    if (dateRange.preset === 'all' || !fDateCol) return financeReportDataset.rows;
    return filterRowsByDate(
      financeReportDataset.rows,
      fDateCol,
      dateRange.startMonth,
      dateRange.endMonth
    );
  }, [isFinance, financeReportDataset, currentDataset.id, dateRange]);

  const dateFilteredRowsHandle = useMemo(
    () => createRowHandle(dateFilteredRows, 'dateFiltered'),
    [dateFilteredRows]
  );
  const filteredRowsHandle = useMemo(
    () => createRowHandle(filteredRows, 'filtered'),
    [filteredRows]
  );
  const counterpartSalesHandle = useMemo(
    () => createRowHandle(counterpartSalesRows, 'cpSales'),
    [counterpartSalesRows]
  );
  const counterpartFinanceHandle = useMemo(
    () => createRowHandle(counterpartFinanceRows, 'cpFinance'),
    [counterpartFinanceRows]
  );

  // Modal report state for Financier / GM / ASM / Store / Category / Brand clicks
  const [entityModalTarget, setEntityModalTarget] = useState<{
    col: string;
    name: string;
    excludeNames?: string[];
  } | null>(null);

  const topStoreReport = useMemo(() => {
    if (!entityModalTarget) return null;
    return calculateStoreDetails(
      filteredRows,
      entityModalTarget.name,
      entityModalTarget.col,
      currentDataset.columns,
      {
        dimensionLabel: entityModalTarget.col,
        excludeNames: entityModalTarget.excludeNames,
        counterpartSalesRows,
        counterpartSalesCols: salesReportDataset?.columns,
        counterpartFinanceRows,
        counterpartFinanceCols: financeReportDataset?.columns,
      }
    );
  }, [
    entityModalTarget,
    filteredRows,
    currentDataset.columns,
    counterpartSalesRows,
    salesReportDataset,
    counterpartFinanceRows,
    financeReportDataset,
  ]);

  // KPI Metrics come directly from single-pass dashboardBundle above

  // Active filter count
  const activeFilterCount = useMemo(() => {
    const catCount = Object.values(categoryFilters).reduce(
      (acc, arr) => acc + (arr ? arr.length : 0),
      0
    );
    return catCount + (searchQuery.trim() ? 1 : 0);
  }, [categoryFilters, searchQuery]);

  // Handler to toggle a category from the bar chart click
  const handleToggleCategory = (category: string) => {
    const dim = aggConfig.dimCol;
    if (!dim) return;
    const current = categoryFilters[dim] || [];
    const next = current.includes(category)
      ? current.filter((c) => c !== category)
      : [...current, category];
    setCategoryFilters({
      ...categoryFilters,
      [dim]: next,
    });
  };

  // Handle adding a multi-sheet workbook cleanly (e.g. Sales Report + Finance Data)
  const handleApplyWorkbookDatasets = (incoming: Dataset[]) => {
    if (!incoming || incoming.length === 0) return;

    const preferredNext =
      (isFinance
        ? incoming.find((d) => d.reportType === 'finance' || isFinanceDataset(d.columns))
        : incoming.find((d) => d.reportType !== 'finance' && !isFinanceDataset(d.columns))) ||
      incoming.find((d) => d.reportType !== 'finance') ||
      incoming[0];

    setDatasets((prev) => {
      const incomingIds = new Set(incoming.map((d) => d.id));
      const isSyncedWorkbook = incoming.some((d) => d.id.startsWith('gsheet-'));
      const retained = prev.filter((d) => {
        if (incomingIds.has(d.id)) return false;
        if (isSyncedWorkbook && d.id.startsWith('gsheet-')) return false;
        return true;
      });
      return [...incoming, ...retained];
    });
    applyDatasetSelection(preferredNext);
  };

  // Handle adding or updating a single dataset cleanly without duplicating same ID
  const handleAddNewDataset = (newDataset: Dataset) => {
    handleApplyWorkbookDatasets([newDataset]);
  };

  // Sync directly from the main Sheet Link without Google Sign-In
  const handleSyncSheetUrl = async (targetUrl?: string): Promise<boolean> => {
    const cleanUrl = saveMainSheetUrl(targetUrl ?? mainSheetUrl);
    setMainSheetUrl(cleanUrl);
    setSheetSyncing(true);
    setSheetNotice(null);
    try {
      const result = await fetchSheetFromLink(cleanUrl, { forceRefresh: true });
      if (result.status === 'ok') {
        const synced = saveCachedDefaultSheetDatasets(result.datasets);
        setLastSyncedAt(synced);
        setSheetRestricted(false);
        setSheetNotice(null);
        handleApplyWorkbookDatasets(result.datasets);
        setIsBootstrappingSheet(false);
        window.setTimeout(() => {
          void saveWorkbookToIDB(cleanUrl, result.datasets, synced);
        }, 500);
        return true;
      }
      setSheetRestricted(true);
      setSheetNotice(result.message);
      setIsBootstrappingSheet(false);
      return false;
    } catch (err: any) {
      setSheetNotice(err?.message || 'Unable to load spreadsheet from this link.');
      setIsBootstrappingSheet(false);
      return false;
    } finally {
      setSheetSyncing(false);
    }
  };

  // Startup hydration: read IndexedDB instant cache first, then fetch live sheet if missing/stale
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await loadWorkbookFromIDB(mainSheetUrl);
      if (cancelled) return;

      if (cached && cached.datasets.length > 0) {
        setLastSyncedAt(cached.syncedAt || null);
        setSheetRestricted(false);
        setSheetNotice(null);
        handleApplyWorkbookDatasets(cached.datasets);
        setIsBootstrappingSheet(false);
        if (!cached.isStale) {
          return;
        }
      }

      setSheetSyncing(true);
      try {
        const result = await fetchSheetFromLink(mainSheetUrl);
        if (cancelled) return;
        if (result.status === 'ok') {
          const synced = saveCachedDefaultSheetDatasets(result.datasets);
          setLastSyncedAt(synced);
          setSheetRestricted(false);
          setSheetNotice(null);
          handleApplyWorkbookDatasets(result.datasets);
          window.setTimeout(() => {
            if (!cancelled) {
              void saveWorkbookToIDB(mainSheetUrl, result.datasets, synced);
            }
          }, 500);
        } else {
          setSheetRestricted(true);
          setSheetNotice(result.message);
        }
      } catch (err: any) {
        if (!cancelled) {
          setSheetNotice(err?.message || 'Unable to reach sheet link automatically.');
        }
      } finally {
        if (!cancelled) {
          setSheetSyncing(false);
          setIsBootstrappingSheet(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Pre-warm counterpart sheet (e.g. Finance Data while viewing Sales Report) during idle time
  useEffect(() => {
    const inactive = isFinance ? salesReportDataset : financeReportDataset;
    if (!inactive || inactive.id === currentDataset.id || !inactive.rows || inactive.rows.length === 0) {
      return;
    }
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
    if (typeof ric === 'function') {
      const handle = ric(() => prewarmDatasetCaches(inactive), { timeout: 400 });
      return () => {
        const cancelRic = (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
        if (typeof cancelRic === 'function') cancelRic(handle);
      };
    }
    const timer = window.setTimeout(() => prewarmDatasetCaches(inactive), 80);
    return () => window.clearTimeout(timer);
  }, [isFinance, salesReportDataset, financeReportDataset, currentDataset.id]);

  const monthRangeDisplay = useMemo(() => {
    if (dateRange.preset === 'all') {
      if (dateRange.startMonth && dateRange.endMonth) {
        return `All Time (${formatMonthLabel(dateRange.startMonth)} – ${formatMonthLabel(dateRange.endMonth)})`;
      }
      return 'All Time';
    }
    if (dateRange.startMonth && dateRange.endMonth) {
      return `${formatMonthLabel(dateRange.startMonth)} – ${formatMonthLabel(dateRange.endMonth)}`;
    }
    return 'All Records';
  }, [dateRange]);

  // Grounded sales & forecast snapshot for AI Sales Advisor
  const analyticsSnapshot = useMemo(() => {
    return buildSalesAnalyticsSnapshot({
      datasetName: currentDataset.name,
      dateRangeLabel: monthRangeDisplay,
      dateRange,
      categoryFilters,
      searchQuery,
      filteredRows,
      columns: currentDataset.columns,
      aggConfig,
      kpiMetrics,
      timeSeriesData,
      gmShares: gmShareData,
      asmShares: asmShareData,
    });
  }, [
    currentDataset.name,
    currentDataset.columns,
    monthRangeDisplay,
    dateRange,
    categoryFilters,
    searchQuery,
    filteredRows,
    aggConfig,
    kpiMetrics,
    timeSeriesData,
    gmShareData,
    asmShareData,
  ]);

  // Smooth scroll handler for mobile bottom tabs
  const handleTabSelect = (tab: ActiveTab) => {
    setActiveTab(tab);
    if (tab === 'sources') {
      setIsDataModalOpen(true);
      return;
    }
    const targetMap: Record<string, string> = {
      overview: 'section-overview',
      ai: 'section-ai',
      breakdowns: 'section-breakdowns',
      chartform: 'section-chartform',
    };
    const targetId = targetMap[tab];
    if (targetId) {
      const el = document.getElementById(targetId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  };

  const pendingTargetDataset = useMemo(() => {
    if (!switchingTargetId) return null;
    return datasets.find((d) => d.id === switchingTargetId) || null;
  }, [switchingTargetId, datasets]);

  const effectiveDataset = pendingTargetDataset || currentDataset;
  const effectiveIsFinance = useMemo(() => {
    return (
      effectiveDataset.reportType === 'finance' || isFinanceDataset(effectiveDataset.columns)
    );
  }, [effectiveDataset]);

  const headerDatasetOptions = useMemo(
    () => datasets.map((d) => ({ id: d.id, name: d.name })),
    [datasets]
  );

  const showDashboardSkeleton =
    isSwitchingDataset || (isBootstrappingSheet && !currentDataset.id.startsWith('gsheet-'));

  const isSalesTabActive = !effectiveIsFinance && effectiveDataset.id === salesReportDataset?.id;

  return (
    <MotionConfig reducedMotion="user">
    <div className="min-h-screen bg-[#0b0f19] text-slate-100 flex flex-col font-sans selection:bg-slate-800 selection:text-white">
      {/* Top Header Bar */}
      <Header
        currentDatasetId={effectiveDataset.id}
        datasetOptions={headerDatasetOptions}
        onSelectDataset={handleSelectDatasetById}
        onOpenDataModal={() => setIsDataModalOpen(true)}
        onOpenFilterSheet={() => setIsFilterSheetOpen(true)}
        onOpenMonthPicker={() => setIsMonthPickerOpen(true)}
        activeFilterCount={activeFilterCount}
        monthRangeLabel={monthRangeDisplay}
        isMobileFrame={isMobileFrame}
        onToggleMobileFrame={() => setIsMobileFrame(!isMobileFrame)}
      />

      {/* Main Content Area */}
      <main
        className={`flex-1 transition-all duration-200 pb-24 md:pb-12 ${
          isMobileFrame
            ? 'max-w-[420px] mx-auto my-4 rounded-3xl border-4 border-slate-800 shadow-2xl overflow-hidden bg-[#0b0f19] p-3 sm:p-4 space-y-4'
            : 'max-w-7xl w-full mx-auto p-3 sm:p-5 lg:p-6 space-y-4 sm:space-y-5'
        }`}
      >
        {/* Top-Level Report Switcher: Sales Report | Finance Report */}
        <div
          role="tablist"
          aria-label="Report Type"
          className="grid grid-cols-2 gap-2 bg-slate-900/90 border border-slate-800 rounded-2xl p-1.5 shadow-xs relative"
        >
          <motion.button
            type="button"
            role="tab"
            aria-selected={isSalesTabActive}
            whileTap={{ scale: 0.985 }}
            onClick={() => {
              if (salesReportDataset) {
                switchToDataset(salesReportDataset);
              }
            }}
            className={`relative flex items-center justify-center sm:justify-between gap-2 px-3 sm:px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-colors cursor-pointer z-10 ${
              isSalesTabActive
                ? 'text-emerald-300'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
            }`}
          >
            {isSalesTabActive && (
              <motion.span
                layoutId="report-tab-active-bg"
                transition={{ type: 'spring', stiffness: 460, damping: 36 }}
                className="absolute inset-0 rounded-xl bg-emerald-500/15 border border-emerald-500/40 shadow-xs -z-10"
              />
            )}
            <span className="flex items-center gap-2 min-w-0 relative z-10">
              <BarChart3 className="w-4 h-4 shrink-0" />
              <span className="truncate">Sales Report</span>
            </span>
            {salesReportDataset && !(isBootstrappingSheet && salesReportDataset.id.startsWith('sample-')) && (
              <span className="hidden sm:inline-flex text-[10px] font-mono px-2 py-0.5 rounded-md bg-slate-950/60 border border-slate-800 text-slate-300 shrink-0 relative z-10">
                {salesReportDataset.rows.length.toLocaleString('en-IN')} rows
              </span>
            )}
          </motion.button>

          <motion.button
            type="button"
            role="tab"
            aria-selected={effectiveIsFinance}
            disabled={!financeReportDataset || (isBootstrappingSheet && !currentDataset.id.startsWith('gsheet-'))}
            whileTap={{ scale: 0.985 }}
            onClick={() => {
              if (financeReportDataset) {
                switchToDataset(financeReportDataset);
              }
            }}
            className={`relative flex items-center justify-center sm:justify-between gap-2 px-3 sm:px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed z-10 ${
              effectiveIsFinance
                ? 'text-cyan-300'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
            }`}
          >
            {effectiveIsFinance && (
              <motion.span
                layoutId="report-tab-active-bg"
                transition={{ type: 'spring', stiffness: 460, damping: 36 }}
                className="absolute inset-0 rounded-xl bg-cyan-500/15 border border-cyan-500/40 shadow-xs -z-10"
              />
            )}
            <span className="flex items-center gap-2 min-w-0 relative z-10">
              <Landmark className="w-4 h-4 shrink-0" />
              <span className="truncate">Finance Report</span>
            </span>
            {financeReportDataset && !(isBootstrappingSheet && financeReportDataset.id.startsWith('sample-')) && (
              <span className="hidden sm:inline-flex text-[10px] font-mono px-2 py-0.5 rounded-md bg-slate-950/60 border border-slate-800 text-slate-300 shrink-0 relative z-10">
                {financeReportDataset.rows.length.toLocaleString('en-IN')} rows
              </span>
            )}
          </motion.button>
        </div>

        {/* Compact Period, Default Sheet Sync & Filter Quick Status */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs bg-slate-900/80 border border-slate-800/90 rounded-2xl p-2.5 sm:px-4 text-slate-300">
          <div
            onClick={() => setIsMonthPickerOpen(true)}
            className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5 cursor-pointer hover:text-white transition-colors min-w-0"
          >
            <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="text-slate-200 font-medium whitespace-nowrap text-xs truncate">
              {monthRangeDisplay}
            </span>
            {activeFilterCount > 0 && (
              <span className="text-slate-400 text-[11px] whitespace-nowrap">
                · {activeFilterCount} active
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0 ml-auto">
            {sheetRestricted && !currentDataset.id.startsWith('gsheet-') && (
              <button
                type="button"
                onClick={() => setIsDataModalOpen(true)}
                className="inline-flex items-center gap-1.5 text-[11px] text-amber-300 hover:text-amber-200 px-2.5 py-1 bg-amber-950/30 rounded-lg border border-amber-700/50 font-medium transition-colors cursor-pointer"
                title="Click to check sharing setting or update main Google Sheet link"
              >
                <AlertCircle className="w-3 h-3 shrink-0" />
                <span>Sheet Access Restricted</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => handleSyncSheetUrl()}
              disabled={sheetSyncing}
              className="inline-flex items-center gap-1.5 text-[11px] text-emerald-300 hover:text-emerald-200 px-2.5 py-1 bg-emerald-950/30 rounded-lg border border-emerald-800/60 font-medium tactile-press cursor-pointer"
              title={`Sync main Google Sheet (${DEFAULT_GOOGLE_SHEET_ID})`}
            >
              {sheetSyncing ? (
                <RefreshCw className="w-3 h-3 animate-spin" />
              ) : (
                <Link2 className="w-3 h-3" />
              )}
              <span>{sheetSyncing ? 'Syncing Sheet...' : 'Sync Sheet'}</span>
            </button>

            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  setCategoryFilters({});
                  setSearchQuery('');
                }}
                className="text-[11px] text-rose-400 hover:text-rose-300 px-2.5 py-1 bg-rose-950/30 rounded-lg border border-rose-900/60 font-medium tactile-press flex items-center gap-1 cursor-pointer"
              >
                <X className="w-3 h-3" />
                <span>Reset Filters</span>
              </button>
            )}
          </div>
        </div>

        {showDashboardSkeleton ? (
          <DashboardSkeleton
            key="dashboard-skeleton-view"
            isFinance={effectiveIsFinance}
            isMobileFrame={isMobileFrame}
            targetLabel={effectiveDataset.name}
            phaseMessage={
              isSwitchingDataset
                ? `Calculating ${effectiveDataset.name} (${effectiveDataset.rows.length.toLocaleString('en-IN')} rows)...`
                : 'Loading live Google Sheet workbook...'
            }
          />
        ) : (
          <motion.div
            key={`dashboard-content-${currentDataset.id}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-4 sm:space-y-5"
          >
            {/* Unified Top Bar Filter (Group By + Cascading GM -> ASM -> Branch -> Category) */}
            <TopBarFilters
              columns={currentDataset.columns}
              allRows={dateFilteredRowsHandle}
              activeFilters={categoryFilters}
              onFilterChange={(colName, selected) => {
                setCategoryFilters((prev) => {
                  const next: Record<string, string[]> = {
                    ...prev,
                    [colName]: selected,
                  };

                  if (selected.length === 0) {
                    delete next[colName];
                    return next;
                  }

                  // Auto-prune child filter selections if no longer valid under new selections
                  for (const [otherCol, vals] of Object.entries(next)) {
                    if (otherCol === colName || !vals || vals.length === 0) continue;

                    const validUnderSelection = new Set<string>();
                    const len = dateFilteredRows.length;
                    for (let i = 0; i < len; i++) {
                      const r = dateFilteredRows[i];
                      const pVal = String(r[colName] ?? '').trim().toLowerCase();
                      if (selected.some((s) => s.trim().toLowerCase() === pVal)) {
                        const cVal = String(r[otherCol] ?? '').trim().toLowerCase();
                        if (cVal) validUnderSelection.add(cVal);
                      }
                    }

                    const retained = vals.filter((v) =>
                      validUnderSelection.has(v.trim().toLowerCase())
                    );
                    if (retained.length > 0) {
                      next[otherCol] = retained;
                    } else {
                      delete next[otherCol];
                    }
                  }

                  return next;
                });
              }}
              onClearAll={() => {
                setCategoryFilters({});
                setSearchQuery('');
              }}
              config={aggConfig}
              onChangeConfig={setAggConfig}
              isMobileFrame={isMobileFrame}
            />

            {/* Dashboard Sections Flow: All sections rendered in smooth, continuous sequence */}
            <div className="space-y-6">
              {/* Section 1: Overview (KPIs & Monthly Trend) */}
              <div id="section-overview" className="space-y-4 scroll-mt-20">
                {/* KPI Headline Metric Cards (3 Cards: Total Amount, Total Quantity, Total Discount) */}
                <KPICards metrics={kpiMetrics} isMobileFrame={isMobileFrame} />

                {/* Time-Series Trend Chart */}
                <TimeSeriesChart
                  data={timeSeriesData}
                  metricName={aggConfig.metricCol}
                  aggregationType={aggConfig.aggType}
                  hasDateCol={Boolean(aggConfig.dateCol && dateRange.startMonth && dateRange.endMonth)}
                  isFinance={isFinance}
                />
              </div>

              {/* Section 2: AI Sales Analysis & Future Predictions */}
              <div id="section-ai" className="scroll-mt-20">
                <AISalesAdvisor snapshot={analyticsSnapshot} />
              </div>

              {/* Section 3: Store Rankings & Financier/GM/ASM/Category/Brand Shares */}
              <div id="section-breakdowns" className="space-y-6 scroll-mt-20">
                {/* Top 10 Stores with genuine store names (#1 to #10) and full fields */}
                <TopStoresRanking
                  stores={topStoresData}
                  storeColName={storeCol}
                  metricName={aggConfig.metricCol}
                  isFinance={isFinance}
                  selectedStores={categoryFilters[storeCol] || []}
                  onToggleStore={(storeName) => {
                    const current = categoryFilters[storeCol] || [];
                    const next = current.includes(storeName)
                      ? current.filter((s) => s !== storeName)
                      : [...current, storeName];
                    setCategoryFilters({
                      ...categoryFilters,
                      [storeCol]: next,
                    });
                  }}
                  onOpenStoreDetails={(storeName) =>
                    setEntityModalTarget({ col: storeCol, name: storeName })
                  }
                />

                {/* Financier / GM / ASM / Category Counts / Brand Counts breakdowns */}
                <GMAndASMShareCharts
                  gmShares={gmShareData}
                  asmShares={asmShareData}
                  financierShares={financierShareData}
                  categoryCountShares={categoryCountData}
                  brandCountShares={brandCountData}
                  financierColName={financierCol || 'Financier'}
                  gmColName={gmCol}
                  asmColName={asmCol}
                  categoryColName={categoryCol}
                  brandColName={brandCol}
                  onSelectEntity={(dimColName, entityName, excludeNames) =>
                    setEntityModalTarget({ col: dimColName, name: entityName, excludeNames })
                  }
                  metricName={aggConfig.metricCol}
                  isFinance={isFinance}
                  isMobileFrame={isMobileFrame}
                />

                {/* Detailed Summary Modal triggered from Financier, GM, ASM, Store, Category, or Brand */}
                <AnimatePresence>
                  {Boolean(entityModalTarget) && (
                    <StoreDetailModal
                      key="app-store-detail-modal"
                      isOpen={Boolean(entityModalTarget)}
                      onClose={() => setEntityModalTarget(null)}
                      report={topStoreReport}
                      onApplyStoreFilter={(entityName) => {
                        const targetCol = entityModalTarget?.col || storeCol;
                        const current = categoryFilters[targetCol] || [];
                        if (!current.includes(entityName)) {
                          setCategoryFilters({
                            ...categoryFilters,
                            [targetCol]: [...current, entityName],
                          });
                        }
                      }}
                    />
                  )}
                </AnimatePresence>
              </div>

              {/* Section 3: Branch Performance & Entity Chart Form */}
              <div id="section-chartform" className="scroll-mt-20">
                <EntityPerformanceChartForm
                  rows={filteredRowsHandle}
                  columns={currentDataset.columns}
                  dimensionCol={aggConfig.dimCol}
                  metricCol={aggConfig.metricCol}
                  aggType={aggConfig.aggType}
                  isFinance={isFinance}
                  counterpartSalesRows={counterpartSalesHandle}
                  counterpartSalesCols={salesReportDataset?.columns}
                  counterpartFinanceRows={counterpartFinanceHandle}
                  counterpartFinanceCols={financeReportDataset?.columns}
                  selectedCategories={categoryFilters[aggConfig.dimCol] || []}
                  onToggleCategory={handleToggleCategory}
                  onChangeDimension={(newDim) => {
                    setAggConfig((prev) => ({ ...prev, dimCol: newDim }));
                  }}
                  datasetName={currentDataset.name}
                />
              </div>
            </div>
          </motion.div>
        )}
      </main>

      {/* Mobile Bottom Tab Navigation */}
      <BottomNav
        activeTab={activeTab}
        onChangeTab={handleTabSelect}
        onOpenDataSources={() => setIsDataModalOpen(true)}
      />

      {/* Custom Month Range Modal */}
      <AnimatePresence>
        {isMonthPickerOpen && (
          <MonthRangePicker
            key="app-month-range-picker"
            isOpen={isMonthPickerOpen}
            onClose={() => setIsMonthPickerOpen(false)}
            availableMonths={availableMonths}
            currentRange={dateRange}
            onApplyRange={setDateRange}
          />
        )}
      </AnimatePresence>

      {/* Filter Sheet Modal */}
      <AnimatePresence>
        {isFilterSheetOpen && (
          <FilterSheet
            key="app-filter-sheet"
            isOpen={isFilterSheetOpen}
            onClose={() => setIsFilterSheetOpen(false)}
            columns={currentDataset.columns}
            rows={dateFilteredRowsHandle}
            activeCategoryFilters={categoryFilters}
            searchQuery={searchQuery}
            onApplyFilters={(cats, search) => {
              setCategoryFilters(cats);
              setSearchQuery(search);
            }}
          />
        )}
      </AnimatePresence>

      {/* Main Sheet Link & Optional File Upload Modal */}
      <AnimatePresence>
        {isDataModalOpen && (
          <DataSourceModal
            key="app-data-source-modal"
            isOpen={isDataModalOpen}
            onClose={() => setIsDataModalOpen(false)}
            currentDataset={currentDataset}
            onAddNewDataset={handleAddNewDataset}
            onAddNewDatasets={handleApplyWorkbookDatasets}
            mainSheetUrl={mainSheetUrl}
            sheetLoaded={datasets.some((d) => d.id.startsWith('gsheet-'))}
            sheetSyncing={sheetSyncing}
            sheetNotice={sheetNotice}
            lastSyncedAt={lastSyncedAt}
            onSyncSheetUrl={handleSyncSheetUrl}
          />
        )}
      </AnimatePresence>
    </div>
    </MotionConfig>
  );
}
