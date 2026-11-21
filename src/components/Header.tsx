import React from 'react';
import { Layers, SlidersHorizontal, Smartphone, Monitor, Link2, Calendar } from 'lucide-react';

interface DatasetOption {
  id: string;
  name: string;
}

interface HeaderProps {
  currentDatasetId: string;
  datasetOptions: DatasetOption[];
  onSelectDataset: (id: string) => void;
  onOpenDataModal: () => void;
  onOpenFilterSheet: () => void;
  onOpenMonthPicker: () => void;
  activeFilterCount: number;
  monthRangeLabel: string;
  isMobileFrame: boolean;
  onToggleMobileFrame: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentDatasetId,
  datasetOptions,
  onSelectDataset,
  onOpenDataModal,
  onOpenFilterSheet,
  onOpenMonthPicker,
  activeFilterCount,
  monthRangeLabel,
  isMobileFrame,
  onToggleMobileFrame,
}) => {
  return (
    <header className="sticky top-0 z-30 bg-slate-900/90 backdrop-blur-md border-b border-slate-800/90 text-white">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-2 sm:py-2.5 flex items-center justify-between gap-2 sm:gap-4">
        {/* Brand & Dataset Selector: ultra-compact on mobile, spacious on desktop */}
        <div className="flex items-center gap-2 flex-1 sm:flex-initial min-w-0">
          {/* Brand Identity */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-slate-800/80 border border-slate-700 flex items-center justify-center text-slate-300">
              <Layers className="w-4 h-4" />
            </div>
            <h1 className="text-sm sm:text-base font-semibold tracking-tight text-white whitespace-nowrap hidden xs:inline">
              PulseGrid
            </h1>
          </div>

          {/* Dataset Switcher */}
          <select
            value={currentDatasetId}
            onChange={(e) => onSelectDataset(e.target.value)}
            aria-label="Select Dataset"
            className="text-xs bg-slate-950/70 text-slate-200 border border-slate-800 hover:border-slate-700 rounded-xl px-2.5 py-1.5 focus:outline-none focus:border-slate-600 flex-1 min-w-0 w-full sm:w-auto sm:flex-initial sm:max-w-[210px] truncate cursor-pointer tactile-press"
          >
            {datasetOptions.map((ds) => (
              <option key={ds.id} value={ds.id}>
                {ds.name}
              </option>
            ))}
          </select>
        </div>

        {/* Mobile Header Right Actions */}
        <div className="flex sm:hidden items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onOpenFilterSheet}
            aria-label="Open data filters"
            className="relative flex items-center justify-center w-8 h-8 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/80 rounded-xl tactile-press cursor-pointer"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-slate-300" />
            {activeFilterCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-slate-700 border border-slate-600 text-slate-100 text-[10px] font-bold flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={onOpenDataModal}
            aria-label="Open Sheet Link and Data Source"
            className="flex items-center gap-1 text-xs font-medium text-slate-100 bg-slate-800 hover:bg-slate-700 border border-slate-700/80 rounded-xl px-2.5 py-1.5 tactile-press shadow-xs whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Link2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>Sheet Link</span>
          </button>
        </div>

        {/* Desktop Header Actions */}
        <div className="hidden sm:flex items-center gap-2 shrink-0">
          {/* Quick Month Range Trigger */}
          <button
            type="button"
            onClick={onOpenMonthPicker}
            aria-label="Adjust custom month range"
            className="flex items-center gap-1.5 text-xs bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 border border-slate-700/80 rounded-xl px-3 py-1.5 tactile-press whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <span className="font-medium text-slate-200">{monthRangeLabel}</span>
          </button>

          {/* Filter trigger */}
          <button
            type="button"
            onClick={onOpenFilterSheet}
            aria-label="Open data filters"
            className="relative flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700/80 text-slate-200 border border-slate-700/80 rounded-xl px-3 py-1.5 tactile-press cursor-pointer"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" />
            <span>Filters</span>
            {activeFilterCount > 0 && (
              <span className="w-4 h-4 rounded-full bg-slate-700 text-slate-100 text-[10px] font-bold flex items-center justify-center border border-slate-600">
                {activeFilterCount}
              </span>
            )}
          </button>

          {/* Device Frame Viewport Toggle */}
          <button
            type="button"
            onClick={onToggleMobileFrame}
            title={isMobileFrame ? 'Expand to Full View' : 'Simulate Mobile Frame'}
            aria-label="Toggle mobile device frame"
            className="hidden md:flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700/80 text-slate-300 border border-slate-700/80 rounded-xl px-3 py-1.5 tactile-press cursor-pointer"
          >
            {isMobileFrame ? (
              <>
                <Monitor className="w-3.5 h-3.5 text-slate-400" />
                <span>Full View</span>
              </>
            ) : (
              <>
                <Smartphone className="w-3.5 h-3.5 text-slate-400" />
                <span>Mobile Frame</span>
              </>
            )}
          </button>

          {/* Sheet Link Primary Data Source Button */}
          <button
            type="button"
            onClick={onOpenDataModal}
            aria-label="Open Sheet Link and Data Source"
            className="flex items-center gap-1.5 text-xs font-medium text-slate-100 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl px-3.5 py-1.5 tactile-press shadow-xs cursor-pointer whitespace-nowrap"
          >
            <Link2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>Sheet Link</span>
          </button>
        </div>
      </div>
    </header>
  );
};
