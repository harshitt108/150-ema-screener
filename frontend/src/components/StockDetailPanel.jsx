import { useEffect, useRef, useState } from 'react'
import { X, TrendingUp, Loader, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import CandleChart from './CandleChart'
import DrawingOverlay from './DrawingOverlay'
import AddToWatchlist from './AddToWatchlist'
import ChartErrorBoundary from './ChartErrorBoundary'
import Accordion from './Accordion'
import BullBearFactors from './BullBearFactors'
import MTFMatrix from './MTFMatrix'
import SignalHistoryList from './SignalHistoryList'
import RatingHistoryChart from './RatingHistoryChart'
import CompareStocks from './CompareStocks'
import FinancialScan from './FinancialScan'

// Fills the flex container, measures real height, passes it to CandleChart.
// Waits 230ms before the first measurement so the panel's slide-in animation
// (200ms) has finished and the container has its final dimensions. After that
// a ResizeObserver keeps the chart sized correctly on window/panel resize.
function ChartAutoHeight({ onReady, ...props }) {
  const ref    = useRef(null)
  const [h, setH] = useState(0)   // 0 = not yet measured → don't render chart

  useEffect(() => {
    if (!ref.current) return

    const measure = () => {
      const rect = ref.current?.getBoundingClientRect()
      if (rect?.height > 0) setH(Math.floor(rect.height))
    }

    // First measurement after animation completes
    const t = setTimeout(measure, 230)

    // Keep up with resizes after initial render
    const ro = new ResizeObserver(([e]) => {
      const newH = Math.floor(e.contentRect.height)
      if (newH > 0) setH(newH)
    })
    ro.observe(ref.current)

    return () => { clearTimeout(t); ro.disconnect() }
  }, [])

  return (
    <div ref={ref} style={{ width: '100%', height: '100%' }}>
      {h > 0 && <CandleChart {...props} height={h} onReady={onReady} />}
    </div>
  )
}


import { API_BASE } from '../apiBase'

// ─── Signal badge ────────────────────────────────────────────────────────────
function SignalBanner({ signals }) {
  if (!signals) return null
  const { signal, bullCount, total, pct } = signals

  const cfg = {
    BUY:  { bg: 'bg-emerald-500/15', border: 'border-emerald-500/40', text: 'text-emerald-400', bar: 'bg-emerald-500' },
    HOLD: { bg: 'bg-amber-500/15',   border: 'border-amber-500/40',   text: 'text-amber-400',   bar: 'bg-amber-500'   },
    SELL: { bg: 'bg-rose-500/15',    border: 'border-rose-500/40',    text: 'text-rose-400',    bar: 'bg-rose-500'    },
  }[signal] || {}

  return (
    <div className={`rounded-xl p-4 border ${cfg.bg} ${cfg.border}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <span className={`text-2xl font-black tracking-wide ${cfg.text}`}>{signal}</span>
          <span className="text-sm text-slate-400">{bullCount} of {total} signals bullish</span>
        </div>
        <span className={`text-xl font-bold ${cfg.text}`}>{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-[#1e1e30] overflow-hidden">
        <div className={`h-full rounded-full transition-all ${cfg.bar}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}


const TIMEFRAMES = [
  { value: '5min',    label: '5m'  },
  { value: '15min',   label: '15m' },
  { value: '30min',   label: '30m' },
  { value: '1h',      label: '1H'  },
  { value: 'daily',   label: '1D'  },
  { value: 'weekly',  label: '1W'  },
  { value: 'monthly', label: '1M'  },
]

// ─── Main panel ──────────────────────────────────────────────────────────────
export default function StockDetailPanel({ stock, timeframe: initialTimeframe, onClose, onPrev, onNext, currentIndex, totalCount, watchlist, keepTimeframeAcrossStocks = false }) {
  const [timeframe,  setTimeframe]  = useState(initialTimeframe || 'daily')
  const [chartData,  setChartData]  = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const chartApiRef    = useRef(null)
  const [chartVersion, setChartVersion] = useState(0)

  // Multi-timeframe matrix, signal history and rating history are independent
  // of the chart's own timeframe switcher — they only depend on the stock and
  // benchmark, so they're fetched once per stock rather than on every tf change.
  const [mtfMatrix,     setMtfMatrix]     = useState(null)
  const [signalHistory, setSignalHistory] = useState(null)
  const [ratingHistory, setRatingHistory] = useState(null)
  // Financials are fetched lazily by <FinancialScan> itself, only when the user
  // expands that section — so the screener.in scrape isn't fired on panel open.

  // stock.signals (passed in from the scan results row) is a snapshot frozen
  // at scan time — it never reflects the timeframe the user picks inside this
  // panel, and goes stale as soon as price moves after the scan ran. Refetch
  // live signals for whichever timeframe/benchmark is currently selected.
  const [liveSignals, setLiveSignals] = useState(null)

  // When parent navigates to a different stock, reset timeframe to the parent's
  // default — this is the right behavior for the EMA / RS screeners, where the
  // scan itself is timeframe-based. In non-screening contexts (Search, Watchlist,
  // Index Scanner, Portfolio Guardian) the caller passes keepTimeframeAcrossStocks
  // so the user's chosen timeframe is preserved as they page through stocks.
  useEffect(() => {
    if (!keepTimeframeAcrossStocks) setTimeframe(initialTimeframe || 'daily')
  }, [stock?.symbol, initialTimeframe, keepTimeframeAcrossStocks])

  // Keyboard navigation
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'ArrowLeft')  { e.preventDefault(); onPrev?.() }
      if (e.key === 'ArrowRight') { e.preventDefault(); onNext?.() }
      if (e.key === 'Escape')     { onClose?.() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onPrev, onNext, onClose])

  useEffect(() => {
    if (!stock) return
    // Guard against out-of-order responses when the user arrow-keys through
    // stocks quickly — ignore any fetch that isn't the latest request.
    let cancelled = false
    setLoading(true)
    setError(null)
    setChartData(null)
    const bench = encodeURIComponent(stock.benchmark || 'NIFTY 50')
    const sym   = encodeURIComponent(stock.symbol)   // symbols like M&M would break the URL unencoded
    fetch(`${API_BASE}/api/chart/${sym}?timeframe=${timeframe}&benchmark=${bench}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(d => { if (!cancelled) { setChartData(d); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(String(e)); setLoading(false) } })
    return () => { cancelled = true }
  }, [stock?.symbol, timeframe, stock?.benchmark])

  useEffect(() => {
    if (!stock) return
    let cancelled = false
    setLiveSignals(null)
    const bench = encodeURIComponent(stock.benchmark || 'NIFTY 50')
    const sym   = encodeURIComponent(stock.symbol)
    fetch(`${API_BASE}/api/signals/${sym}?timeframe=${timeframe}&benchmark=${bench}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled) setLiveSignals(d) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [stock?.symbol, timeframe, stock?.benchmark])

  useEffect(() => {
    if (!stock) return
    let cancelled = false
    setMtfMatrix(null); setSignalHistory(null); setRatingHistory(null)
    const bench = encodeURIComponent(stock.benchmark || 'NIFTY 50')
    const sym   = encodeURIComponent(stock.symbol)

    fetch(`${API_BASE}/api/mtf-matrix/${sym}?benchmark=${bench}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled) setMtfMatrix(d) })
      .catch(() => {})

    fetch(`${API_BASE}/api/signal-history/${sym}?timeframe=daily&benchmark=${bench}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled) setSignalHistory(d) })
      .catch(() => {})

    fetch(`${API_BASE}/api/rating-history/${sym}?timeframe=daily&benchmark=${bench}&days=100`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled) setRatingHistory(d) })
      .catch(() => {})

    return () => { cancelled = true }
  }, [stock?.symbol, stock?.benchmark])

  if (!stock) return null

  // Prefer freshly-fetched live signals for the current timeframe; fall back
  // to the scan-time snapshot only for the brief moment before they arrive.
  const signals   = liveSignals || stock.signals
  const conditions = signals?.conditions ?? {}

  // Latest EMA values for legend
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full z-50 w-[calc(100vw-3rem)] max-w-[1400px]
        bg-[#0d0d18] border-l border-[#1e1e30] flex flex-col shadow-2xl
        animate-[slideIn_0.2s_ease-out]">

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#1e1e30] flex-shrink-0">

          {/* Prev / Next navigation */}
          {totalCount > 0 && (
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={onPrev}
                disabled={currentIndex === 0}
                className="p-1.5 rounded-lg hover:bg-[#1e1e30] text-slate-400 hover:text-slate-200
                  disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Previous stock (←)"
              ><ChevronLeft size={18} /></button>
              <span className="text-xs text-slate-500 font-mono w-14 text-center">
                {currentIndex + 1} / {totalCount}
              </span>
              <button
                onClick={onNext}
                disabled={currentIndex === totalCount - 1}
                className="p-1.5 rounded-lg hover:bg-[#1e1e30] text-slate-400 hover:text-slate-200
                  disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Next stock (→)"
              ><ChevronRight size={18} /></button>
            </div>
          )}

          {/* Symbol info */}
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-violet-600/20 border border-violet-500/30 flex items-center justify-center flex-shrink-0">
              <TrendingUp size={15} className="text-violet-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-white leading-tight truncate">
                {stock.symbol}
                {stock.name && stock.name !== stock.symbol && (
                  <span className="ml-2 text-xs font-normal text-slate-500">{stock.name}</span>
                )}
              </h2>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                {stock.ltp != null && (
                  <span className="text-sm font-mono text-slate-300">₹{stock.ltp.toLocaleString('en-IN')}</span>
                )}
                {stock.benchmark && (
                  <span className="text-xs text-slate-500 bg-[#1a1a2e] px-1.5 py-0.5 rounded">
                    vs {stock.benchmark}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Timeframe switcher */}
          <div className="flex items-center gap-0.5 bg-[#13131f] border border-[#1e1e30] rounded-lg p-0.5 flex-shrink-0">
            {TIMEFRAMES.map(tf => (
              <button
                key={tf.value}
                onClick={() => setTimeframe(tf.value)}
                className={`px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors
                  ${timeframe === tf.value
                    ? 'bg-violet-600 text-white'
                    : 'text-slate-500 hover:text-slate-300'}`}
              >
                {tf.label}
              </button>
            ))}
          </div>
          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Watchlist */}
            {watchlist && (
              <AddToWatchlist symbol={stock.symbol} ltp={stock.ltp} watchlist={watchlist} />
            )}
            {/* TradingView */}
            <button
              onClick={() => window.open(`https://www.tradingview.com/chart/?symbol=NSE:${stock.symbol}`, '_blank')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1a1a2e] border border-[#2d2d45]
                text-slate-400 hover:text-slate-200 hover:border-violet-500/50 text-xs font-medium transition-colors"
              title="Open in TradingView"
            >
              <ExternalLink size={13} /> TradingView
            </button>
            {/* Close */}
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-[#1e1e30] text-slate-500 hover:text-slate-200 transition-colors"
            ><X size={18} /></button>
          </div>
        </div>

        {/* Two-column body: chart left, signals right */}
        <div className="flex-1 overflow-hidden flex gap-0 min-h-0">

          {/* ── Left: price + ratio chart with drawing overlay ───────────── */}
          <div className="flex-1 min-w-0 flex flex-col p-4 overflow-hidden">
            <div className="flex-1 min-h-0 rounded-xl overflow-hidden border border-slate-200">
              {loading && (
                <div className="h-full flex items-center justify-center bg-white">
                  <Loader size={24} className="animate-spin text-violet-500" />
                </div>
              )}
              {error && (
                <div className="h-full flex items-center justify-center bg-white text-rose-400 text-sm">
                  Failed to load chart data
                </div>
              )}
              {!loading && !error && chartData && (
                <ChartErrorBoundary resetKey={`${stock.symbol}:${timeframe}`}>
                  <DrawingOverlay chartApiRef={chartApiRef} chartVersion={chartVersion}
                    storageKey={stock.symbol} migrateKey={`${stock.symbol}:${timeframe}`}>
                    <ChartAutoHeight
                      candles={chartData.candles}
                      ema20={chartData.ema20}
                      ema50={chartData.ema50}
                      ema150={chartData.ema150}
                      macdLine={chartData.macdLine}
                      macdSignal={chartData.macdSignal}
                      macdHistogram={chartData.macdHistogram}
                      ratioLine={chartData.ratioLine}
                      ratioEma20={chartData.ratioEma20}
                      ratioEma150={chartData.ratioEma150}
                      onReady={(api) => {
                        chartApiRef.current = api
                        setChartVersion(v => v + 1)
                      }}
                    />
                  </DrawingOverlay>
                </ChartErrorBoundary>
              )}
            </div>
          </div>

          {/* ── Right: Signals sidebar (widened, scrollable, accordion sections) ─── */}
          <div className="w-[520px] flex-shrink-0 border-l border-[#1e1e30] overflow-y-auto p-4 space-y-3">

            {/* Signal banner — always visible, unchanged */}
            {signals && <SignalBanner signals={signals} />}

            {/* Multi-timeframe matrix */}
            <Accordion title="Multi-Timeframe Matrix">
              <MTFMatrix matrix={mtfMatrix} />
            </Accordion>

            {/* Bullish / bearish factors */}
            <Accordion title="Bullish / Bearish Factors">
              <BullBearFactors conditions={conditions} />
            </Accordion>

            {/* Signal history */}
            <Accordion title="Signal History" badge="Daily">
              <SignalHistoryList history={signalHistory} />
            </Accordion>

            {/* Rating history */}
            <Accordion title="Rating History" badge="Daily">
              <RatingHistoryChart ratingHistory={ratingHistory} />
            </Accordion>

            {/* Financial scan — quarterly EPS/Sales YoY */}
            <Accordion title="Financial Scan" badge="Quarterly" defaultOpen={false}>
              <FinancialScan symbol={stock.symbol} />
            </Accordion>

            {/* Compare stocks */}
            <Accordion title="Compare Stocks" defaultOpen={false}>
              <CompareStocks baseSymbol={stock.symbol} benchmark={stock.benchmark || 'NIFTY 50'} />
            </Accordion>

          </div>{/* end right sidebar */}
        </div>{/* end two-column body */}
      </div>
    </>
  )
}
