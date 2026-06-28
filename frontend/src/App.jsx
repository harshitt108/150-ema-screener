import { useState } from 'react'
import FilterPanel from './components/FilterPanel'
import ResultsTable from './components/ResultsTable'
import { Activity, TrendingUp } from 'lucide-react'
import './index.css'

const DEFAULT_FILTERS = {
  indices: ['NIFTY 50'],
  timeframe: 'daily',
  emaPeriod: 150,
  condition: 'near_ema',
  distancePct: 3,
  crossLookback: 3,
}

const API_BASE = 'http://localhost:8000'

export default function App() {
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [results, setResults] = useState([])
  const [scanning, setScanning] = useState(false)
  const [scanned, setScanned] = useState(null)
  const [error, setError] = useState(null)
  const [hasScanned, setHasScanned] = useState(false)

  const handleScan = async () => {
    setScanning(true)
    setError(null)
    try {
      const resp = await fetch(`${API_BASE}/api/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          indices: filters.indices,
          timeframe: filters.timeframe,
          ema_period: filters.emaPeriod,
          condition: filters.condition,
          distance_pct: filters.distancePct,
          cross_lookback: filters.crossLookback,
        }),
      })
      if (!resp.ok) {
        const err = await resp.json()
        throw new Error(err.detail || 'Scan failed')
      }
      const data = await resp.json()
      setResults(data.results)
      setScanned(data.scanned)
      setHasScanned(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setScanning(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a12] text-slate-200">
      {/* Header */}
      <header className="border-b border-[#1a1a2a] bg-[#0d0d18]">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center">
              <TrendingUp size={16} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white leading-none">NSE EMA Scanner</h1>
              <p className="text-xs text-slate-500 mt-0.5">Real-time moving average scanner for Indian stocks</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Activity size={12} className="text-emerald-500" />
            <span>Live NSE Data via Yahoo Finance</span>
          </div>
        </div>
      </header>

      {/* Main layout */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex gap-6">
          {/* Sidebar filters */}
          <aside className="w-72 flex-shrink-0">
            <div className="sticky top-6">
              <FilterPanel
                filters={filters}
                onChange={setFilters}
                onScan={handleScan}
                scanning={scanning}
                resultCount={hasScanned ? results.length : null}
              />
            </div>
          </aside>

          {/* Results area */}
          <main className="flex-1 min-w-0">
            {error && (
              <div className="mb-4 p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-sm">
                <strong>Error:</strong> {error}
              </div>
            )}

            {!hasScanned && !scanning && (
              <div className="flex flex-col items-center justify-center py-24 text-slate-500">
                <div className="w-16 h-16 rounded-2xl bg-[#13131f] border border-[#1e1e30] flex items-center justify-center mb-6">
                  <TrendingUp size={28} className="text-violet-600" />
                </div>
                <h2 className="text-xl font-semibold text-slate-300 mb-2">Ready to Scan</h2>
                <p className="text-sm text-center max-w-xs text-slate-500 leading-relaxed">
                  Configure your filters and click{' '}
                  <span className="text-violet-400 font-medium">Scan Stocks</span> to find
                  Indian stocks interacting with their moving averages.
                </p>
                <div className="mt-8 grid grid-cols-3 gap-4 text-center">
                  {[
                    { label: 'Near EMA', desc: 'Within ±3% of EMA' },
                    { label: 'Cross Above', desc: 'Recent bullish cross' },
                    { label: 'Cross Below', desc: 'Recent bearish cross' },
                  ].map(item => (
                    <div key={item.label} className="p-4 bg-[#13131f] border border-[#1e1e30] rounded-xl">
                      <p className="text-sm font-medium text-slate-300">{item.label}</p>
                      <p className="text-xs text-slate-600 mt-1">{item.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {scanning && (
              <div className="flex flex-col items-center justify-center py-24">
                <div className="relative w-16 h-16">
                  <div className="absolute inset-0 border-4 border-[#1e1e30] rounded-full" />
                  <div className="absolute inset-0 border-4 border-t-violet-500 rounded-full animate-spin" />
                </div>
                <p className="mt-6 text-slate-400 font-medium">Scanning stocks...</p>
                <p className="mt-1 text-sm text-slate-600">Fetching data and calculating EMAs</p>
              </div>
            )}

            {hasScanned && !scanning && (
              <ResultsTable results={results} scanned={scanned} />
            )}
          </main>
        </div>
      </div>
    </div>
  )
}
