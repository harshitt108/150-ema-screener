import { useEffect, useState, useCallback, Fragment } from 'react'
import { TrendingUp, TrendingDown, RefreshCw, Layers, ArrowUpRight, ArrowDownRight, X, BarChart3, List } from 'lucide-react'
import Sparkline from './Sparkline'
import { EmaGroup, RatioGroup, MomentumGroup } from './IndicatorGroups'
import StockDetailPanel from './StockDetailPanel'

import { API_BASE } from '../apiBase'

const TIMEFRAMES = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
]

const CATEGORY_ORDER = ['Broad', 'Sectoral', 'Thematic']
const CATEGORY_STYLE = {
  Broad:    'bg-sky-500/10 text-sky-400 border-sky-500/30',
  Sectoral: 'bg-violet-500/10 text-violet-400 border-violet-500/30',
  Thematic: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
}

const SIGNAL_STYLE = {
  BUY:  'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  HOLD: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  SELL: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
}
const SIGNAL_COUNT_COLOR = { BUY: 'text-emerald-400', HOLD: 'text-amber-400', SELL: 'text-rose-400' }

function pctColor(v) {
  if (v == null) return 'text-slate-600'
  return v > 0 ? 'text-emerald-400' : v < 0 ? 'text-rose-400' : 'text-slate-400'
}

function fmtPct(v) {
  if (v == null) return '—'
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`
}

// Map an index row to the shape StockDetailPanel expects. The panel builds its
// fetch URLs from `symbol`; the backend resolves the index display name to its
// Yahoo ticker, so we pass the friendly name (which also reads nicely in the
// panel header). Benchmark is NIFTY 50 — the module-wide reference.
function toStockProp(row) {
  if (!row) return null
  return {
    symbol: row.name,
    name: `${row.category} Index`,
    ltp: row.ltp,
    benchmark: 'NIFTY 50',
    signals: row.signals,
  }
}

// A single index card for the strong/weak leaderboards.
function SectorCard({ row, rank, tone, onOpen }) {
  const r1m = row.returns.r21
  const r1d = row.returns.r1
  const up = tone === 'strong'
  return (
    <div
      onClick={() => onOpen?.(row)}
      className="flex items-center gap-3 p-3 rounded-xl bg-[#13131f] border border-[#1e1e30] cursor-pointer hover:border-violet-500/40 transition-colors">
      <div className={`flex-shrink-0 w-6 h-6 rounded-lg flex items-center justify-center text-[11px] font-bold
        ${up ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}`}>
        {rank}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-200 truncate">{row.name}</p>
        <p className="text-[11px] text-slate-500">
          {row.aboveCount}/{row.emaTotal} EMAs · {row.signal}
          {r1d != null && (
            <> · today <span className={`font-mono font-semibold ${pctColor(r1d)}`}>{fmtPct(r1d)}</span></>
          )}
        </p>
      </div>
      <div className="flex-shrink-0">
        <Sparkline prices={row.sparkline} emaLine={[]} width={70} height={26} />
      </div>
      <div className="flex-shrink-0 text-right">
        <div className={`flex items-center justify-end gap-0.5 text-sm font-bold font-mono ${pctColor(r1m)}`}>
          {up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
          {fmtPct(r1m)}
        </div>
        {row.rs && !row.rs.isBenchmark && row.rs.ret != null && (
          <div className="text-[10px] text-slate-500 mt-0.5 whitespace-nowrap">
            vs NIFTY <span className={`font-mono font-semibold ${pctColor(row.rs.ret)}`}>{fmtPct(row.rs.ret)}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// Relative-strength vs NIFTY 50: trend arrow + relative return (ratio % change).
function RsBadge({ rs }) {
  if (!rs) return <span className="text-slate-600 text-xs">—</span>
  if (rs.isBenchmark) {
    return <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Base</span>
  }
  const arrow = rs.trend === 'Rising' ? '▲' : rs.trend === 'Falling' ? '▼' : '→'
  const color = pctColor(rs.ret)
  return (
    <span className={`inline-flex items-center gap-1 font-mono text-sm font-semibold ${color}`}
          title={`Ratio vs NIFTY 50 · trend ${rs.trend || '—'} · ${rs.aboveEma ? 'above' : 'below'} ratio EMA`}>
      <span>{arrow}</span>
      <span>{fmtPct(rs.ret)}</span>
    </span>
  )
}

// Recommendation pill — same shape as the stock tables' SignalPill
// (signal badge + bull/total count) so every module reads identically.
function SignalPill({ signal, bullCount, total }) {
  if (!signal) return <span className="text-slate-600 text-xs">—</span>
  return (
    <div className="flex flex-col gap-0.5 items-center">
      <span className={`text-xs font-bold px-2 py-0.5 rounded border w-fit ${SIGNAL_STYLE[signal]}`}>{signal}</span>
      <span className="text-[10px] text-slate-600 font-mono">{bullCount}/{total}</span>
    </div>
  )
}

// Two-option menu shown when a sector card is clicked.
function CardActionMenu({ row, onChart, onConstituents, onClose }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-80 rounded-2xl bg-[#0d0d18] border border-[#1e1e30] p-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-0.5">
          <Layers size={15} className="text-violet-400" />
          <h3 className="text-sm font-bold text-white">{row.name}</h3>
        </div>
        <p className="text-xs text-slate-500 mb-4">Choose an action</p>
        <div className="space-y-2">
          <button onClick={onChart}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[#13131f] border border-[#1e1e30] hover:border-violet-500/50 text-left transition-colors">
            <BarChart3 size={18} className="text-violet-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-slate-200">Open Chart</p>
              <p className="text-[11px] text-slate-500">Price, EMAs & RS vs NIFTY 50</p>
            </div>
          </button>
          <button onClick={onConstituents}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[#13131f] border border-[#1e1e30] hover:border-emerald-500/50 text-left transition-colors">
            <List size={18} className="text-emerald-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-slate-200">View Constituents</p>
              <p className="text-[11px] text-slate-500">Stocks inside this index</p>
            </div>
          </button>
        </div>
        <button onClick={onClose} className="mt-3 w-full text-xs text-slate-500 hover:text-slate-300 py-1.5 transition-colors">Cancel</button>
      </div>
    </div>
  )
}

// Modal listing the constituent stocks of an index; each opens its own chart.
function ConstituentsModal({ index, onClose, onOpenStock }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`${API_BASE}/api/index-constituents?index=${encodeURIComponent(index)}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [index])

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-2xl bg-[#0d0d18] border border-[#1e1e30] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e1e30] flex-shrink-0">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Layers size={16} className="text-violet-400" /> {index}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {loading ? 'Loading constituents…'
                : data?.available ? `${data.count} constituent stocks · click a stock to open its chart`
                : 'Constituent list not available'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[#1e1e30] text-slate-500 hover:text-slate-200 transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto p-4">
          {loading && <div className="py-12 text-center text-slate-500 text-sm">Loading…</div>}
          {!loading && data?.available && (
            <>
              {data.representative && (
                <div className="mb-3 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-400 text-[11px]">
                  Representative constituents — NSE revises index membership periodically.
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {data.constituents.map(c => (
                  <button key={c.symbol} onClick={() => onOpenStock(c)}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-[#13131f] border border-[#1e1e30] hover:border-violet-500/50 text-left transition-colors">
                    <span className="w-8 h-8 rounded-md bg-violet-600/15 text-violet-400 text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                      {c.symbol.slice(0, 2)}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-200 truncate">{c.symbol}</p>
                      <p className="text-[11px] text-slate-500 truncate">{c.name}</p>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
          {!loading && data && !data.available && (
            <div className="py-12 text-center text-slate-500 text-sm">No constituent list available for this index yet.</div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function IndexScanner() {
  const [timeframe, setTimeframe] = useState('daily')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [selectedIdx, setSelectedIdx] = useState(null)  // position in orderedRows for the index chart panel
  const [cardMenu, setCardMenu] = useState(null)         // sector card two-option menu
  const [constituentsFor, setConstituentsFor] = useState(null)  // index whose constituents modal is open
  const [panelStock, setPanelStock] = useState(null)     // a constituent stock opened in the chart panel

  const load = useCallback(async (tf) => {
    setLoading(true)
    setError(null)
    try {
      const resp = await fetch(`${API_BASE}/api/index-scan?timeframe=${tf}`)
      if (!resp.ok) throw new Error((await resp.json()).detail || 'Index scan failed')
      setData(await resp.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(timeframe) }, [timeframe, load])

  const labels = data?.returnLabels || { r1: '1D', r5: '1W', r21: '1M', r63: '3M' }

  // Group the full index table by category for readability.
  const grouped = {}
  if (data) {
    for (const row of data.indices) {
      (grouped[row.category] ||= []).push(row)
    }
    // within a group, strongest recent momentum first
    for (const cat of Object.keys(grouped)) {
      grouped[cat].sort((a, b) => (b.returns.r21 ?? -999) - (a.returns.r21 ?? -999))
    }
  }

  // Flat list in the exact order rows render (for the chart panel's prev/next).
  const orderedRows = CATEGORY_ORDER.flatMap(c => grouped[c] || [])

  // Open the chart panel for an index by name, positioned within orderedRows so
  // the panel's prev/next still walks the full index list.
  const openByName = (row) => {
    const idx = orderedRows.findIndex(r => r.name === row.name)
    if (idx >= 0) { setPanelStock(null); setSelectedIdx(idx) }
  }

  // Open a constituent stock in the chart panel (no prev/next, like the Search module).
  const openConstituentStock = (c) => {
    setConstituentsFor(null)
    setSelectedIdx(null)
    setPanelStock({ symbol: c.symbol, name: c.name, ltp: null, benchmark: 'NIFTY 50' })
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-violet-600/20 border border-violet-500/30 flex items-center justify-center">
            <Layers size={18} className="text-violet-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white leading-tight">Index Scanner</h2>
            <p className="text-xs text-slate-500">
              Sector rotation & EMA structure across NSE indices · benchmarked vs NIFTY 50
              {data?.asOf && (
                <> · data through <span className="text-slate-300 font-semibold">
                  {new Date(data.asOf).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                </span></>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-[#13131f] border border-[#1e1e30] rounded-lg p-0.5">
            {TIMEFRAMES.map(tf => (
              <button
                key={tf.value}
                onClick={() => setTimeframe(tf.value)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors
                  ${timeframe === tf.value ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
              >
                {tf.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => load(timeframe)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2d2d45]
              bg-[#13131f] text-slate-400 hover:text-violet-400 hover:border-violet-500/40
              text-xs font-medium transition-colors disabled:opacity-60"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-sm">
          <strong>Error:</strong> {error}
        </div>
      )}

      {loading && !data && (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="relative w-14 h-14">
            <div className="absolute inset-0 border-4 border-[#1e1e30] rounded-full" />
            <div className="absolute inset-0 border-4 border-t-violet-500 rounded-full animate-spin" />
          </div>
          <p className="mt-5 text-slate-400 font-medium">Scanning indices...</p>
        </div>
      )}

      {data && (
        <>
          {/* Strong / Weak leaderboards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            <div className="rounded-2xl bg-[#0d0d18] border border-emerald-500/20 p-4">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp size={16} className="text-emerald-400" />
                <h3 className="text-sm font-bold text-emerald-400">Recent Strong Sectors</h3>
                <span className="text-[11px] text-slate-500">· by {labels.r21} return</span>
              </div>
              <div className="space-y-2">
                {data.strongSectors.length === 0 && <p className="text-xs text-slate-600 py-4 text-center">No data</p>}
                {data.strongSectors.map((row, i) => (
                  <SectorCard key={row.name} row={row} rank={i + 1} tone="strong" onOpen={setCardMenu} />
                ))}
              </div>
            </div>

            <div className="rounded-2xl bg-[#0d0d18] border border-rose-500/20 p-4">
              <div className="flex items-center gap-2 mb-3">
                <TrendingDown size={16} className="text-rose-400" />
                <h3 className="text-sm font-bold text-rose-400">Recent Weak Sectors</h3>
                <span className="text-[11px] text-slate-500">· by {labels.r21} return</span>
              </div>
              <div className="space-y-2">
                {data.weakSectors.length === 0 && <p className="text-xs text-slate-600 py-4 text-center">No data</p>}
                {data.weakSectors.map((row, i) => (
                  <SectorCard key={row.name} row={row} rank={i + 1} tone="weak" onOpen={setCardMenu} />
                ))}
              </div>
            </div>
          </div>

          {data.noData.length > 0 && (
            <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400 text-xs">
              <strong>{data.noData.length}</strong> index{data.noData.length > 1 ? 'es' : ''} could not be fetched:{' '}
              <span className="text-amber-300 font-mono">{data.noData.join(', ')}</span>
            </div>
          )}

          {/* Full index table */}
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <span className="text-sm text-slate-500">
                <span className="text-slate-300 font-semibold">All NSE Indices</span>
                <span className="ml-2 text-slate-600 text-xs">· {data.analyzed} of {data.scanned} scanned · vs {data.benchmark || 'NIFTY 50'} · click a row for chart or constituents</span>
              </span>
              <div className="flex gap-3">
                {['BUY', 'HOLD', 'SELL'].map(s => {
                  const count = data.indices.filter(r => r.signal === s).length
                  if (!count) return null
                  return (
                    <span key={s} className="text-xs text-slate-500">
                      {s}: <span className={`font-semibold ${SIGNAL_COUNT_COLOR[s]}`}>{count}</span>
                    </span>
                  )
                })}
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-[#1e1e30]">
              <table className="w-full min-w-[1120px]">
                <thead className="bg-[#0d0d18] border-b border-[#1e1e30]">
                  <tr>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Index</th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">LTP</th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">{labels.r1}</th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">{labels.r5}</th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">{labels.r21}</th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">{labels.r63}</th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">RS vs NIFTY 50</th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">EMA (20/50/150)</th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">Ratio vs EMA</th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Momentum</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">Rec.</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    let rowIdx = 0
                    return CATEGORY_ORDER.filter(c => grouped[c]?.length).map(cat => (
                      <Fragment key={cat}>
                        <tr className="bg-[#0d0d18] border-b border-[#1e1e30]">
                          <td colSpan={12} className="px-3 py-2">
                            <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${CATEGORY_STYLE[cat]}`}>
                              {cat}
                            </span>
                          </td>
                        </tr>
                        {grouped[cat].map(row => {
                          const ordinal = rowIdx++
                          const zebra = ordinal % 2 === 0 ? 'bg-[#0f0f1a]' : 'bg-[#111120]'
                          return (
                            <tr key={row.name}
                              onClick={() => setCardMenu(row)}
                              className={`border-b border-[#16162a] transition-colors cursor-pointer ${zebra} hover:bg-[#1a1a2e]`}>
                              <td className="px-3 py-3 font-semibold text-slate-100 text-sm tracking-wide whitespace-nowrap">{row.name}</td>
                              <td className="px-3 py-3 text-right font-mono text-sm text-slate-300">{row.ltp.toLocaleString('en-IN')}</td>
                              <td className={`px-3 py-3 text-right font-mono text-sm ${pctColor(row.returns.r1)}`}>{fmtPct(row.returns.r1)}</td>
                              <td className={`px-3 py-3 text-right font-mono text-sm ${pctColor(row.returns.r5)}`}>{fmtPct(row.returns.r5)}</td>
                              <td className={`px-3 py-3 text-right font-mono text-sm font-semibold ${pctColor(row.returns.r21)}`}>{fmtPct(row.returns.r21)}</td>
                              <td className={`px-3 py-3 text-right font-mono text-sm ${pctColor(row.returns.r63)}`}>{fmtPct(row.returns.r63)}</td>
                              <td className="px-3 py-3 text-right"><RsBadge rs={row.rs} /></td>
                              <td className="px-3 py-3"><EmaGroup panel={row.emas} /></td>
                              <td className="px-3 py-3"><RatioGroup panel={row.ratioEmas} /></td>
                              <td className="px-3 py-3"><MomentumGroup source={row.signals} /></td>
                              <td className="px-3 py-3 text-center">
                                <div className="flex justify-center">
                                  <SignalPill signal={row.signal} bullCount={row.bullCount} total={row.conditionTotal} />
                                </div>
                              </td>
                              <td className="px-3 py-3">
                                <div className="flex justify-center">
                                  <Sparkline prices={row.sparkline} emaLine={[]} width={80} height={26} />
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </Fragment>
                    ))
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Sector-card two-option menu: chart or constituents */}
      {cardMenu && (
        <CardActionMenu
          row={cardMenu}
          onChart={() => { openByName(cardMenu); setCardMenu(null) }}
          onConstituents={() => { setConstituentsFor(cardMenu.name); setCardMenu(null) }}
          onClose={() => setCardMenu(null)}
        />
      )}

      {/* Constituent stocks of an index */}
      {constituentsFor && (
        <ConstituentsModal
          index={constituentsFor}
          onClose={() => setConstituentsFor(null)}
          onOpenStock={openConstituentStock}
        />
      )}

      {/* Chart panel for an index — opens on row click, prev/next walks the index list */}
      {selectedIdx != null && orderedRows[selectedIdx] && (
        <StockDetailPanel
          stock={toStockProp(orderedRows[selectedIdx])}
          timeframe={timeframe}
          onClose={() => setSelectedIdx(null)}
          onPrev={() => setSelectedIdx(i => (i > 0 ? i - 1 : i))}
          onNext={() => setSelectedIdx(i => (i < orderedRows.length - 1 ? i + 1 : i))}
          currentIndex={selectedIdx}
          totalCount={orderedRows.length}
          keepTimeframeAcrossStocks
        />
      )}

      {/* Chart panel for a constituent stock — no prev/next (like the Search module) */}
      {panelStock && (
        <StockDetailPanel
          stock={panelStock}
          timeframe={timeframe}
          onClose={() => setPanelStock(null)}
          currentIndex={0}
          totalCount={0}
          keepTimeframeAcrossStocks
        />
      )}
    </div>
  )
}
