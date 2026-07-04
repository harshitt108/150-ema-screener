import { useState } from 'react'
import FilterPanel from './components/FilterPanel'
import ResultsTable from './components/ResultsTable'
import RSResultsTable from './components/RSResultsTable'
import StockDetailPanel from './components/StockDetailPanel'
import WatchlistPanel from './components/WatchlistPanel'
import StockSearch from './components/StockSearch'
import IndexScanner from './components/IndexScanner'
import RatingScreener from './components/RatingScreener'
import BreakoutScreener from './components/BreakoutScreener'
import useWatchlist from './hooks/useWatchlist'
import useRecentSearches from './hooks/useRecentSearches'
import PortfolioList from './pages/PortfolioList'
import PortfolioDetail from './pages/PortfolioDetail'
import EmailConfigModal from './components/portfolio/EmailConfigModal'
import Toaster from './components/Toast'
import { Activity, TrendingUp, PanelLeftClose, PanelLeftOpen, SlidersHorizontal, Star, Briefcase, Mail, Search, Layers, Gauge, Rocket } from 'lucide-react'
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

import { API_BASE } from './apiBase'

export default function App() {
  // Top-level navigation: 'scanner' | 'portfolios'
  const [topNav, setTopNav] = useState('scanner')
  const [openPortfolioId, setOpenPortfolioId] = useState(null)
  const [showEmailConfig, setShowEmailConfig] = useState(false)

  const [scanMode, setScanMode] = useState('price')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [selectedStock, setSelectedStock] = useState(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [watchlistOpen, setWatchlistOpen] = useState(false)
  const [wlDetail, setWlDetail] = useState(null)  // { stocks, index, timeframe } for watchlist chart panel
  const [searchStock, setSearchStock] = useState(null)  // stock opened from the Search module
  const watchlist = useWatchlist()
  const recentSearches = useRecentSearches()
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

  const handleScan = async (overrideSymbols = null) => {
    // A watchlist scan passes an explicit symbol list and always runs in price mode.
    const watchlistSymbols = Array.isArray(overrideSymbols) && overrideSymbols.length
      ? overrideSymbols : null
    const mode = watchlistSymbols ? 'price' : scanMode
    setScanning(true)
    setError(null)
    setHasScanned(false)
    try {
      if (mode === 'price') {
        const resp = await fetch(`${API_BASE}/api/scan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            indices: priceFilters.indices,
            symbols: watchlistSymbols,
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
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          {/* Brand */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center">
              <TrendingUp size={16} className="text-white" />
            </div>
            <h1 className="text-base font-bold text-white leading-none hidden sm:block">NSE Toolkit</h1>
          </div>

          {/* Top nav tabs */}
          <nav className="flex items-center gap-1 bg-[#13131f] border border-[#1e1e30] rounded-xl p-1">
            <button
              onClick={() => setTopNav('scanner')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all
                ${topNav === 'scanner'
                  ? 'bg-violet-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
                }`}
            >
              <TrendingUp size={13} />
              EMA Scanner
            </button>
            <button
              onClick={() => setTopNav('search')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all
                ${topNav === 'search'
                  ? 'bg-violet-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
                }`}
            >
              <Search size={13} />
              Search Charts
            </button>
            <button
              onClick={() => setTopNav('indices')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all
                ${topNav === 'indices'
                  ? 'bg-violet-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
                }`}
            >
              <Layers size={13} />
              Index Scanner
            </button>
            <button
              onClick={() => setTopNav('rating')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all
                ${topNav === 'rating'
                  ? 'bg-violet-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
                }`}
            >
              <Gauge size={13} />
              Rating Screener
            </button>
            <button
              onClick={() => setTopNav('breakout')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all
                ${topNav === 'breakout'
                  ? 'bg-violet-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
                }`}
            >
              <Rocket size={13} />
              Breakout Screener
            </button>
            <button
              onClick={() => { setTopNav('portfolios'); setOpenPortfolioId(null) }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all
                ${topNav === 'portfolios'
                  ? 'bg-violet-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
                }`}
            >
              <Briefcase size={13} />
              Portfolio Guardian
            </button>
          </nav>

          {/* Right side actions */}
          <div className="flex items-center gap-3 flex-shrink-0">
            {(topNav === 'scanner' || topNav === 'rating' || topNav === 'breakout') && (
              <button
                onClick={() => setWatchlistOpen(true)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors
                  ${watchlist.lists.length > 0
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20'
                    : 'bg-[#13131f] border-[#2d2d45] text-slate-400 hover:text-amber-400 hover:border-amber-500/30'
                  }`}
              >
                <Star size={13} />
                Watchlist
                {watchlist.lists.length > 0 && (
                  <span className="bg-amber-500/20 text-amber-400 rounded px-1">
                    {watchlist.lists.reduce((s,l)=>s+l.stocks.length,0)}
                  </span>
                )}
              </button>
            )}
            {topNav === 'portfolios' && (
              <button
                onClick={() => setShowEmailConfig(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2d2d45]
                  bg-[#13131f] text-slate-400 hover:text-violet-400 hover:border-violet-500/40
                  text-xs font-medium transition-colors"
                title="Email configuration"
              >
                <Mail size={13} />
                <span className="hidden sm:inline">Email Setup</span>
              </button>
            )}
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Activity size={12} className="text-emerald-500" />
              <span className="hidden sm:inline">Live NSE Data</span>
            </div>
          </div>
        </div>
      </header>

      {/* Portfolio Guardian view */}
      {topNav === 'portfolios' && (
        openPortfolioId
          ? <PortfolioDetail
              portfolioId={openPortfolioId}
              onBack={() => setOpenPortfolioId(null)}
            />
          : <PortfolioList
              onOpen={(p) => setOpenPortfolioId(p.id)}
            />
      )}

      {/* Search Charts module */}
      {topNav === 'search' && (
        <StockSearch
          recentSearches={recentSearches}
          onSelect={(s) => {
            recentSearches.addRecent(s)
            setSearchStock({ symbol: s.symbol, name: s.name, ltp: null, benchmark: 'NIFTY 50' })
          }}
        />
      )}

      {/* Index Scanner module */}
      {topNav === 'indices' && <IndexScanner />}

      {/* Rating Screener module */}
      {topNav === 'rating' && <RatingScreener watchlist={watchlist} />}

      {/* Breakout Screener module */}
      {topNav === 'breakout' && <BreakoutScreener watchlist={watchlist} />}

      {/* Scanner main layout */}
      {topNav === 'scanner' && <div className="max-w-7xl mx-auto px-4 py-6">
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
      </div>}
    </div>

    {showEmailConfig && (
      <EmailConfigModal onClose={() => setShowEmailConfig(false)} />
    )}

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
          const syms = (list?.stocks || []).map(s => s.symbol).filter(Boolean)
          if (!syms.length) return
          setTopNav('scanner')  // watchlist scans render in the EMA Scanner view
          setScanMode('price')
          handleScan(syms)
        }}
        onOpenStock={(stocks, index, timeframe) => setWlDetail({ stocks, index, timeframe })}
      />
    )}

    {/* Chart panel for a stock opened from the Search module (no prev/next set) */}
    {searchStock && (
      <StockDetailPanel
        stock={searchStock}
        timeframe="daily"
        onClose={() => setSearchStock(null)}
        currentIndex={0}
        totalCount={0}
        watchlist={watchlist}
        keepTimeframeAcrossStocks
      />
    )}

    {/* Chart panel for a watchlist stock — prev/next navigates within the list */}
    {wlDetail && (
      <StockDetailPanel
        stock={wlDetail.stocks[wlDetail.index]}
        timeframe={wlDetail.timeframe}
        onClose={() => setWlDetail(null)}
        onPrev={() => setWlDetail(d => d && d.index > 0 ? { ...d, index: d.index - 1 } : d)}
        onNext={() => setWlDetail(d => d && d.index < d.stocks.length - 1 ? { ...d, index: d.index + 1 } : d)}
        currentIndex={wlDetail.index}
        totalCount={wlDetail.stocks.length}
        watchlist={watchlist}
        keepTimeframeAcrossStocks
      />
    )}

    <Toaster />
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
