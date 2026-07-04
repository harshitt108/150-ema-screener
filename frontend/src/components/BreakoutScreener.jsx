import { useState } from 'react'
import { Rocket, ChevronDown, Search } from 'lucide-react'
import StockDetailPanel from './StockDetailPanel'
import AddToWatchlist from './AddToWatchlist'
import { SortHeader } from './TableControls'

import { API_BASE } from '../apiBase'

const INDEX_LIST = [
  "NIFTY 50", "NIFTY NEXT 50", "NIFTY 100", "NIFTY 200", "NIFTY 500",
  "NIFTY MIDCAP 150", "NIFTY SMALLCAP 250",
  "NSE F&O",
  "NIFTY BANK", "NIFTY IT", "NIFTY AUTO", "NIFTY PHARMA", "NIFTY FMCG",
  "NIFTY METAL", "NIFTY ENERGY", "NIFTY REALTY",
  "All NSE Stocks",
]

const TIMEFRAMES = [
  { value: "5min",    label: "5 min" },
  { value: "15min",   label: "15 min" },
  { value: "30min",   label: "30 min" },
  { value: "1h",      label: "1 Hour" },
  { value: "daily",   label: "Daily" },
  { value: "weekly",  label: "Weekly" },
  { value: "monthly", label: "Monthly" },
]

const TF_LABEL = Object.fromEntries(TIMEFRAMES.map(t => [t.value, t.label]))

const SWING_OPTIONS = [
  { value: 5,  label: 'Swing high: 5 bars' },
  { value: 10, label: 'Swing high: 10 bars' },
  { value: 15, label: 'Swing high: 15 bars' },
  { value: 20, label: 'Swing high: 20 bars' },
]

const CROSS_OPTIONS = [
  { value: 15, label: 'EMA cross ≤ 15 bars' },
  { value: 30, label: 'EMA cross ≤ 30 bars' },
  { value: 60, label: 'EMA cross ≤ 60 bars' },
]

// The signal window is bar-based, so the lookback wording follows the timeframe.
const barUnit = (tf) =>
  tf === 'daily' ? 'day' : tf === 'weekly' ? 'week' : tf === 'monthly' ? 'month' : 'bar'

const lookbackOptions = (tf) => {
  const unit = barUnit(tf)
  return [1, 3, 5, 10].map(v => ({
    value: v,
    label: v === 1
      ? (tf === 'daily' ? 'Today only' : `Latest ${unit} only`)
      : `Last ${v} ${unit}s`,
  }))
}

// Short "how long ago" label: 3d / 2w / 4 bars, etc.
function agoLabel(n, tf) {
  if (n === 0) return tf === 'daily' ? 'today' : tf === 'weekly' ? 'this week'
    : tf === 'monthly' ? 'this month' : 'latest bar'
  const suffix = tf === 'daily' ? 'd' : tf === 'weekly' ? 'w' : tf === 'monthly' ? 'mo' : null
  return suffix ? `${n}${suffix} ago` : `${n} bar${n > 1 ? 's' : ''} ago`
}

function agoShort(n, tf) {
  const suffix = tf === 'daily' ? 'd' : tf === 'weekly' ? 'w' : tf === 'monthly' ? 'mo' : null
  return suffix ? `${n}${suffix}` : `${n} bar${n !== 1 ? 's' : ''}`
}

function SignalBadge({ kind }) {
  const styles = kind === 'price'
    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
    : 'bg-sky-500/15 text-sky-400 border-sky-500/30'
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap ${styles}`}>
      {kind === 'price' ? 'PRICE' : 'RS'}
    </span>
  )
}

// Bar timestamps are "YYYY-MM-DD" (daily+) or "YYYY-MM-DD HH:MM" (intraday).
function fmtDate(iso) {
  const day = new Date(iso.slice(0, 10)).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
  return iso.length > 10 ? `${day} ${iso.slice(11)}` : day
}

// Event cell: signal bar + freshness, with breakout detail underneath.
function EventCell({ ev, detail, tf }) {
  if (!ev) return <span className="text-slate-600 text-xs">—</span>
  return (
    <div className="whitespace-nowrap">
      <p className="text-xs font-mono text-slate-300">
        {fmtDate(ev.date)}
        <span className={`ml-1.5 font-sans font-semibold ${ev.barsAgo <= 1 ? 'text-emerald-400' : 'text-slate-500'}`}>
          {agoLabel(ev.barsAgo, tf)}
        </span>
        {ev.count > 1 && (
          <span className="ml-1.5 text-[10px] text-slate-600" title={`${ev.count} breakout signals in the window — most recent shown`}>
            ×{ev.count}
          </span>
        )}
      </p>
      {detail && <p className="text-[10px] text-slate-500 mt-0.5">{detail}</p>}
    </div>
  )
}

// 30-day close line with the signal bars marked (emerald = price, sky = ratio).
function PriceSpark({ spark, priceDate, ratioDate, width = 90, height = 26 }) {
  if (!spark || spark.length < 2) return <span className="text-slate-600 text-xs">—</span>
  const vals = spark.map(p => p.close)
  const min = Math.min(...vals), max = Math.max(...vals)
  const range = max - min || 1
  const toX = i => (i / (spark.length - 1)) * width
  const toY = v => height - 3 - ((v - min) / range) * (height - 6)
  const path = spark.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p.close).toFixed(1)}`).join(' ')
  const pIdx = priceDate ? spark.findIndex(p => p.date === priceDate) : -1
  const rIdx = ratioDate ? spark.findIndex(p => p.date === ratioDate) : -1
  return (
    <svg width={width} height={height} className="block">
      <path d={path} fill="none" stroke="#64748b" strokeWidth="1.2" strokeLinejoin="round" />
      {rIdx >= 0 && <circle cx={toX(rIdx)} cy={toY(spark[rIdx].close)} r="2.5" fill="#38bdf8" />}
      {pIdx >= 0 && <circle cx={toX(pIdx)} cy={toY(spark[pIdx].close)} r="3" fill="#34d399" />}
      <title>{`Close, last ${spark.length} bars`}</title>
    </svg>
  )
}

function IndexMultiSelect({ selected, onChange }) {
  const [open, setOpen] = useState(false)
  const toggle = (idx) => {
    if (selected.includes(idx)) {
      if (selected.length === 1) return
      onChange(selected.filter(s => s !== idx))
    } else {
      onChange([...selected, idx])
    }
  }
  return (
    <div className="relative min-w-[190px]">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between bg-[#1a1a2e] border border-[#2d2d45]
          text-slate-200 rounded-lg px-3 py-2 text-xs
          hover:border-[#4a4a6a] focus:outline-none focus:border-violet-500 transition-colors"
      >
        <span className="truncate text-left">
          {selected.length === 1 ? selected[0] : `${selected.length} indices selected`}
        </span>
        <ChevronDown size={14} className="text-slate-500 ml-2 flex-shrink-0" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 right-0 mt-1 z-20 bg-[#1e1e32] border border-[#2d2d45]
            rounded-lg shadow-xl overflow-hidden max-h-60 overflow-y-auto">
            {INDEX_LIST.map(idx => (
              <label
                key={idx}
                className="flex items-center gap-2.5 px-3 py-2 hover:bg-[#2a2a40] cursor-pointer text-xs"
                onClick={e => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(idx)}
                  onChange={() => toggle(idx)}
                  className="accent-violet-500 w-3.5 h-3.5"
                />
                <span className="text-slate-300">{idx}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function Select({ value, onChange, options, minWidth = 130, numeric = true }) {
  return (
    <div className="relative" style={{ minWidth }}>
      <select
        value={value}
        onChange={e => onChange(numeric ? Number(e.target.value) : e.target.value)}
        className="w-full appearance-none bg-[#1a1a2e] border border-[#2d2d45] text-slate-200
          rounded-lg px-3 py-2 pr-8 text-xs cursor-pointer
          focus:outline-none focus:border-violet-500 hover:border-[#4a4a6a] transition-colors"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown size={14} className="absolute right-2.5 top-2.5 text-slate-500 pointer-events-none" />
    </div>
  )
}

function ChipGroup({ value, onChange, options }) {
  return (
    <div className="flex items-center bg-[#13131f] border border-[#1e1e30] rounded-lg p-0.5">
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors whitespace-nowrap
            ${value === o.value ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export default function BreakoutScreener({ watchlist }) {
  const [indices, setIndices] = useState(['NIFTY 50'])
  const [timeframe, setTimeframe] = useState('daily')
  const [swingPeriod, setSwingPeriod] = useState(10)
  const [crossWindow, setCrossWindow] = useState(30)
  const [lookback, setLookback] = useState(10)

  // Timeframe the current results were scanned at — freezes the table's units
  // and chart-panel timeframe even if the control changes before a re-scan.
  const [scannedTf, setScannedTf] = useState('daily')

  const [results, setResults] = useState([])
  const [scanned, setScanned] = useState(null)
  const [noData, setNoData] = useState([])
  const [scanning, setScanning] = useState(false)
  const [hasScanned, setHasScanned] = useState(false)
  const [error, setError] = useState(null)

  // Post-scan client-side filters
  const [sigFilter, setSigFilter] = useState('all')   // all | price | ratio | both
  const [sort, setSort] = useState({ field: 'recency', dir: 'asc' })

  const [selectedIdx, setSelectedIdx] = useState(null)  // row index into `rows`

  const runScan = async () => {
    setScanning(true)
    setError(null)
    setSelectedIdx(null)
    try {
      const resp = await fetch(`${API_BASE}/api/breakout-scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          indices,
          benchmark: 'NIFTY 50',
          timeframe,
          swing_period: swingPeriod,
          cross_window: crossWindow,
          lookback_bars: lookback,
        }),
      })
      if (!resp.ok) throw new Error((await resp.json()).detail || 'Breakout scan failed')
      const data = await resp.json()
      setResults(data.results)
      setScanned(data.scanned)
      setNoData(data.noData || [])
      setScannedTf(timeframe)
      setHasScanned(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setScanning(false)
    }
  }

  const filtered = results.filter(r => {
    if (sigFilter === 'price') return r.price
    if (sigFilter === 'ratio') return r.ratio
    if (sigFilter === 'both')  return r.price && r.ratio
    return true
  })

  const onSort = (field) => {
    setSelectedIdx(null)
    setSort(prev => ({ field, dir: prev.field === field && prev.dir === 'asc' ? 'desc' : 'asc' }))
  }

  const recency = r => Math.min(r.price ? r.price.barsAgo : 99, r.ratio ? r.ratio.barsAgo : 99)

  const rows = [...filtered].sort((a, b) => {
    let va, vb
    switch (sort.field) {
      case 'symbol':  va = a.symbol; vb = b.symbol; break
      case 'ltp':     va = a.ltp; vb = b.ltp; break
      case 'recency': va = recency(a); vb = recency(b); break
      case 'emaDist': va = a.price ? a.price.emaDist : -999; vb = b.price ? b.price.emaDist : -999; break
      default:        va = recency(a); vb = recency(b)
    }
    if (typeof va === 'string') return sort.dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
    return sort.dir === 'asc' ? va - vb : vb - va
  })

  const priceCount = results.filter(r => r.price).length
  const ratioCount = results.filter(r => r.ratio).length
  const bothCount  = results.filter(r => r.price && r.ratio).length

  const selectedRow = selectedIdx != null ? rows[selectedIdx] : null

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center">
            <Rocket size={18} className="text-emerald-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white leading-tight">Breakout Screener</h2>
            <p className="text-xs text-slate-500">
              150 EMA reclaim + swing-high break · price & ratio (vs NIFTY 50) · {TF_LABEL[timeframe]} timeframe
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <IndexMultiSelect selected={indices} onChange={setIndices} />
          <Select value={timeframe} onChange={setTimeframe} options={TIMEFRAMES} minWidth={100} numeric={false} />
          <Select value={swingPeriod} onChange={setSwingPeriod} options={SWING_OPTIONS} minWidth={150} />
          <Select value={crossWindow} onChange={setCrossWindow} options={CROSS_OPTIONS} minWidth={150} />
          <Select value={lookback} onChange={setLookback} options={lookbackOptions(timeframe)} minWidth={115} />
          <button
            onClick={runScan}
            disabled={scanning}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500
              disabled:opacity-60 text-white text-xs font-semibold transition-colors"
          >
            {scanning
              ? <><div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Scanning…</>
              : <><Search size={13} /> Scan</>
            }
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-sm">
          <strong>Error:</strong> {error}
        </div>
      )}

      {hasScanned && !scanning && noData.length > 0 && (
        <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400 text-xs">
          <strong>{noData.length}</strong> symbol{noData.length > 1 ? 's' : ''} lacked enough history or could not be fetched:{' '}
          <span className="text-amber-300 font-mono">{noData.join(', ')}</span>
        </div>
      )}

      {!hasScanned && !scanning && (
        <div className="flex flex-col items-center justify-center py-24 text-slate-500">
          <div className="w-16 h-16 rounded-2xl bg-[#13131f] border border-[#1e1e30] flex items-center justify-center mb-6">
            <Rocket size={28} className="text-emerald-600" />
          </div>
          <h2 className="text-xl font-semibold text-slate-300 mb-2">Screen for Fresh Breakouts</h2>
          <p className="text-sm text-center max-w-md text-slate-500 leading-relaxed">
            Finds stocks that recently crossed above their <span className="text-slate-300">150 EMA</span> and
            then closed above the prior <span className="text-slate-300">{swingPeriod}-bar swing high</span> —
            checked independently on the <span className="text-emerald-400 font-medium">price chart</span> and
            the <span className="text-sky-400 font-medium">ratio chart</span> vs NIFTY 50.
          </p>
          <div className="mt-8 grid grid-cols-2 gap-4 text-center max-w-lg">
            {[
              { label: 'Price Breakout', desc: `Close crossed the 150 EMA within ${crossWindow} bars, then broke the ${swingPeriod}-bar high` },
              { label: 'RS Breakout', desc: `Same rule on the stock ÷ NIFTY 50 ratio — relative strength breaking out` },
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
            <div className="absolute inset-0 border-4 border-t-emerald-500 rounded-full animate-spin" />
          </div>
          <p className="mt-6 text-slate-400 font-medium">Scanning for breakouts...</p>
          <p className="mt-1 text-sm text-slate-600">Checking EMA crosses and swing highs on price & ratio</p>
        </div>
      )}

      {hasScanned && !scanning && (
        <>
          {/* Summary + filters */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3 px-1">
            <span className="text-sm text-slate-500">
              <span className="text-slate-300 font-semibold">{rows.length}</span> of{' '}
              <span className="text-slate-300 font-semibold">{results.length}</span> breakout stock{results.length !== 1 ? 's' : ''}
              <span className="ml-2 text-slate-600 text-xs">· {scanned} scanned · click a row for the chart</span>
              <span className="ml-3 text-xs">
                <span className="text-emerald-400 font-semibold">{priceCount}</span> price
                <span className="text-sky-400 font-semibold ml-2">{ratioCount}</span> RS
                <span className="text-violet-400 font-semibold ml-2">{bothCount}</span> both
              </span>
            </span>
            <ChipGroup value={sigFilter} onChange={v => { setSigFilter(v); setSelectedIdx(null) }} options={[
              { value: 'all', label: 'All' },
              { value: 'price', label: 'Price breakout' },
              { value: 'ratio', label: 'RS breakout' },
              { value: 'both', label: 'Both' },
            ]} />
          </div>

          {rows.length === 0 ? (
            <div className="py-20 text-center text-slate-500 text-sm">
              No breakouts found{results.length > 0 ? ' for this filter' : ` in the last ${lookback} ${barUnit(scannedTf)}${lookback > 1 ? 's' : ''}`}.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[#1e1e30]">
              <table className="w-full min-w-[980px]">
                <thead className="bg-[#0d0d18] border-b border-[#1e1e30]">
                  <tr>
                    <SortHeader label="Stock" field="symbol" sort={sort} onSort={onSort} />
                    <SortHeader label="LTP" field="ltp" sort={sort} onSort={onSort} align="right" />
                    <SortHeader label="Freshness" field="recency" sort={sort} onSort={onSort} />
                    <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Signals</th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Price Breakout</th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">RS Breakout</th>
                    <SortHeader label="vs 150 EMA" field="emaDist" sort={sort} onSort={onSort} align="right" />
                    <th className="px-3 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">Close (30 bars)</th>
                    {watchlist && <th className="px-3 py-3" />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const zebra = i % 2 === 0 ? 'bg-[#0f0f1a]' : 'bg-[#111120]'
                    const freshest = recency(r)
                    return (
                      <tr key={r.symbol}
                        onClick={() => setSelectedIdx(i)}
                        className={`border-b border-[#16162a] transition-colors cursor-pointer ${zebra} hover:bg-[#1a1a2e]`}>
                        <td className="px-3 py-3">
                          <p className="font-semibold text-slate-100 text-sm">{r.symbol}</p>
                          <p className="text-[11px] text-slate-500 truncate max-w-[180px]">{r.name}</p>
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-sm text-slate-300">
                          {r.ltp.toLocaleString('en-IN')}
                        </td>
                        <td className="px-3 py-3">
                          <span className={`text-xs font-semibold whitespace-nowrap
                            ${freshest === 0 ? 'text-emerald-400' : freshest <= 2 ? 'text-slate-300' : 'text-slate-500'}`}>
                            {agoLabel(freshest, scannedTf)}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex gap-1">
                            {r.price && <SignalBadge kind="price" />}
                            {r.ratio && <SignalBadge kind="ratio" />}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <EventCell
                            ev={r.price}
                            tf={scannedTf}
                            detail={r.price &&
                              `broke ${r.price.level.toLocaleString('en-IN')} · EMA cross ${agoShort(r.price.crossBarsAgo, scannedTf)} before`}
                          />
                        </td>
                        <td className="px-3 py-3">
                          <EventCell
                            ev={r.ratio}
                            tf={scannedTf}
                            detail={r.ratio && r.ratio.emaDist != null &&
                              `ratio ${r.ratio.emaDist > 0 ? '+' : ''}${r.ratio.emaDist}% vs its 150 EMA`}
                          />
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-sm whitespace-nowrap">
                          {r.price && r.price.emaDist != null
                            ? <span className={r.price.emaDist >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                                {r.price.emaDist > 0 ? '+' : ''}{r.price.emaDist}%
                              </span>
                            : <span className="text-slate-600">—</span>}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex justify-center">
                            <PriceSpark
                              spark={r.spark}
                              priceDate={r.price && r.price.date}
                              ratioDate={r.ratio && r.ratio.date}
                            />
                          </div>
                        </td>
                        {watchlist && (
                          <td className="px-3 py-3">
                            <AddToWatchlist symbol={r.symbol} ltp={r.ltp} watchlist={watchlist} compact />
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Chart panel — prev/next walks the filtered result list */}
      {selectedRow && (
        <StockDetailPanel
          stock={{ symbol: selectedRow.symbol, name: selectedRow.name, ltp: selectedRow.ltp, benchmark: 'NIFTY 50' }}
          timeframe={scannedTf}
          onClose={() => setSelectedIdx(null)}
          onPrev={() => setSelectedIdx(i => (i > 0 ? i - 1 : i))}
          onNext={() => setSelectedIdx(i => (i < rows.length - 1 ? i + 1 : i))}
          currentIndex={selectedIdx}
          totalCount={rows.length}
          watchlist={watchlist}
          keepTimeframeAcrossStocks
        />
      )}
    </div>
  )
}
