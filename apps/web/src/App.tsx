import React, { useState } from 'react';
import { mmToLitres } from '@irrigiq/shared';

export function App(): React.JSX.Element {
  const [depthMm, setDepthMm] = useState<number>(18);
  const [areaHa, setAreaHa] = useState<number>(1.5);

  const litres = mmToLitres(depthMm, areaHa);

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col justify-between p-6 md:p-12">
      <header className="max-w-5xl mx-auto w-full flex items-center justify-between border-b border-slate-800 pb-6">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center font-bold text-slate-950 text-xl shadow-lg shadow-emerald-500/20">
            IQ
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              IrrigIQ{' '}
              <span className="text-xs bg-emerald-500/20 text-emerald-400 font-medium px-2 py-0.5 rounded-full border border-emerald-500/30">
                v1.0 Skeleton
              </span>
            </h1>
            <p className="text-xs text-slate-400 font-medium">
              इरिगआईक्यू — जल-बचत सिंचाई योजनाकार
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-400 border border-slate-800 px-3 py-1.5 rounded-lg bg-slate-800/50">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          <span>Phase 1 Skeleton Ready</span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto w-full my-auto py-12 grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
        <div className="space-y-6">
          <div className="inline-block rounded-full bg-emerald-950/60 border border-emerald-800/50 px-3.5 py-1 text-xs text-emerald-300">
            स्मार्ट सिंचाई सलाह • Smart Irrigation Advisory
          </div>
          <h2 className="text-4xl sm:text-5xl font-extrabold tracking-tight leading-tight">
            Scientific Water Planning for{' '}
            <span className="text-emerald-400">Smallholder Farms</span>.
          </h2>
          <p className="text-slate-300 text-base leading-relaxed">
            FAO-56 Penman-Monteith science, localized weather forecast caching, offline-first PWA,
            and Hindi + English recommendations.
          </p>

          <div className="grid grid-cols-2 gap-4 pt-2">
            <div className="p-4 rounded-xl bg-slate-800/60 border border-slate-800">
              <div className="text-sm font-semibold text-slate-200">Daily Forecast</div>
              <div className="text-xs text-slate-400 mt-1">
                Open-Meteo ET0 with 0.1° grid caching
              </div>
            </div>
            <div className="p-4 rounded-xl bg-slate-800/60 border border-slate-800">
              <div className="text-sm font-semibold text-slate-200">Measurable Impact</div>
              <div className="text-xs text-slate-400 mt-1">Water saved reports in Litres</div>
            </div>
          </div>
        </div>

        <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-6 shadow-2xl backdrop-blur-sm space-y-6">
          <div className="border-b border-slate-700/60 pb-4">
            <h3 className="text-lg font-bold text-white">Live Science Verification</h3>
            <p className="text-xs text-slate-400">Pure FAO-56 conversion from @irrigiq/shared</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Irrigation Depth (mm) / सिंचाई गहराई
              </label>
              <input
                type="number"
                min="0"
                max="100"
                value={depthMm}
                onChange={(e) => setDepthMm(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Field Area (Hectares) / खेत का क्षेत्रफल
              </label>
              <input
                type="number"
                min="0.01"
                step="0.1"
                value={areaHa}
                onChange={(e) => setAreaHa(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="bg-emerald-950/40 border border-emerald-800/40 rounded-xl p-4 text-center">
              <span className="text-xs text-emerald-400 uppercase tracking-wider font-semibold">
                Total Water Volume
              </span>
              <div className="text-3xl font-extrabold text-emerald-300 mt-1">
                {litres.toLocaleString('en-IN')}{' '}
                <span className="text-sm font-normal text-slate-400">Litres (लीटर)</span>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="max-w-5xl mx-auto w-full border-t border-slate-800 pt-6 text-xs text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>IrrigIQ © 2026 • FAO-56 Based Irrigation Planner</div>
        <div className="flex gap-4">
          <span>React 19</span>
          <span>•</span>
          <span>Tailwind v4</span>
          <span>•</span>
          <span>TypeScript Strict</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
