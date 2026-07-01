import { useState, useEffect } from 'react'

// The set of timeframe columns the user wants to see is a preference, not
// per-stock state: once they turn 30m/1H/M off it should stay off across every
// scan and panel open until they turn it back on. Persist it in localStorage.
const STORAGE_KEY = 'nse_mtf_visible_tfs'

// Multi-timeframe matrix: one column per timeframe (5m..monthly), 8 indicator
// rows. Data comes from /api/mtf-matrix/{symbol} — see MTFMatrix row shape in
// backend/indicators.py compute_mtf_snapshot(). All 7 timeframes are fetched
// in a single backend call; which ones are shown is a pure client-side filter,
// so toggling the picker below never triggers a new request.
const ALL_TIMEFRAMES = [
  { key: '5min',    label: '5m'  },
  { key: '15min',   label: '15m' },
  { key: '30min',   label: '30m' },
  { key: '1h',      label: '1H'  },
  { key: 'daily',   label: 'D'   },
  { key: 'weekly',  label: 'W'   },
  { key: 'monthly', label: 'M'   },
]

const ROWS = [
  { key: 'rsi',        label: 'RSI(14)',       render: r => r?.value != null ? r.value.toFixed(1) : '—' },
  { key: 'macd',       label: 'MACD(12,26)',   render: r => r?.status ?? '—' },
  { key: 'ema20',      label: 'EMA 20',        render: r => r?.value != null ? r.value.toFixed(2) : '—' },
  { key: 'ema50',      label: 'EMA 50',        render: r => r?.value != null ? r.value.toFixed(2) : '—' },
  { key: 'ema150',     label: 'EMA 150',       render: r => r?.value != null ? r.value.toFixed(2) : '—' },
  { key: 'emaCross',   label: 'X: EMA20/50',   render: r => r ? (r.above ? 'Above' : 'Below') : '—' },
  { key: 'ratioEma20', label: 'Ratio/EMA(20)', render: r => r?.value != null ? r.value.toFixed(4) : '—' },
  { key: 'aroon',      label: 'Aroon(25)',     render: r => r?.value != null ? r.value.toFixed(0) : '—' },
]

function Cell({ row }) {
  if (!row) return <td className="px-1 py-1.5 text-center text-slate-600 text-[10px]">—</td>
  return (
    <td className={`px-1 py-1.5 text-center text-[10px] font-mono font-medium truncate ${row.bull ? 'text-emerald-400' : 'text-rose-400'}`}>
      <span className="inline-flex items-center gap-0.5">
        <span>{row.bull ? '▲' : '▼'}</span>
        <span>{row.display}</span>
      </span>
    </td>
  )
}

const ALL_KEYS = ALL_TIMEFRAMES.map(tf => tf.key)

// Load the saved selection, falling back to all-visible on first use / bad data.
// Stale keys (from a removed timeframe) are dropped; an empty result falls back
// to all so the matrix is never blank.
function loadVisible() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
    if (Array.isArray(saved)) {
      const valid = saved.filter(k => ALL_KEYS.includes(k))
      if (valid.length) return new Set(valid)
    }
  } catch { /* ignore */ }
  return new Set(ALL_KEYS)
}

export default function MTFMatrix({ matrix }) {
  const [visible, setVisible] = useState(loadVisible)

  // Persist whenever the selection changes so it survives reopen/rescan.
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...visible])) } catch { /* ignore */ }
  }, [visible])

  const toggle = (key) => {
    setVisible(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        if (next.size === 1) return prev   // keep at least one column visible
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  if (!matrix) {
    return <div className="h-24 flex items-center justify-center text-xs text-slate-600">Loading…</div>
  }

  const columns = (matrix.columns || []).filter(c => visible.has(c.timeframe))

  return (
    <div className="space-y-2.5">
      {/* Timeframe picker — pick which columns to preview, no extra fetch */}
      <div className="flex flex-wrap gap-1.5">
        {ALL_TIMEFRAMES.map(tf => {
          const on = visible.has(tf.key)
          return (
            <button
              key={tf.key}
              onClick={() => toggle(tf.key)}
              className={`px-2 py-1 rounded-md text-[10px] font-semibold font-mono border transition-colors
                ${on ? 'bg-violet-600/20 border-violet-500/50 text-violet-300'
                     : 'bg-[#111120] border-[#1e1e30] text-slate-600 hover:text-slate-400'}`}
            >
              {tf.label}
            </button>
          )
        })}
      </div>

      {/* table-fixed + colgroup so columns always divide up the full sidebar
          width — no horizontal scroll needed to see the Total column, no
          matter how many timeframes are toggled on above */}
      <table className="w-full border-collapse table-fixed">
        <colgroup>
          <col className="w-14" />
          {columns.map(c => <col key={c.timeframe} />)}
          <col className="w-12" />
        </colgroup>
        <thead>
          <tr className="border-b border-[#1e1e30]">
            <th className="px-1 py-1.5 text-left text-[9px] font-semibold text-slate-500 uppercase tracking-wider">Ind.</th>
            {columns.map(c => (
              <th key={c.timeframe} className="px-1 py-1.5 text-center text-[9px] font-semibold text-slate-400 uppercase tracking-wider truncate">
                {c.label}
              </th>
            ))}
            <th className="px-1 py-1.5 text-center text-[9px] font-semibold text-violet-400 uppercase tracking-wider">Tot.</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(({ key, label, render }) => {
            let bullAcross = 0, availAcross = 0
            return (
              <tr key={key} className="border-b border-[#1e1e30]/60">
                <td className="px-1 py-1.5 text-[10px] text-slate-400 truncate" title={label}>{label}</td>
                {columns.map(c => {
                  const row = c.available ? c[key] : null
                  if (row) { availAcross++; if (row.bull) bullAcross++ }
                  return <Cell key={c.timeframe} row={row ? { bull: row.bull, display: render(row) } : null} />
                })}
                <td className="px-1 py-1.5 text-center text-[10px] font-mono text-slate-400">
                  {availAcross > 0 ? `${bullAcross}/${availAcross}` : '—'}
                </td>
              </tr>
            )
          })}
          <tr className="bg-[#13131f]">
            <td className="px-1 py-2 text-[9px] font-semibold text-slate-500 uppercase tracking-wider truncate">Bull</td>
            {columns.map(c => (
              <td key={c.timeframe} className="px-1 py-2 text-center text-[10px] font-mono font-semibold text-slate-300">
                {c.available ? `${c.bullCount}/${c.total}` : '—'}
              </td>
            ))}
            <td className="px-1 py-2 text-center text-[10px] font-mono font-bold text-violet-400">
              {columns.reduce((s, c) => s + (c.bullCount || 0), 0)}/{columns.reduce((s, c) => s + (c.total || 0), 0)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
