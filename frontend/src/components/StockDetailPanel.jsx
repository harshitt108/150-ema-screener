import { useEffect, useRef, useState } from 'react'
import { X, TrendingUp, TrendingDown, Loader, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import CandleChart from './CandleChart'
import DrawingOverlay from './DrawingOverlay'
import AddToWatchlist from './AddToWatchlist'

// Fills the flex container, measures real height, passes it to CandleChart
function ChartAutoHeight({ onReady, ...props }) {
  const ref     = useRef(null)
  const [h, setH] = useState(500)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setH(Math.floor(e.contentRect.height)))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={ref} style={{ width: '100%', height: '100%' }}>
      {h > 0 && <CandleChart {...props} height={h} onReady={onReady} />}
    </div>
  )
}


const API_BASE = 'http://localhost:8000'

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

// ─── Condition card ──────────────────────────────────────────────────────────
function CondCard({ label, bull, val }) {
  const color = bull ? 'text-emerald-400' : 'text-rose-400'
  const Icon  = bull ? TrendingUp : TrendingDown
  return (
    <div className="bg-[#111120] border border-[#1e1e30] rounded-lg p-3 flex flex-col gap-1">
      <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider leading-tight">{label}</p>
      <div className="flex items-center gap-1.5">
        <Icon size={13} className={color} />
        <span className={`text-sm font-semibold ${color}`}>{val}</span>
      </div>
    </div>
  )
}


// ─── Main panel ──────────────────────────────────────────────────────────────
export default function StockDetailPanel({ stock, timeframe, onClose, onPrev, onNext, currentIndex, totalCount, watchlist }) {
  const [chartData, setChartData] = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState(null)
  const chartApiRef    = useRef(null)     // { chart, mainSeries } — set by CandleChart via onReady
  const [chartVersion, setChartVersion] = useState(0)  // bumped on each chart (re)creation

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
    setLoading(true)
    setError(null)
    setChartData(null)
    const bench = encodeURIComponent(stock.benchmark || 'NIFTY 50')
    fetch(`${API_BASE}/api/chart/${stock.symbol}?timeframe=${timeframe}&benchmark=${bench}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(d => { setChartData(d); setLoading(false) })
      .catch(e => { setError(String(e)); setLoading(false) })
  }, [stock?.symbol, timeframe, stock?.benchmark])

  if (!stock) return null

  const signals   = stock.signals
  const conditions = signals?.conditions ?? {}

  // Split conditions into price/technical vs ratio
  const priceConditions = Object.fromEntries(
    Object.entries(conditions).filter(([k]) => !k.startsWith('ratio_'))
  )
  const ratioConditions = chartData?.ratioConditions   // from chart API (always fresh)

  const benchmark = chartData?.benchmark || stock.benchmark || 'NIFTY 50'

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
              <h2 className="text-base font-bold text-white leading-tight">{stock.symbol}</h2>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="text-sm font-mono text-slate-300">₹{stock.ltp?.toLocaleString('en-IN')}</span>
                {stock.benchmark && (
                  <span className="text-xs text-slate-500 bg-[#1a1a2e] px-1.5 py-0.5 rounded">
                    vs {stock.benchmark}
                  </span>
                )}
                <span className="text-xs text-slate-500 uppercase tracking-wide">{timeframe}</span>
              </div>
            </div>
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
                <DrawingOverlay chartApiRef={chartApiRef} chartVersion={chartVersion}>
                  <ChartAutoHeight
                    candles={chartData.candles}
                    ema20={chartData.ema20}
                    ema50={chartData.ema50}
                    ema150={chartData.ema150}
                    ratioLine={chartData.ratioLine}
                    ratioEma20={chartData.ratioEma20}
                    ratioEma150={chartData.ratioEma150}
                    onReady={(api) => {
                      chartApiRef.current = api
                      setChartVersion(v => v + 1)
                    }}
                  />
                </DrawingOverlay>
              )}
            </div>
          </div>

          {/* ── Right: Signals sidebar (fixed 340px, scrollable) ─────────── */}
          <div className="w-[340px] flex-shrink-0 border-l border-[#1e1e30] overflow-y-auto p-4 space-y-4">

            {/* Signal banner */}
            {signals && <SignalBanner signals={signals} />}

            {/* Ratio vs Benchmark */}
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Ratio vs {benchmark}
              </p>
              {ratioConditions ? (
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { key: 'ema20',  label: 'Ratio > 20 EMA'  },
                    { key: 'ema50',  label: 'Ratio > 50 EMA'  },
                    { key: 'ema150', label: 'Ratio > 150 EMA' },
                  ].map(({ key, label }) => {
                    const d = ratioConditions[key]
                    if (!d) return (
                      <div key={key} className="bg-[#111120] border border-[#1e1e30] rounded-lg p-2.5">
                        <p className="text-[9px] font-medium text-slate-500 uppercase tracking-wider mb-1">{label}</p>
                        <span className="text-slate-600 text-xs">—</span>
                      </div>
                    )
                    return (
                      <div key={key} className={`rounded-lg p-2.5 border ${d.above ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-rose-500/10 border-rose-500/30'}`}>
                        <p className="text-[9px] font-medium text-slate-400 uppercase tracking-wider leading-tight mb-1">{label}</p>
                        <div className="flex items-baseline gap-1">
                          <span className={`text-base font-bold ${d.above ? 'text-emerald-400' : 'text-rose-400'}`}>{d.above ? '▲' : '▼'}</span>
                          <span className={`text-xs font-semibold font-mono ${d.above ? 'text-emerald-400' : 'text-rose-400'}`}>{d.dist >= 0 ? '+' : ''}{d.dist}%</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="h-12 flex items-center justify-center bg-[#111120] border border-[#1e1e30] rounded-lg">
                  <span className="text-xs text-slate-600">Loading…</span>
                </div>
              )}
            </div>

            {/* Signal Conditions */}
            {Object.keys(priceConditions).length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  Signal Conditions
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {Object.entries(priceConditions).map(([key, cond]) => (
                    <CondCard key={key} label={cond.label} bull={cond.bull} val={cond.val} />
                  ))}
                </div>
              </div>
            )}

            {/* EMA Structure */}
            {(stock.priceEmas || stock.ratioEmas) && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  EMA Structure ({timeframe})
                </p>
                <div className="space-y-2">
                  {stock.priceEmas && (
                    <div className="bg-[#111120] border border-[#1e1e30] rounded-lg p-2.5">
                      <p className="text-[9px] text-slate-500 uppercase tracking-wider mb-1.5">Price</p>
                      {[['ema20','20 EMA'],['ema50','50 EMA'],['ema150','150 EMA']].map(([k,lbl]) => {
                        const d = stock.priceEmas[k]
                        if (!d) return null
                        return (
                          <div key={k} className="flex justify-between text-xs py-0.5">
                            <span className="text-slate-500">{lbl}</span>
                            <span className={d.above ? 'text-emerald-400 font-mono' : 'text-rose-400 font-mono'}>
                              {d.above ? '▲' : '▼'} {d.dist > 0 ? '+' : ''}{d.dist}%
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {stock.ratioEmas && (
                    <div className="bg-[#111120] border border-[#1e1e30] rounded-lg p-2.5">
                      <p className="text-[9px] text-slate-500 uppercase tracking-wider mb-1.5">Ratio vs {stock.benchmark}</p>
                      {[['ema20','20 EMA'],['ema50','50 EMA'],['ema150','150 EMA']].map(([k,lbl]) => {
                        const d = stock.ratioEmas[k]
                        if (!d) return null
                        return (
                          <div key={k} className="flex justify-between text-xs py-0.5">
                            <span className="text-slate-500">{lbl}</span>
                            <span className={d.above ? 'text-emerald-400 font-mono' : 'text-rose-400 font-mono'}>
                              {d.above ? '▲' : '▼'} {d.dist > 0 ? '+' : ''}{d.dist}%
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

          </div>{/* end right sidebar */}
        </div>{/* end two-column body */}
      </div>
    </>
  )
}
