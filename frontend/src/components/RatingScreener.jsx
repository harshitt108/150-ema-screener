import { useState } from 'react'
import { Gauge, ChevronDown, Search, ArrowRight, TrendingUp, TrendingDown } from 'lucide-react'
import StockDetailPanel from './StockDetailPanel'
import AddToWatchlist from './AddToWatchlist'
import { SortHeader, FilterHeader } from './TableControls'

import { API_BASE } from '../apiBase'

const INDEX_LIST = [
  "NIFTY 50", "NIFTY NEXT 50", "NIFTY 100", "NIFTY 200", "NIFTY 500",
  "NIFTY MIDCAP 150", "NIFTY SMALLCAP 250",
  "NSE F&O",
  "NIFTY BANK", "NIFTY IT", "NIFTY AUTO", "NIFTY PHARMA", "NIFTY FMCG",
  "NIFTY METAL", "NIFTY ENERGY", "NIFTY REALTY",
  "All NSE Stocks",
]

const LOOKBACK_OPTIONS = [
  { value: 1,  label: 'Last 1 day' },
  { value: 2,  label: 'Last 2 days' },
  { value: 3,  label: 'Last 3 days' },
  { value: 5,  label: 'Last 5 days' },
  { value: 10, label: 'Last 10 days' },
]

const THRESHOLD_OPTIONS = [
  { value: 10, label: '±10 points' },
  { value: 15, label: '±15 points' },
  { value: 20, label: '±20 points' },
  { value: 25, label: '±25 points' },
  { value: 30, label: '±30 points' },
]

// Same bucket colors as RatingHistoryChart so ratings read identically everywhere.
const RATING_COLOR = {
  'Strong Buy':  '#34d399',
  'Buy':         '#60a5fa',
  'Hold':        '#fbbf24',
  'Sell':        '#fb923c',
  'Strong Sell': '#f43f5e',
}

function RatingPill({ rating }) {
  const color = RATING_COLOR[rating] || '#94a3b8'
  return (
    <span
      className="text-[11px] font-bold px-2 py-0.5 rounded border whitespace-nowrap"
      style={{ color, borderColor: `${color}4d`, backgroundColor: `${color}1a` }}
    >
      {rating}
    </span>
  )
}

// Tiny score trend line — dots colored by that day's rating bucket.
function ScoreSpark({ spark, width = 90, height = 26 }) {
  if (!spark || spark.length < 2) return <span className="text-slate-600 text-xs">—</span>
  const toX = i => (i / (spark.length - 1)) * width
  const toY = v => height - 3 - (v / 100) * (height - 6)
  const path = spark.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p.score).toFixed(1)}`).join(' ')
  const last = spark[spark.length - 1]
  return (
    <svg width={width} height={height} className="block">
      <path d={path} fill="none" stroke="#64748b" strokeWidth="1.2" strokeLinejoin="round" />
      {spark.map((p, i) => (
        <circle key={i} cx={toX(i)} cy={toY(p.score)} r={i === spark.length - 1 ? 3 : 1.6}
          fill={RATING_COLOR[p.rating] || '#94a3b8'} />
      ))}
      <title>{`Score last ${spark.length} days · now ${last.score}`}</title>
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

function Select({ value, onChange, options, minWidth = 130 }) {
  return (
    <div className="relative" style={{ minWidth }}>
      <select
        value={value}
        onChange={e => onChange(Number(e.target.value))}
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

export default function RatingScreener({ watchlist }) {
  const [indices, setIndices] = useState(['NIFTY 50'])
  const [lookback, setLookback] = useState(1)
  const [threshold, setThreshold] = useState(20)

  const [results, setResults] = useState([])
  const [scanned, setScanned] = useState(null)
  const [noData, setNoData] = useState([])
  const [scanning, setScanning] = useState(false)
  const [hasScanned, setHasScanned] = useState(false)
  const [error, setError] = useState(null)

  // Post-scan client-side filters
  const [dirFilter, setDirFilter] = useState('all')        // all | up | down
  const [trigFilter, setTrigFilter] = useState('all')      // all | shift | move
  const NO_COL_FILTERS = { shiftTo: 'All', now: 'All' }
  const [colFilters, setColFilters] = useState(NO_COL_FILTERS)
  const [sort, setSort] = useState({ field: 'delta_abs', dir: 'desc' })

  const [selectedIdx, setSelectedIdx] = useState(null)     // row index into `rows`

  const runScan = async () => {
    setScanning(true)
    setError(null)
    setSelectedIdx(null)
    try {
      const resp = await fetch(`${API_BASE}/api/rating-scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          indices,
          benchmark: 'NIFTY 50',
          lookback_days: lookback,
          move_threshold: threshold,
        }),
      })
      if (!resp.ok) throw new Error((await resp.json()).detail || 'Rating scan failed')
      const data = await resp.json()
      setResults(data.results)
      setScanned(data.scanned)
      setNoData(data.noData || [])
      setColFilters(NO_COL_FILTERS)
      setHasScanned(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setScanning(false)
    }
  }

  const filtered = results.filter(r => {
    if (dirFilter !== 'all' && r.event.direction !== dirFilter) return false
    if (trigFilter === 'shift' && !r.event.bucketShift) return false
    if (trigFilter === 'move' && !r.event.bigMove) return false
    if (colFilters.shiftTo !== 'All' && r.event.toRating !== colFilters.shiftTo) return false
    if (colFilters.now !== 'All' && r.currentRating !== colFilters.now) return false
    return true
  })

  // Column dropdown options from the FULL result set (stable while narrowing)
  const distinct = (fn) => [...new Set(results.map(fn).filter(Boolean))].sort()
  const colOpts = {
    shiftTo: distinct(r => r.event.toRating),
    now:     distinct(r => r.currentRating),
  }
  const setColFilter = (key) => (v) => { setColFilters(f => ({ ...f, [key]: v })); setSelectedIdx(null) }

  const onSort = (field) => {
    setSelectedIdx(null)
    setSort(prev => ({ field, dir: prev.field === field && prev.dir === 'asc' ? 'desc' : 'asc' }))
  }

  const rows = [...filtered].sort((a, b) => {
    let va, vb
    switch (sort.field) {
      case 'symbol':    va = a.symbol; vb = b.symbol; break
      case 'ltp':       va = a.ltp; vb = b.ltp; break
      case 'date':      va = a.event.date; vb = b.event.date; break
      case 'delta':     va = a.event.change; vb = b.event.change; break
      case 'delta_abs': va = Math.abs(a.event.change); vb = Math.abs(b.event.change); break
      case 'nowScore':  va = a.currentScore; vb = b.currentScore; break
      default:          va = Math.abs(a.event.change); vb = Math.abs(b.event.change)
    }
    if (typeof va === 'string') return sort.dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
    return sort.dir === 'asc' ? va - vb : vb - va
  })

  const upCount = results.filter(r => r.event.direction === 'up').length
  const downCount = results.length - upCount

  const openRow = (idx) => setSelectedIdx(idx)
  const selectedRow = selectedIdx != null ? rows[selectedIdx] : null

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-violet-600/20 border border-violet-500/30 flex items-center justify-center">
            <Gauge size={18} className="text-violet-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white leading-tight">Rating Screener</h2>
            <p className="text-xs text-slate-500">
              Rating shifts (e.g. Hold → Buy) & big score moves · Daily timeframe · scored vs NIFTY 50
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <IndexMultiSelect selected={indices} onChange={setIndices} />
          <Select value={lookback} onChange={setLookback} options={LOOKBACK_OPTIONS} />
          <Select value={threshold} onChange={setThreshold} options={THRESHOLD_OPTIONS} minWidth={110} />
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
          <strong>{noData.length}</strong> symbol{noData.length > 1 ? 's' : ''} could not be fetched and {noData.length > 1 ? 'were' : 'was'} excluded:{' '}
          <span className="text-amber-300 font-mono">{noData.join(', ')}</span>
        </div>
      )}

      {!hasScanned && !scanning && (
        <div className="flex flex-col items-center justify-center py-24 text-slate-500">
          <div className="w-16 h-16 rounded-2xl bg-[#13131f] border border-[#1e1e30] flex items-center justify-center mb-6">
            <Gauge size={28} className="text-violet-600" />
          </div>
          <h2 className="text-xl font-semibold text-slate-300 mb-2">Screen by Rating Changes</h2>
          <p className="text-sm text-center max-w-sm text-slate-500 leading-relaxed">
            Pick your universe and click <span className="text-violet-400 font-medium">Scan</span> to find stocks whose
            daily rating just shifted bucket (e.g. Hold → Buy) or whose score jumped/dropped by your threshold.
          </p>
          <div className="mt-8 grid grid-cols-3 gap-4 text-center">
            {[
              { label: 'Rating Shift', desc: 'Bucket changed, e.g. Hold → Strong Buy' },
              { label: 'Big Move Up', desc: `Score +${threshold} pts or more in a day` },
              { label: 'Big Move Down', desc: `Score −${threshold} pts or more in a day` },
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
          <p className="mt-6 text-slate-400 font-medium">Scanning rating histories...</p>
          <p className="mt-1 text-sm text-slate-600">Fetching data and computing daily scores</p>
        </div>
      )}

      {hasScanned && !scanning && (
        <>
          {/* Summary + filters */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3 px-1">
            <span className="text-sm text-slate-500">
              <span className="text-slate-300 font-semibold">{rows.length}</span> of{' '}
              <span className="text-slate-300 font-semibold">{results.length}</span> changed stock{results.length !== 1 ? 's' : ''}
              <span className="ml-2 text-slate-600 text-xs">· {scanned} scanned · click a row for the chart</span>
              <span className="ml-3 text-xs">
                <TrendingUp size={11} className="inline text-emerald-400 mr-0.5" />
                <span className="text-emerald-400 font-semibold">{upCount}</span> up
                <TrendingDown size={11} className="inline text-rose-400 ml-2 mr-0.5" />
                <span className="text-rose-400 font-semibold">{downCount}</span> down
              </span>
            </span>
            <div className="flex items-center gap-2">
              <ChipGroup value={dirFilter} onChange={v => { setDirFilter(v); setSelectedIdx(null) }} options={[
                { value: 'all', label: 'All' },
                { value: 'up', label: 'Upgrades' },
                { value: 'down', label: 'Downgrades' },
              ]} />
              <ChipGroup value={trigFilter} onChange={v => { setTrigFilter(v); setSelectedIdx(null) }} options={[
                { value: 'all', label: 'Any trigger' },
                { value: 'shift', label: 'Rating shift' },
                { value: 'move', label: `±${threshold} pt move` },
              ]} />
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="py-20 text-center text-slate-500 text-sm">
              No rating changes found{results.length > 0 ? ' for these filters' : ` in the last ${lookback} trading day${lookback > 1 ? 's' : ''}`}.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[#1e1e30]">
              <table className="w-full min-w-[980px]">
                <thead className="bg-[#0d0d18] border-b border-[#1e1e30]">
                  <tr>
                    <SortHeader label="Stock" field="symbol" sort={sort} onSort={onSort} />
                    <SortHeader label="LTP" field="ltp" sort={sort} onSort={onSort} align="right" />
                    <SortHeader label="Date" field="date" sort={sort} onSort={onSort} />
                    <FilterHeader label="Rating Shift" options={colOpts.shiftTo} value={colFilters.shiftTo} onChange={setColFilter('shiftTo')} />
                    <th className="px-3 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Score</th>
                    <SortHeader label="Δ" field="delta_abs" sort={sort} onSort={onSort} align="right" />
                    <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Trigger</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">Score Trend (20d)</th>
                    <FilterHeader label="Now" options={colOpts.now} value={colFilters.now} onChange={setColFilter('now')} />
                    {watchlist && <th className="px-3 py-3" />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const ev = r.event
                    const zebra = i % 2 === 0 ? 'bg-[#0f0f1a]' : 'bg-[#111120]'
                    return (
                      <tr key={r.symbol}
                        onClick={() => openRow(i)}
                        className={`border-b border-[#16162a] transition-colors cursor-pointer ${zebra} hover:bg-[#1a1a2e]`}>
                        <td className="px-3 py-3">
                          <p className="font-semibold text-slate-100 text-sm">{r.symbol}</p>
                          <p className="text-[11px] text-slate-500 truncate max-w-[180px]">{r.name}</p>
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-sm text-slate-300">
                          {r.ltp.toLocaleString('en-IN')}
                        </td>
                        <td className="px-3 py-3 text-xs font-mono text-slate-400 whitespace-nowrap">
                          {new Date(ev.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1.5 whitespace-nowrap">
                            <RatingPill rating={ev.fromRating} />
                            <ArrowRight size={12} className={ev.direction === 'up' ? 'text-emerald-400' : 'text-rose-400'} />
                            <RatingPill rating={ev.toRating} />
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-sm text-slate-300 whitespace-nowrap">
                          {ev.fromScore} → {ev.toScore}
                        </td>
                        <td className={`px-3 py-3 text-right font-mono text-sm font-bold ${ev.change > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {ev.change > 0 ? '+' : ''}{ev.change}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap gap-1">
                            {ev.bucketShift && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 border border-violet-500/30 whitespace-nowrap">
                                Rating shift
                              </span>
                            )}
                            {ev.bigMove && (
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap
                                ${ev.change > 0
                                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                  : 'bg-rose-500/15 text-rose-400 border-rose-500/30'}`}>
                                {ev.change > 0 ? '+' : '−'}{Math.abs(ev.change)} pts
                              </span>
                            )}
                            {r.eventCount > 1 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1e1e30] text-slate-500 whitespace-nowrap"
                                title={`${r.eventCount} qualifying changes in the window — most recent shown`}>
                                ×{r.eventCount}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex justify-center">
                            <ScoreSpark spark={r.scoreSpark} />
                          </div>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <div className="flex flex-col items-center gap-0.5">
                            <RatingPill rating={r.currentRating} />
                            <span className="text-[10px] text-slate-600 font-mono">{r.currentScore}</span>
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
          timeframe="daily"
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
