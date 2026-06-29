import { useState } from 'react'
import FilterPanel from './components/FilterPanel'
import ResultsTable from './components/ResultsTable'
import RSResultsTable from './components/RSResultsTable'
import StockDetailPanel from './components/StockDetailPanel'
import WatchlistPanel from './components/WatchlistPanel'
import useWatchlist from './hooks/useWatchlist'
import { Activity, TrendingUp, PanelLeftClose, PanelLeftOpen, SlidersHorizontal, Star } from 'lucide-react'
import './index.css'

const DEFAULT_PRICE_FILTERS = {
  indices: ['NIFTY 50'],
  timeframe: 'daily',
  emaPeriod: 150,
  condition: 'near_ema',
  distancePct: 3,
  crossLookback: 3,
}

const DEFAULT_RS_FILTERS = {
  indices: ['NIFTY 50'],
  timeframe: 'daily',
  benchmark: 'NIFTY 50',
  emaPeriod: 150,
  rsCondition: 'above_ema',
  distancePct: 3,
  crossLookback: 3,
  rsTrendFilter: 'Any',
  enablePriceFilter: false,
  priceCondition: 'near_ema',
  priceEmaPeriod: 150,
  priceDistancePct: 3,
}

const API_BASE = 'http://localhost:8000'

export default function App() {
  const [scanMode, setScanMode] = useState('price')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [selectedStock, setSelectedStock] = useState(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [watchlistOpen, setWatchlistOpen] = useState(false)
  const watchlist = useWatchlist()
  const [priceFilters, setPriceFilters] = useState(DEFAULT_PRICE_FILTERS)
  const [rsFilters, setRsFilters] = useState(DEFAULT_RS_FILTERS)

  const [priceResults, setPriceResults] = useState([])
  const [rsResults, setRsResults] = useState([])
  const [scanning, setScanning] = useState(false)
  const [scanned, setScanned] = useState(null)
  const [noData, setNoData] = useState([])
  const [error, setError] = useState(null)
  const [hasScanned, setHasScanned] = useState(false)

  const handleModeChange = (mode) => {
    setScanMode(mode)
    setHasScanned(false)
    setError(null)
  }

  const handleScan = async () => {
    setScanning(true)
    setError(null)
    setHasScanned(false)
    try {
      if (scanMode === 'price') {
        const resp = await fetch(`${API_BASE}/api/scan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            indices: priceFilters.indices,
            timeframe: priceFilters.timeframe,
            ema_period: priceFilters.emaPeriod,
            condition: priceFilters.condition,
            distance_pct: priceFilters.distancePct,
            cross_lookback: priceFilters.crossLookback,
          }),
        })
        if (!resp.ok) throw new Error((await resp.json()).detail || 'Scan failed')
        const data = await resp.json()
        setPriceResults(data.results)
        setScanned(data.scanned)
        setNoData(data.noData || [])
      } else {
        const resp = await fetch(`${API_BASE}/api/rs-scan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            indices: rsFilters.indices,
            timeframe: rsFilters.timeframe,
            benchmark: rsFilters.benchmark,
            ema_period: rsFilters.emaPeriod,
            rs_condition: rsFilters.rsCondition,
            distance_pct: rsFilters.distancePct,
            cross_lookback: rsFilters.crossLookback,
            rs_trend_filter: rsFilters.rsTrendFilter,
            price_condition: rsFilters.enablePriceFilter ? rsFilters.priceCondition : null,
            price_ema_period: rsFilters.priceEmaPeriod,
            price_distance_pct: rsFilters.priceDistancePct,
          }),
        })
        if (!resp.ok) throw new Error((await resp.json()).detail || 'RS Scan failed')
        const data = await resp.json()
        setRsResults(data.results)
        setScanned(data.scanned)
        setNoData(data.noData || [])
      }
      setHasScanned(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setScanning(false)
    }
  }

  const resultCount = hasScanned
    ? (scanMode === 'price' ? priceResults.length : rsResults.length)
    : null

  const activeTimeframe = scanMode === 'price' ? priceFilters.timeframe : rsFilters.timeframe
  const activeResults   = scanMode === 'price' ? priceResults : rsResults

  const openStock = (row, idx) => {
    setSelectedStock(row)
    setSelectedIndex(idx)
  }
  const navigateTo = (idx) => {
    if (idx >= 0 && idx < activeResults.length) {
      setSelectedIndex(idx)
      setSelectedStock(activeResults[idx])
    }
  }

  return (
    <>
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
              <p className="text-xs text-slate-500 mt-0.5">Price EMA & Relative Strength scanner for Indian stocks</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setWatchlistOpen(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors
                ${watchlist.lists.length > 0
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20'
                  : 'bg-[#13131f] border-[#2d2d45] text-slate-400 hover:text-amber-400 hover:border-amber-500/30'
                }`}
            >
              <Star size={13} className={watchlist.isWatched('__any__') || watchlist.lists.length > 0 ? '' : ''} />
              Watchlist
              {watchlist.lists.length > 0 && (
                <span className="bg-amber-500/20 text-amber-400 rounded px-1">
                  {watchlist.lists.reduce((s,l)=>s+l.stocks.length,0)}
                </span>
              )}
            </button>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Activity size={12} className="text-emerald-500" />
              <span>Live NSE Data via Yahoo Finance</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main layout */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex gap-6 items-start">

          {/* Collapsible sidebar */}
          <aside
            className="flex-shrink-0 overflow-hidden transition-all duration-300 ease-in-out"
            style={{ width: sidebarOpen ? '288px' : '0px', opacity: sidebarOpen ? 1 : 0 }}
          >
            <div className="w-72 sticky top-6">
              <FilterPanel
                scanMode={scanMode}
                onModeChange={handleModeChange}
                filters={priceFilters}
                onFiltersChange={setPriceFilters}
                rsFilters={rsFilters}
                onRsFiltersChange={setRsFilters}
                onScan={handleScan}
                scanning={scanning}
                resultCount={resultCount}
              />
            </div>
          </aside>

          {/* Results area */}
          <main className="flex-1 min-w-0">
            {/* Toolbar row */}
            <div className="flex items-center gap-3 mb-4">
              <button
                onClick={() => setSidebarOpen(o => !o)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#2d2d45]
                  bg-[#13131f] text-slate-400 hover:text-slate-200 hover:border-violet-500/50
                  text-xs font-medium transition-colors flex-shrink-0"
                title={sidebarOpen ? 'Hide filters' : 'Show filters'}
              >
                {sidebarOpen
                  ? <><PanelLeftClose size={14} /> Hide Filters</>
                  : <><PanelLeftOpen size={14} /> Show Filters</>
                }
              </button>

              {/* Quick re-scan button when sidebar is hidden */}
              {!sidebarOpen && (
                <button
                  onClick={handleScan}
                  disabled={scanning}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg
                    bg-violet-600 hover:bg-violet-500 disabled:opacity-60
                    text-white text-xs font-semibold transition-colors flex-shrink-0"
                >
                  {scanning
                    ? <><div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Scanning...</>
                    : <><SlidersHorizontal size={13} /> Re-scan</>
                  }
                </button>
              )}
            </div>

            {error && (
              <div className="mb-4 p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-sm">
                <strong>Error:</strong> {error}
              </div>
            )}

            {hasScanned && !scanning && noData.length > 0 && (
              <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400 text-xs">
                <strong>{noData.length}</strong> symbol{noData.length > 1 ? 's' : ''} could not be fetched and {noData.length > 1 ? 'were' : 'was'} excluded:{' '}
                <span className="text-amber-300 font-mono">{noData.join(', ')}</span>
              </div>
            )}

            {!hasScanned && !scanning && (
              <EmptyState scanMode={scanMode} />
            )}

            {scanning && <ScanningSpinner />}

            {hasScanned && !scanning && scanMode === 'price' && (
              <ResultsTable
                results={priceResults}
                scanned={scanned}
                onRowClick={(row, idx) => openStock(row, idx)}
                watchlist={watchlist}
              />
            )}

            {hasScanned && !scanning && scanMode === 'rs' && (
              <RSResultsTable
                results={rsResults}
                scanned={scanned}
                hasPriceFilter={rsFilters.enablePriceFilter}
                priceEmaPeriod={rsFilters.enablePriceFilter ? rsFilters.priceEmaPeriod : rsFilters.emaPeriod}
                ratioEmaPeriod={rsFilters.emaPeriod}
                onRowClick={(row, idx) => openStock(row, idx)}
                watchlist={watchlist}
              />
            )}
          </main>
        </div>
      </div>
    </div>

    {selectedStock && (
      <StockDetailPanel
        stock={selectedStock}
        timeframe={activeTimeframe}
        onClose={() => setSelectedStock(null)}
        onPrev={() => navigateTo(selectedIndex - 1)}
        onNext={() => navigateTo(selectedIndex + 1)}
        currentIndex={selectedIndex}
        totalCount={activeResults.length}
        watchlist={watchlist}
      />
    )}

    {watchlistOpen && (
      <WatchlistPanel
        watchlist={watchlist}
        onClose={() => setWatchlistOpen(false)}
        onScanWatchlist={(list) => {
          // Future: scan watchlist stocks
        }}
      />
    )}
    </>
  )
}

function EmptyState({ scanMode }) {
  const priceHints = [
    { label: 'Near EMA',    desc: 'Within ±3% of EMA' },
    { label: 'Cross Above', desc: 'Recent bullish cross' },
    { label: 'Cross Below', desc: 'Recent bearish cross' },
  ]
  const rsHints = [
    { label: 'Ratio Above EMA',   desc: 'Outperforming benchmark' },
    { label: 'Ratio Cross Above', desc: 'RS momentum turning bullish' },
    { label: 'RS Trend Rising',   desc: 'Sustained outperformance' },
  ]
  const hints = scanMode === 'rs' ? rsHints : priceHints

  return (
    <div className="flex flex-col items-center justify-center py-24 text-slate-500">
      <div className="w-16 h-16 rounded-2xl bg-[#13131f] border border-[#1e1e30] flex items-center justify-center mb-6">
        <TrendingUp size={28} className="text-violet-600" />
      </div>
      <h2 className="text-xl font-semibold text-slate-300 mb-2">Ready to Scan</h2>
      <p className="text-sm text-center max-w-xs text-slate-500 leading-relaxed">
        {scanMode === 'rs'
          ? <>Configure your relative strength filters and click <span className="text-violet-400 font-medium">Scan Stocks</span> to find leaders vs their benchmark.</>
          : <>Configure your filters and click <span className="text-violet-400 font-medium">Scan Stocks</span> to find Indian stocks interacting with their moving averages.</>
        }
      </p>
      <div className="mt-8 grid grid-cols-3 gap-4 text-center">
        {hints.map(item => (
          <div key={item.label} className="p-4 bg-[#13131f] border border-[#1e1e30] rounded-xl">
            <p className="text-sm font-medium text-slate-300">{item.label}</p>
            <p className="text-xs text-slate-600 mt-1">{item.desc}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function ScanningSpinner() {
  return (
    <div className="flex flex-col items-center justify-center py-24">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 border-4 border-[#1e1e30] rounded-full" />
        <div className="absolute inset-0 border-4 border-t-violet-500 rounded-full animate-spin" />
      </div>
      <p className="mt-6 text-slate-400 font-medium">Scanning stocks...</p>
      <p className="mt-1 text-sm text-slate-600">Fetching data and computing signals</p>
    </div>
  )
}
