import React from 'react';
import { motion } from 'motion/react';
import { LayoutDashboard, BrainCircuit, PieChart, BarChart2, Link2 } from 'lucide-react';

export type ActiveTab = 'overview' | 'ai' | 'breakdowns' | 'chartform' | 'sources';

interface BottomNavProps {
  activeTab: ActiveTab;
  onChangeTab: (tab: ActiveTab) => void;
  onOpenDataSources: () => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onChangeTab,
  onOpenDataSources,
}) => {
  const tabs = [
    {
      id: 'overview' as ActiveTab,
      label: 'Overview',
      icon: LayoutDashboard,
    },
    {
      id: 'ai' as ActiveTab,
      label: 'AI Insights',
      icon: BrainCircuit,
    },
    {
      id: 'breakdowns' as ActiveTab,
      label: 'Breakdowns',
      icon: PieChart,
    },
    {
      id: 'chartform' as ActiveTab,
      label: 'Chart Form',
      icon: BarChart2,
    },
    {
      id: 'sources' as ActiveTab,
      label: 'Sheet Link',
      icon: Link2,
      action: onOpenDataSources,
    },
  ];

  return (
    <nav
      aria-label="Mobile Navigation"
      className="fixed bottom-0 left-0 right-0 z-40 bg-slate-900/95 backdrop-blur-md border-t border-slate-800 md:hidden"
    >
      <div className="grid grid-cols-5 items-center h-16 max-w-md mx-auto px-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <motion.button
              key={tab.id}
              type="button"
              whileTap={{ scale: 0.92 }}
              onClick={() => {
                if (tab.action) {
                  tab.action();
                } else {
                  onChangeTab(tab.id);
                }
              }}
              className="flex flex-col items-center justify-center min-h-[44px] min-w-[44px] py-1 px-0.5 text-center transition-colors relative cursor-pointer"
            >
              <div className="relative p-1.5 rounded-lg">
                {isActive && (
                  <motion.span
                    layoutId="mobile-bottom-nav-pill"
                    transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                    className="absolute inset-0 rounded-lg bg-emerald-500/15 border border-emerald-500/30"
                  />
                )}
                <Icon
                  className={`w-5 h-5 relative z-10 transition-colors ${
                    isActive ? 'text-emerald-400' : 'text-slate-400'
                  }`}
                />
              </div>
              <span
                className={`text-[10px] font-medium tracking-tight mt-0.5 whitespace-nowrap transition-colors ${
                  isActive ? 'text-emerald-400 font-semibold' : 'text-slate-400'
                }`}
              >
                {tab.label}
              </span>
            </motion.button>
          );
        })}
      </div>
    </nav>
  );
};
