import { useState, useEffect } from 'react'
import { ExternalLink, TrendingUp, X } from 'lucide-react'
import { EmaGroup, MomentumGroup } from './IndicatorGroups'
import AddToWatchlist from './AddToWatchlist'
import { SortHeader, FilterHeader } from './TableControls'

function EmaCondBadge({ signal }) {
  const styles = {
    'Near EMA':    'bg-amber-500/15 text-amber-400 border border-amber-500/30',
    'Cross Above': 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
    'Cross Below': 'bg-rose-500/15 text-rose-400 border border-rose-500/30',
    'Above EMA':   'bg-blue-500/15 text-blue-400 border border-blue-500/30',
    'Below EMA':   'bg-orange-500/15 text-orange-400 border border-orange-500/30',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[signal] || 'bg-slate-700 text-slate-400'}`}>
      {signal}
    </span>
  )
}

function SignalPill({ signals }) {
  if (!signals) return null
  const { signal, bullCount, total } = signals
  const cfg = {
    BUY:  'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    HOLD: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    SELL: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  }[signal]
  return (
    <div className="flex flex-col gap-0.5">
      <span className={`text-xs font-bold px-2 py-0.5 rounded border w-fit ${cfg}`}>{signal}</span>
      <span className="text-[10px] text-slate-600 font-mono">{bullCount}/{total}</span>
    </div>
  )
}

function DistanceBadge({ value }) {
  const abs = Math.abs(value)
  const color = abs <= 1 ? 'text-emerald-400' : abs <= 3 ? 'text-amber-400' : 'text-slate-400'
  return (
    <span className={`font-mono text-sm font-semibold ${color}`}>
      {value >= 0 ? '+' : ''}{value.toFixed(2)}%
    </span>
  )
}

function VolumeBadge({ ratio }) {
  if (!ratio) return <span className="text-slate-600 text-sm">—</span>
  const color = ratio >= 2 ? 'text-emerald-400' : ratio >= 1.5 ? 'text-amber-400' : 'text-slate-400'
  return <span className={`text-sm font-medium ${color}`}>{ratio.toFixed(1)}x</span>
}

function openTradingView(e, symbol) {
  e.stopPropagation()
  window.open(`https://www.tradingview.com/chart/?symbol=NSE:${symbol}`, '_blank')
}

const NO_FILTERS = { signal: 'All', rec: 'All' }

export default function ResultsTable({ results, scanned, onRowClick, watchlist, showRatioEmas }) {
  // Auto-detect ratio data: show the column if ANY row has ratioEmas
  const hasRatio = showRatioEmas ?? results.some(r => r.ratioEmas)
  const [sort, setSort] = useState({ field: 'distance_abs', dir: 'asc' })
  const [filters, setFilters] = useState(NO_FILTERS)

  // Fresh scan → clear any column filters left over from the previous results
  useEffect(() => { setFilters(NO_FILTERS) }, [results])

  const onSort = (field) => {
    setSort(prev => ({ field, dir: prev.field === field && prev.dir === 'asc' ? 'desc' : 'asc' }))
  }

  const setFilter = (key) => (v) => setFilters(f => ({ ...f, [key]: v }))
  const anyFilter = Object.values(filters).some(v => v !== 'All')

  // Dropdown options from the FULL result set (stable while narrowing down)
  const distinct = (fn) => [...new Set(results.map(fn).filter(Boolean))].sort()
  const opts = {
    signal: distinct(r => r.signal),
    rec:    distinct(r => r.signals?.signal),
  }

  const filtered = results.filter(r =>
    (filters.signal === 'All' || r.signal === filters.signal) &&
    (filters.rec === 'All'    || r.signals?.signal === filters.rec)
  )

  const sorted = [...filtered].sort((a, b) => {
    let va, vb
    switch (sort.field) {
      case 'symbol':       va = a.symbol; vb = b.symbol; break
      case 'ltp':          va = a.ltp; vb = b.ltp; break
      case 'ema':          va = a.ema; vb = b.ema; break
      case 'distance_abs': va = Math.abs(a.distance); vb = Math.abs(b.distance); break
      case 'volume_ratio': va = a.volRatio; vb = b.volRatio; break
      default:             va = Math.abs(a.distance); vb = Math.abs(b.distance)
    }
    if (typeof va === 'string') return sort.dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
    return sort.dir === 'asc' ? va - vb : vb - va
  })

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-500">
        <TrendingUp size={40} className="mb-4 text-slate-700" />
        <p className="text-lg font-medium">No stocks matched your filters</p>
        <p className="text-sm mt-1">Try adjusting the distance or condition</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <span className="text-sm text-slate-500 flex items-center gap-2 flex-wrap">
          <span>
            Showing <span className="text-slate-300 font-semibold">{sorted.length}</span>
            {anyFilter && <> of <span className="text-slate-400">{results.length}</span> matched</>}
            {scanned ? <> · <span className="text-slate-400">{scanned}</span> scanned</> : ''}
            <span className="ml-2 text-slate-600 text-xs">· click a row to open chart</span>
          </span>
          {anyFilter && (
            <button
              onClick={() => setFilters(NO_FILTERS)}
              className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/30
                text-violet-400 hover:bg-violet-500/20 text-xs font-medium transition-colors"
            >
              <X size={11} /> Clear filters
            </button>
          )}
        </span>
        <div className="flex gap-3">
          {['BUY','HOLD','SELL'].map(s => {
            const count = results.filter(r => r.signals?.signal === s).length
            if (!count) return null
            const colors = { BUY:'text-emerald-400', HOLD:'text-amber-400', SELL:'text-rose-400' }
            return (
              <span key={s} className="text-xs text-slate-500">
                {s}: <span className={`font-semibold ${colors[s]}`}>{count}</span>
              </span>
            )
          })}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[#1e1e30]">
        <table className="w-full min-w-[820px]">
          <thead className="bg-[#0d0d18] border-b border-[#1e1e30]">
            <tr>
              <SortHeader label="Symbol"   field="symbol"       sort={sort} onSort={onSort} />
              <SortHeader label="LTP"      field="ltp"          sort={sort} onSort={onSort} />
              <SortHeader label="EMA"      field="ema"          sort={sort} onSort={onSort} />
              <SortHeader label="Distance" field="distance_abs" sort={sort} onSort={onSort} />
              <FilterHeader label="EMA Signal" options={opts.signal} value={filters.signal} onChange={setFilter('signal')} />
              <FilterHeader label="Rec." options={opts.rec} value={filters.rec} onChange={setFilter('rec')} />
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">EMA (20/50/150)</th>
              {hasRatio && <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">Ratio vs EMA</th>}
              <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">Momentum</th>
              <SortHeader label="Vol Ratio" field="volume_ratio" sort={sort} onSort={onSort} />
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={11} className="px-3 py-12 text-center text-sm text-slate-500">
                  No rows match the column filters — <button onClick={() => setFilters(NO_FILTERS)} className="text-violet-400 hover:underline">clear filters</button>
                </td>
              </tr>
            )}
            {sorted.map((row, i) => (
              <tr
                key={row.symbol}
                className={`border-b border-[#16162a] transition-colors cursor-pointer
                  ${i % 2 === 0 ? 'bg-[#0f0f1a]' : 'bg-[#111120]'}
                  hover:bg-[#1a1a2e]`}
                onClick={() => onRowClick?.(row, i)}
              >
                <td className="px-3 py-3">
                  <span className="font-semibold text-slate-100 text-sm tracking-wide">{row.symbol}</span>
                </td>
                <td className="px-3 py-3">
                  <span className="font-mono text-sm text-slate-300">{row.ltp.toLocaleString('en-IN')}</span>
                </td>
                <td className="px-3 py-3">
                  <span className="font-mono text-sm text-slate-400">{row.ema.toLocaleString('en-IN')}</span>
                </td>
                <td className="px-3 py-3">
                  <DistanceBadge value={row.distance} />
                </td>
                <td className="px-3 py-3">
                  <EmaCondBadge signal={row.signal} />
                </td>
                <td className="px-3 py-3">
                  <SignalPill signals={row.signals} />
                </td>
                <td className="px-3 py-3">
                  <EmaGroup panel={row.priceEmas} />
                </td>
                {hasRatio && (
                  <td className="px-3 py-3">
                    <EmaGroup panel={row.ratioEmas} />
                  </td>
                )}
                <td className="px-3 py-3">
                  <MomentumGroup source={row.signals} />
                </td>
                <td className="px-3 py-3">
                  <VolumeBadge ratio={row.volRatio} />
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                    {watchlist && (
                      <AddToWatchlist symbol={row.symbol} ltp={row.ltp} watchlist={watchlist} compact />
                    )}
                    <button
                      onClick={e => openTradingView(e, row.symbol)}
                      className="p-1.5 rounded hover:bg-[#2a2a40] text-slate-600 hover:text-violet-400 transition-colors"
                      title="Open in TradingView"
                    >
                      <ExternalLink size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
