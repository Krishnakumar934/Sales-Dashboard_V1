import React, { useState } from 'react';
import {
  Download,
  Smartphone,
  Share,
  PlusSquare,
  ShieldCheck,
  X,
  CheckCircle2,
  Package,
  ExternalLink,
  Laptop,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { createPortal } from 'react-dom';
import { usePWAInstall } from '../hooks/usePWAInstall.ts';

interface PWAInstallButtonProps {
  compact?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showModal, setShowModal] = useState(false);
  const [activePlatform, setActivePlatform] = useState<'android' | 'ios' | 'apk'>(() =>
    isIOS ? 'ios' : 'android'
  );
  const [copiedLink, setCopiedLink] = useState(false);

  // Automatically hide when running as an installed standalone app
  if (isInstalled) {
    return null;
  }

  const handleButtonClick = async () => {
    if (isInstallable) {
      const installed = await install();
      if (!installed) {
        setShowModal(true);
      }
    } else {
      setShowModal(true);
    }
  };

  const handleCopyLink = () => {
    try {
      const url = window.location.href;
      void navigator.clipboard.writeText(url);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      // fallback
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleButtonClick}
        aria-label="Install PulseGrid as Mobile App"
        title="Install PulseGrid as Mobile App"
        className={`flex items-center gap-1.5 text-xs font-semibold text-emerald-300 bg-emerald-950/60 hover:bg-emerald-900/70 border border-emerald-700/60 rounded-xl tactile-press cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
          compact ? 'px-2.5 py-1.5' : 'px-3 py-1.5'
        }`}
      >
        <Smartphone className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        <span>{compact ? 'Install' : 'Install App'}</span>
      </button>

      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {showModal && (
              <motion.div
                key="pwa-install-modal-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowModal(false)}
                className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-3 sm:p-4 overflow-y-auto"
              >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 14 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 14 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700/90 p-5 shadow-2xl text-slate-100 flex flex-col my-auto"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
                    <Smartphone className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-white">Use as Mobile App</h3>
                    <p className="text-xs text-slate-400">
                      Install on phone home screen or package as native APK
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  aria-label="Close mobile app instructions"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Platform Switcher */}
              <div className="grid grid-cols-3 gap-1.5 bg-slate-950/80 p-1 rounded-xl border border-slate-800 mt-4 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setActivePlatform('android')}
                  className={`py-1.5 rounded-lg transition-colors cursor-pointer text-center ${
                    activePlatform === 'android'
                      ? 'bg-emerald-600 text-white font-semibold shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Android
                </button>
                <button
                  type="button"
                  onClick={() => setActivePlatform('ios')}
                  className={`py-1.5 rounded-lg transition-colors cursor-pointer text-center ${
                    activePlatform === 'ios'
                      ? 'bg-cyan-600 text-white font-semibold shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  iPhone / iOS
                </button>
                <button
                  type="button"
                  onClick={() => setActivePlatform('apk')}
                  className={`py-1.5 rounded-lg transition-colors cursor-pointer text-center ${
                    activePlatform === 'apk'
                      ? 'bg-indigo-600 text-white font-semibold shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Native APK
                </button>
              </div>

              {/* Content Panel */}
              <div className="mt-4 space-y-3">
                {activePlatform === 'android' && (
                  <div className="space-y-2.5 text-xs text-slate-300">
                    {isInstallable && (
                      <button
                        type="button"
                        onClick={async () => {
                          const done = await install();
                          if (done) setShowModal(false);
                        }}
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors cursor-pointer mb-3 shadow-xs"
                      >
                        <Download className="w-4 h-4" />
                        <span>Tap Here to Install Immediately</span>
                      </button>
                    )}
                    <div className="flex items-start gap-2.5 rounded-xl bg-slate-950/60 border border-slate-800 p-3">
                      <span className="w-5 h-5 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-[10px] font-bold text-emerald-400 shrink-0">
                        1
                      </span>
                      <p>
                        Open this link in <strong className="text-white">Google Chrome</strong> on your Android phone.
                      </p>
                    </div>
                    <div className="flex items-start gap-2.5 rounded-xl bg-slate-950/60 border border-slate-800 p-3">
                      <span className="w-5 h-5 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-[10px] font-bold text-emerald-400 shrink-0">
                        2
                      </span>
                      <p>
                        Tap the <strong className="text-white">three dots menu (⋮)</strong> at the top right of Chrome.
                      </p>
                    </div>
                    <div className="flex items-start gap-2.5 rounded-xl bg-slate-950/60 border border-slate-800 p-3">
                      <span className="w-5 h-5 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-[10px] font-bold text-emerald-400 shrink-0">
                        3
                      </span>
                      <p>
                        Tap <strong className="text-white">&quot;Install app&quot;</strong> or <strong className="text-white">&quot;Add to Home screen&quot;</strong>.
                      </p>
                    </div>
                    <div className="flex items-start gap-2 rounded-xl bg-emerald-950/25 border border-emerald-800/40 p-2.5 text-emerald-200/90 text-[11px]">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span>
                        PulseGrid will install with its own app icon on your phone, opening full-screen like a native Android app without any browser address bar!
                      </span>
                    </div>
                  </div>
                )}

                {activePlatform === 'ios' && (
                  <div className="space-y-2.5 text-xs text-slate-300">
                    <div className="flex items-start gap-2.5 rounded-xl bg-slate-950/60 border border-slate-800 p-3">
                      <Share className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                      <p>
                        1. Open this link in <strong className="text-white">Safari</strong> on your iPhone or iPad, then tap the <strong className="text-white">Share</strong> button (box with upward arrow).
                      </p>
                    </div>
                    <div className="flex items-start gap-2.5 rounded-xl bg-slate-950/60 border border-slate-800 p-3">
                      <PlusSquare className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <p>
                        2. Scroll down and tap <strong className="text-white">Add to Home Screen</strong>, then tap <strong className="text-white">Add</strong> in the top right.
                      </p>
                    </div>
                    <div className="flex items-start gap-2 rounded-xl bg-cyan-950/25 border border-cyan-800/40 p-2.5 text-cyan-200/90 text-[11px]">
                      <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                      <span>
                        Launches as a standalone app with smooth iOS animations and offline caching powered by service workers.
                      </span>
                    </div>
                  </div>
                )}

                {activePlatform === 'apk' && (
                  <div className="space-y-2.5 text-xs text-slate-300">
                    <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3 space-y-2">
                      <div className="flex items-center gap-2 text-indigo-300 font-semibold">
                        <Package className="w-4 h-4" />
                        <span>Build an Android APK with Capacitor</span>
                      </div>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        To generate a standalone <code className="text-emerald-400 font-mono">.apk</code> file for Google Play Store or direct phone installation:
                      </p>
                      <pre className="text-[10px] font-mono bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-slate-200 overflow-x-auto space-y-1">
                        <div># 1. Install Capacitor CLI</div>
                        <div className="text-emerald-400">npm install @capacitor/core @capacitor/cli @capacitor/android</div>
                        <div className="pt-1"># 2. Initialize Capacitor & Add Android</div>
                        <div className="text-emerald-400">npx cap init PulseGrid com.pulsegrid.app</div>
                        <div className="text-emerald-400">npx cap add android</div>
                        <div className="pt-1"># 3. Build & Sync</div>
                        <div className="text-emerald-400">npm run build && npx cap sync</div>
                        <div className="pt-1"># 4. Open Android Studio to export APK</div>
                        <div className="text-emerald-400">npx cap open android</div>
                      </pre>
                    </div>
                    <div className="rounded-xl bg-slate-950/50 border border-slate-800/80 p-2.5 text-[11px] text-slate-400 flex items-center justify-between">
                      <span>Or use <strong>PWABuilder.com</strong> to generate APK online in 1 minute.</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Actions Footer */}
              <div className="flex items-center gap-2 pt-4 mt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200 transition-colors cursor-pointer"
                >
                  {copiedLink ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Link Copied!</span>
                    </>
                  ) : (
                    <>
                      <Share className="w-3.5 h-3.5 text-slate-400" />
                      <span>Share Link to Phone</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="py-2 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-white transition-colors cursor-pointer"
                >
                  Done
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>,
      document.body
    )}
    </>
  );
};

